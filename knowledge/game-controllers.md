# Game Controllers in PDK Games

You can play TouchPad games with a real controller — USB (over OTG) or a Bluetooth
DualShock 4 (via the community shim). But three platform facts shape *how* you read
it, and they trip up anyone who assumes the SDL joystick API "just works." This is
the practical guide to adding controller support to a native (PDK) game.

> **Scope**: PDK (C/C++) games on the HP TouchPad, webOS 3.0.5. For the
> user-facing side — enabling USB host mode, installing the Bluetooth gamepad
> package — see `webos://knowledge/hardware-accessories`. For the PDK toolchain and
> the app jail in general, see `webos://knowledge/pdk`.

---

## The three facts that shape everything

1. **There is no joydev in the kernel.** Controllers appear only as evdev nodes
   (`/dev/input/eventN`) — there is no `/dev/input/jsN`. So **`SDL_INIT_JOYSTICK`
   finds nothing**, and `SDL_Joystick*` / `SDL_GameController*` are dead ends. You
   read evdev directly.
2. **webOS only consumes `KEY_*` events.** The system UI (and any input path that
   goes through hidd/LunaSysMgr) ignores `BTN_*`/`ABS_*` entirely — they mean
   nothing to it. Your game has to interpret the pad itself.
3. **The PDK app jail hides `/dev/input`.** A launcher-started PDK game is jailed
   (uid 5003) with a curated `/dev` that **omits `/dev/input`**, so it can't even
   `open()` the controller node until that's fixed (see *Making it work in the
   jail*).

---

## Two ways to get controller input

**Option A — read evdev directly (recommended).** Full analog sticks, triggers,
hat, and every button. This is what a game that wants real controller support does,
and what the reference games do. The rest of this doc is mostly about this path.

**Option B — let `padkeys` translate the pad to key events (zero game code).** The
`padkeys` tool (in the accessories repo) reads the pad and injects `KEY_*` events
through a virtual uinput keyboard that hidd picks up like a real keyboard. If your
game already handles keyboard input, the controller "just works" as arrow keys +
mapped buttons with no code changes — at the cost of digital-only input (no analog).
Good for ports of keyboard games; insufficient for anything wanting analog sticks.

---

## Reading evdev directly

Open the node, optionally identify it by name/capabilities, and read fixed-size
`struct input_event` records. Handle `EV_KEY` (buttons), `EV_ABS` (axes/hat), and
`EV_SYN` (end-of-frame).

```c
#include <linux/input.h>
#include <fcntl.h>
#include <unistd.h>
#include <string.h>

int open_gamepad(void)
{
    char path[32], name[256];
    for (int i = 0; i < 32; i++) {
        snprintf(path, sizeof path, "/dev/input/event%d", i);
        int fd = open(path, O_RDONLY | O_NONBLOCK);
        if (fd < 0) continue;

        /* Identify: a DS4 (USB or via the BT shim) reports this name.
           For USB pads, match on capabilities instead (see below). */
        name[0] = 0;
        ioctl(fd, EVIOCGNAME(sizeof name), name);
        if (strstr(name, "Wireless Controller") ||   /* DS4 */
            has_key(fd, BTN_GAMEPAD)) {               /* generic pad, 0x130 */
            return fd;                                /* found it */
        }
        close(fd);
    }
    return -1;
}

/* poll loop */
struct input_event ev;
while (read(fd, &ev, sizeof ev) == sizeof ev) {
    switch (ev.type) {
    case EV_KEY:   set_button(ev.code, ev.value); break;   /* 0=up 1=down */
    case EV_ABS:   set_axis(ev.code, ev.value);   break;
    case EV_SYN:   /* input_event frame complete — apply state */ break;
    }
}
```

Read axis **ranges** at open time (they are not always 0–255) with `EVIOCGABS`:

```c
struct input_absinfo ai;
ioctl(fd, EVIOCGABS(ABS_X), &ai);   /* ai.minimum, ai.maximum, ai.flat (deadzone) */
```

`EVIOCGRAB` (grab the device exclusively) is worth it if you want to stop the rest
of the system from also seeing the events — **required** for the legacy
BT-keyboard-channel path (where the pad masquerades as a keyboard and would
otherwise inject junk keystrokes), but **not** needed for the shim's proper gamepad
node or a USB pad, which the UI already ignores.

---

## The evdev code map

Both the USB DualShock 4 and the Bluetooth DS4 (through the shim) emit the same
codes. A generic USB pad uses the classic joystick range instead. Match your game's
logic to these:

| Control | evdev code | Range |
|---|---|---|
| Left stick X / Y | `ABS_X` / `ABS_Y` | 0–255 (128 center) |
| Right stick X / Y | `ABS_Z` / `ABS_RZ` | 0–255 |
| Analog triggers L2 / R2 | `ABS_RX` / `ABS_RY` | 0–255 |
| D-pad (hat) | `ABS_HAT0X` / `ABS_HAT0Y` | −1 / 0 / +1 |
| Face buttons (DS4) | `BTN_SOUTH`(✕) `BTN_EAST`(●) `BTN_NORTH`(▲) `BTN_WEST`(■) | 0/1 |
| Shoulders | `BTN_TL` / `BTN_TR` (L1/R1), `BTN_TL2` / `BTN_TR2` (L2/R2 click) | 0/1 |
| Sticks / meta | `BTN_THUMBL` `BTN_THUMBR` `BTN_SELECT` `BTN_START` `BTN_MODE`(PS) | 0/1 |
| Generic USB pad | 8 buttons on `BTN_TRIGGER`…(`0x120`–`0x127`); d-pad on `ABS_X`/`ABS_Y` = 0/128/255 | — |

The shim maps DS4 HID buttons in gamepad order
(`BTN_SOUTH, BTN_EAST, BTN_C, BTN_NORTH, BTN_WEST, BTN_Z, BTN_TL, BTN_TR, BTN_TL2,
BTN_TR2, BTN_SELECT, BTN_START, BTN_MODE, BTN_THUMBL, BTN_THUMBR`); pads with more
than 15 buttons spill onto `BTN_TRIGGER_HAPPY+`.

---

## Making it work in the jail

A launcher-started PDK game is jailed and can't reach `/dev/input` by default. Two
fixes are needed; the `org.webosarchive.btgamepad` package already installs **both**
(so a game targeting the BT DS4 needs no extra work), but you must understand them
if you target a **USB** pad or ship a standalone game.

**1. Bind-mount `/dev/input` into the PDK jail.** The jailer config
`/etc/jail_pdk.conf` builds a curated `/dev` with no `/dev/input`. Patch it to add
the mount right after the existing `mkdir /dev` line (idempotently):

```sh
# in your postinst — backs up, then inserts the two lines once
grep -q "mount ro /dev/input" /etc/jail_pdk.conf || \
  awk '{print} /^mkdir \/dev$/ && !d {print "mkdir /dev/input"; print "mount ro /dev/input"; d=1}' \
      /etc/jail_pdk.conf > /tmp/jp && cp /etc/jail_pdk.conf /etc/jail_pdk.conf.orig && mv /tmp/jp /etc/jail_pdk.conf
```

Jails rebuild per launch, so it takes effect on the next app start (no reboot).
**Caveat:** this exposes *all* of `/dev/input` (touchscreen, BT keyboard, …) to
*every* PDK app on the device, not just yours.

**2. Make the node readable by the jail user (uid 5003).** Input nodes default to
`0640 root:root`; the jailed game can't read them. Install a udev rule that widens
the specific device to `0666`:

```
# /etc/udev/rules.d/99-<yourgame>-pad.rules
SUBSYSTEM=="input", KERNEL=="event[0-9]*", ATTRS{name}=="Wireless Controller", MODE="0666"
```

Reload with `udevcontrol reload_rules` (or reboot). Match `ATTRS{name}` to your
target pad's name — `Wireless Controller` for a DS4; for a USB pad use its own name
(e.g. the Logitech Precision Gamepad) or a broader match. The btgamepad package
ships exactly this rule for `Wireless Controller`.

> Because the btgamepad package already applies both fixes for the DS4, the simplest
> path to controller support is: **target the DS4's evdev node, and list the
> btgamepad package as a prerequisite.** For a USB-only game, replicate the two
> fixes in your own package's postinst/udev rule.

---

## USB controllers, specifically

1. The user enables **USB Host** mode (and **High-power** for a DS4) — the *USB
   Settings* app does this, or the raw `sysfs` knobs from
   `webos://knowledge/hardware-accessories`.
2. The pad enumerates as `/dev/input/eventN`. A generic HID pad uses the
   `0x120`-range buttons + `ABS_X/Y` d-pad; a USB DS4 uses the full map above.
3. Your game reads it exactly as in *Reading evdev directly*. Remember host mode
   means no novacom-over-USB — develop over Wi-Fi novacom.

---

## Bluetooth controllers, specifically

1. The user installs `org.webosarchive.btgamepad` and pairs the DS4 from the
   Bluetooth settings **Other** category (reboot once after install).
2. The shim produces a proper gamepad evdev node named **`Wireless Controller`**
   (bustype `BUS_BLUETOOTH`); reconnect after bonding is just the **PS** button.
3. Your game opens that node and reads the full map above — no USB power concerns.

**Keep the screen awake.** `PmBtEngine` dies during an active BT-HID session if the
display sleeps (suspend churn); a fullscreen game generally prevents it, and it
self-heals (respawn → auto-reconnect → shim re-takeover), but a brief input dropout
is possible. Don't assume the fd stays valid forever — handle `read()` errors by
re-opening.

---

## Reference implementations

From **https://github.com/webOSArchive/webos-touchpad-accessories**:

- **`gamepad-view/padview.c`** — a live evdev **reader/visualizer**: autodetects any
  pad (advertising `BTN 0x120`/`0x130`), reads `EVIOCGABS` ranges, and draws stick /
  trigger / button state. Good reference for the read-and-decode loop. (It draws to
  `/dev/fb0`, which flickers under the 3-layer compositor — `padview-sdl.c` is the
  stable SDL rewrite. See `webos://knowledge/pdk` on why to render through SDL.)
- **`gamepad-keys/padkeys.c`** — the **Option B** tool: an evdev→uinput **key
  mapper**. Reference for translating a pad to `KEY_*` and injecting via
  `/dev/input/uinput`, including reconstructing the DS4 report from the legacy
  BT-keyboard-channel mangling.
- **Commander Keen (`com.cmdrkeen.game`)** — a shipping PDK game that reads the
  shim's DS4 evdev node directly (14 buttons, both sticks, triggers, hat), verified
  end-to-end on hardware. The model for "real controller support in a native game."

---

## Gotchas

- **Don't use the SDL joystick API** — no joydev, it sees nothing. evdev only.
- **`ABS_*` ranges vary** — always read `EVIOCGABS`; don't hardcode 0–255.
- **The jail hides `/dev/input`** — a game that works from a novacom shell but not
  from the launcher is almost always missing the jail bind-mount and/or the udev
  0666 rule.
- **Host mode reverts on reboot**, and USB unplug can IRQ-storm the controller — see
  `webos://knowledge/hardware-accessories`.
- **The `/dev/input` bind-mount is device-wide** — every PDK app gets it; fine for a
  single-purpose device, worth noting for privacy-sensitive contexts.

---

## See Also

- `webos://knowledge/hardware-accessories` — the capability map and the user-facing
  utilities (USB Settings, Bluetooth Gamepad) in the WOSA Modernize feed
- `webos://knowledge/pdk` — PDK toolchain, the app jail, SDL rendering, input basics
- `webos://knowledge/postinst-packaging` — installing the jail patch + udev rule from
  your package's `postinst`
- `webos://knowledge/system-internals` — the app jail internals (uid 5003, curated
  `/dev`, per-launch rebuild)

---

## The 1 Hz hotplug scan that looks like a rendering stall

A game that polls `/dev/input` for hotplugged pads typically rescans once a
second, opening `event0..N` to identify each device. **On the TouchPad that is
expensive enough to be felt as a periodic stutter**, and it gets misdiagnosed as
a graphics problem every time.

**Measured on device:** `open()` on the TouchPad's three BUILT-IN input devices
takes **22-71 ms each** — their drivers do real work in the open handler:

| node | device | open() cost |
|---|---|---|
| `event0` | `gpio-keys` | ~22-36 ms |
| `event1` | `pmic8058_pwrkey` | ~39-71 ms |
| `event2` | `headset` | ~30-44 ms |

Opening all three every second costs **166-198 ms**, i.e. a ~0.2 s hitch once a
second. In SDL Quake this showed up as "smooth for a second or two, then stuck
for half a second, repeating". Quake's own `host_speeds` profiler placed the
time in the pass containing `Sys_SendKeyEvents` rather than in `gfx`, which is
what pointed at input rather than the renderer:

```
212 tot  181 server   31 gfx      <- stall
 72 tot    0 server   72 gfx      <- normal frame
```

**The fix: probe each node once, then remember the answer.** Skipping a device
*after* opening it (by name, say) does not help — the cost is in the `open()`
itself.

```c
/* per-node "already probed and uninteresting" flags */
static byte node_boring[MAX_NODES];

for (i = 0; i < MAX_NODES; i++) {
    if (already_held(i)) continue;
    /* access() only stats the node; it never enters the driver, so it is cheap
     * where open() is not. A node that disappeared forfeits its mark, so a
     * replacement device at the same index still gets probed. */
    if (access(path, F_OK) != 0) { node_boring[i] = 0; continue; }
    if (node_boring[i]) continue;

    fd = open(path, O_RDONLY | O_NONBLOCK);
    ...classify...
    if (!interesting) { node_boring[i] = 1; close(fd); continue; }
}
```

Steady state becomes a handful of cheap `stat`s per second and zero `open()`s.
Hotplug still works: a newly attached pad's node did not exist before, so it is
probed on the next scan.

Keep a warning in the code (`if (scan_ms >= 20) Con_Printf(...)`) — this failure
mode presents as a renderer problem, so make it name itself.
