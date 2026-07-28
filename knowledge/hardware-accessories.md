# Hardware Accessories (USB & Bluetooth)

The HP TouchPad's hardware can drive far more than stock webOS 3.0.5 exposes: its
single micro-USB port is a full USB **OTG host**, and its Bluetooth radio can pair
more than the keyboards the UI admits to. Most of this capability is present in the
kernel but left dormant by the shipping software. This document is the map of what
you can actually attach, what you can't, and the two community utilities (in the
**WOSA Modernize** Preware feed) that unlock the hidden pieces.

> **Scope**: HP TouchPad, webOS 3.0.5, kernel `2.6.35-palm-tenderloin`. All of this
> is verified on hardware. The other webOS device families (Pre/Pixi/Veer) have
> different USB/BT hardware and are not covered here.

---

## The capability map

| Accessory | Works? | How |
|---|---|---|
| USB keyboard | ✅ types into the UI | USB Host mode; enumerates as a kbd, events reach every app |
| USB flash drive (VFAT) | ✅ mount & browse | USB Host mode + mount (USB Settings) → `/media/internal/usbdrive` |
| USB game controller | ✅ evdev only | USB Host mode (+ high-power for a DS4); read `/dev/input/eventN` directly |
| USB mouse | ⚠️ evdev only, no cursor | Enumerates and delivers `REL_*`, but webOS has no cursor — the UI ignores it |
| Bluetooth keyboard | ✅ stock | Palm finished this path; pairs and types out of the box |
| Bluetooth game controller (DS4) | ✅ via the shim | Install `org.webosarchive.btgamepad`, pair from **Other** |
| Bluetooth mouse | ⚠️ evdev only, no cursor | Same as USB mouse — ignored by the UI |
| Bluetooth **LE** anything | ❌ impossible | The 2011 CSR radio is BR/EDR only; there is no LE PHY |
| High-power USB device | ⚠️ needs override | ~390 mA port budget rejects a 500 mA device unless bypassed |

The two ⚠️/❌ themes — "evdev only, UI ignores it" and "no BLE" — are the platform
limits everything else works around. See **What does NOT work** below.

---

## USB: the port is a full OTG host

Stock firmware never switches the port to host mode (plugging an OTG cable only
triggers charger detection). The kernel has everything built in — EHCI, USB HID,
usb-storage, sd, VFAT — it just needs the mode flipped.

**The knob** (write-only debugfs file; mount debugfs first if needed):

```sh
mount -t debugfs none /sys/kernel/debug     # if not already mounted
echo host       > /sys/kernel/debug/otg/mode   # enable host mode
echo peripheral > /sys/kernel/debug/otg/mode   # revert
```

The tablet **sources VBUS** in host mode, so bus-powered devices (keyboards, flash
drives, most pads) work off a plain OTG cable without a powered Y-cable.

**Tradeoffs while in host mode** — the port can only be one thing at a time:

- No USB charging (Touchstone charging still works)
- No novacom-over-USB (use Wi-Fi novacom for development)
- No USB drive-sync mode
- Host mode reverts to peripheral **on reboot** (the kernel boots in gadget mode)

### High-power devices

The root port budgets ~390 mA. A device that declares more (a DualShock 4 declares
500 mA) enumerates but the kernel logs `rejected 1 configuration due to
insufficient available bus power` and creates **no** HID/input node. Force it:

```sh
echo 1 > /sys/bus/usb/devices/1-1/bConfigurationValue   # per replug
```

This bypasses the budget check and configures the device anyway. It must be
repeated on each replug. (If the connection is flaky at that draw, feed the
Y-cable's power leg from a charger.)

### USB storage

usb-storage/sd/VFAT are built in; a stick auto-attaches as `/dev/sda1` but nothing
auto-mounts and the UI is unaware. Mount it by hand — **not under `/media`**, which
is on the read-only root fs, but on the writable user partition:

```sh
mkdir -p /media/internal/usbdrive
mount -t vfat -o utf8 /dev/sda1 /media/internal/usbdrive   # browsable in file managers
umount /media/internal/usbdrive                            # sync + unmount before unplugging
```

### IRQ-storm caveat

Unplugging a device in host mode can storm the shared OTG/EHCI interrupt until the
kernel disables IRQ 132, deafening all USB. Recover without a reboot:

```sh
echo peripheral > /sys/kernel/debug/otg/mode; sleep 4; echo host > /sys/kernel/debug/otg/mode
```

---

## Bluetooth: classic BR/EDR only

The radio is a **CSR BlueCore6-ROM, Bluetooth 2.1 + EDR** — classic profiles only,
no Low Energy. Stock webOS pairs and connects any BT-HID device, but Palm only ever
finished the **keyboard** path: the HID→input bridge declares an `EV_KEY`-only
uinput node and only decodes boot keyboards, so mouse and gamepad reports are
classified as unknown and dropped. Keyboards work great; nothing else does — out of
the box.

The `org.webosarchive.btgamepad` package fixes this for controllers (see below).
Bluetooth mice enumerate but, like USB mice, deliver `REL_*` that the cursor-less UI
ignores.

---

## The two utilities (WOSA Modernize feed)

Both are distributed through the **WOSA Modernize** Preware feed. Source and built
`.ipk`s: **https://github.com/webOSArchive/webos-touchpad-accessories**

| Package | What it does |
|---|---|
| **`com.webosarchive.usbsettings`** — *USB Settings* | A Palm-style settings app that toggles the hidden USB tricks with switches instead of shell commands: **USB Host (OTG)** mode, the **High-power** bus-budget bypass, and **USB storage** mount/unmount. A jailed Enyo app talks to a root daemon (`usbctl-watchd`) that does the privileged `sysfs`/`mount` work. |
| **`org.webosarchive.btgamepad`** — *Bluetooth Gamepad* | Unlocks Bluetooth game controllers (a DualShock 4, and other classic BR/EDR HID pads) as real gamepad input. An `LD_PRELOAD` shim into `PmBtEngine` finishes the gamepad HID path Palm left unfinished, producing a proper `EV_ABS`/`EV_KEY` evdev node. Pair the pad from the Bluetooth settings **Other** category; it auto-connects thereafter (press **PS** to reconnect). |

> **Install/uninstall both through Preware or WebOS Quick Install — not
> `palm-install`, and not the launcher's Delete.** The postinst that installs the
> root component only runs as root under Preware/WOSQI; `palm-install` runs it
> unprivileged and the utility does nothing. The launcher's Delete skips the
> removal script and orphans the root component, so remove through Preware/WOSQI
> too. (USB Settings ships `"removable": false` so the launcher offers no Delete
> button.) A reboot is required after install.

---

## What does NOT work (hard limits)

- **No Bluetooth LE, at all.** The CSR BlueCore6 radio is BR/EDR with no LE PHY, and
  the firmware has no GATT/ATT/SMP/HOGP. BLE-only controllers (Xbox One/Series,
  8BitDo in BLE mode) are **impossible** — a hardware limit, not software-fixable.
  Use a classic-Bluetooth pad (DS4) or a USB pad.
- **No joydev in the kernel.** Game controllers are evdev-only (`/dev/input/eventN`);
  there is no `/dev/input/jsN`, so **SDL's joystick/gamecontroller API cannot see a
  pad**. Games must read evdev directly — see `webos://knowledge/game-controllers`.
- **No mousedev / no cursor.** Mice enumerate and deliver `REL_*` via evdev, but
  webOS has no pointer concept; the UI ignores them.
- **The UI only consumes `KEY_*` events.** `BTN_*`/`ABS_*` from a gamepad are
  meaningless to LunaSysMgr. This is why controller support means either reading
  evdev in your app, or translating the pad to key events (the `padkeys` tool).
- **Kernel Bluetooth is not a working path.** `CONFIG_BT` is off in the shipping
  kernel; modules can be built and loaded, but host→chip UART TX never drains, so
  the Linux BT stack can't run. The userspace shim is the answer.

---

## See Also

- `webos://knowledge/game-controllers` — the developer's guide: reading USB/BT pads
  from a PDK game (evdev, the jail bind-mount, the code)
- `webos://knowledge/pdk` — building native C/C++ apps and games for the TouchPad
- `webos://knowledge/postinst-packaging` — how these utilities install a root daemon
  / `LD_PRELOAD` shim alongside a jailed app via `postinst`
- `webos://knowledge/patches` — AUSMT/Preware system-file patching (the mechanism
  behind the Bluetooth path modifications)
- `webos://knowledge/system-internals` — the read-only root fs, the app jail, and
  other below-the-SDK plumbing these utilities work around
