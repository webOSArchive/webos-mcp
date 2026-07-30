# webOS PDK (Plug-in Development Kit)

The PDK allows native C/C++ Linux apps to run on webOS devices. PDK apps are compiled for ARM Linux, packaged as `.ipk` files just like JS apps, and run directly on the device's Linux kernel. This is how games, emulators, and compute-intensive apps were built for webOS. The approach is called PDL, which is Palm's implementation of SDL.

> **Scope**: This document focuses on the HP TouchPad (webOS 3.0.5) as the primary PDK target. Phone PDK development exists but is less documented in modern practice.

---

## Target Platform (HP TouchPad)

- **Device**: HP TouchPad (2011)
- **OS**: webOS 3.0.5, Linux kernel 2.6.35
- **CPU**: Qualcomm Snapdragon APQ8060, dual-core ARM Cortex-A8
- **Screen**: 1024×768 IPS, landscape orientation
- **SDK**: HP webOS PDK — provides SDL 1.2, SDL_mixer, and libpdl

---

## Toolchain

### Cross-Compiler: Linaro GCC 4.9.4

The correct cross-compiler is **Linaro GCC 4.9.4** for `arm-linux-gnueabi`. This is not the same as modern ARM toolchains — era-appropriate ABI compatibility is important.

- **Prefix**: `arm-linux-gnueabi-gcc` (not `arm-none-linux-gnueabi-gcc`)
- **Download**: Linaro archive (historical releases)
- **Install location**: Conventionally `/home/<user>/linaro-toolchain/bin/`

### Key Compiler Flags

```bash
CFLAGS="-O2 -mcpu=cortex-a8 -mfpu=neon -mfloat-abi=softfp"
CFLAGS="$CFLAGS -D__webos__ -DLINUX"
CFLAGS="$CFLAGS -I/opt/PalmPDK/include -I/opt/PalmPDK/include/SDL"
CFLAGS="$CFLAGS -Wall -fsigned-char -D_GNU_SOURCE=1 -D_REENTRANT"
```

- `-mcpu=cortex-a8` — targets the TouchPad's actual CPU
- `-mfpu=neon` — enables NEON SIMD (important for performance)
- `-mfloat-abi=softfp` — required for ABI compatibility with webOS system libraries
- `-D__webos__` — conventional platform define for `#ifdef` guards
- `-fsigned-char` — char is signed on ARM by default; make this explicit

### Linker Flags

```bash
LDFLAGS="-L/opt/PalmPDK/device/lib -lSDL -lSDL_mixer -lpdl -lz -lstdc++ -lm"
```

For OpenGL ES apps, add:
```bash
LDFLAGS="$LDFLAGS -lGLES_CM"    # OpenGL ES 1.1 — link directly, do NOT link -lEGL
```

---

## PDK Directory Structure

```
/opt/PalmPDK/
├── include/                  # Headers for cross-compilation
│   ├── SDL/                  # SDL 1.2 headers
│   ├── GLES/                 # OpenGL ES 1.1 headers
│   ├── GLES2/                # OpenGL ES 2.0 headers
│   └── PDL.h                 # Palm Device Library header
└── device/lib/               # ARM device libraries (for linking, not execution)
    ├── libSDL-1.2.so
    ├── libSDL_mixer.so
    ├── libGLES_CM.so          # OpenGL ES 1.1
    ├── libpdl.so              # Palm Device Library
    └── libpng12.so
```

The device libs are ARM binaries — they're for the linker's reference only, not executable on your host.

---

## PDL (Palm Device Library)

PDL is HP's integration layer between native code and the webOS system. Always initialize it **before** SDL.

```c
#include <PDL.h>

// Required: initialize PDL before SDL
PDL_Init(0);

// Recommended: enable proper multi-touch
PDL_SetTouchAggression(PDL_AGGRESSION_MORETOUCHES);

// Recommended: suppress system gesture layer (swipe from edge)
// Without this, screen-edge touches are intercepted by the system before your app sees them
PDL_GesturesEnable(PDL_FALSE);

// Then initialize SDL normally
SDL_Init(SDL_INIT_VIDEO | SDL_INIT_AUDIO | SDL_INIT_JOYSTICK);
```

**Order matters**: if PDL is not initialized before SDL, GPU access and system integration are not guaranteed to work correctly.

---

## The 3-Layer Display Compositor

The TouchPad's display system has **three layers**, unlike most Linux systems which have two:

1. **Background layer** — system wallpaper and launcher
2. **Application layer** — where your app renders (SDL surface / GL context)
3. **UI layer** — system chrome, notifications, gesture bar

This architecture has critical implications for rendering:

### The EGL Flicker Problem

When EGL is used directly to create an OpenGL context, it does not properly integrate with the 3-layer compositor. Touch events trigger layer compositing operations that cause visible flicker — the layers composite incorrectly on every touch.

**Never use EGL directly on webOS.**

### The Fix: SDL's Built-in OpenGL Support

SDL's GL context management integrates correctly with the 3-layer system. Use SDL as the GL context owner:

```c
// CORRECT — no flicker, and actually gets a context at native resolution
PDL_Init(0);                 // BEFORE SDL_Init
SDL_Init(SDL_INIT_VIDEO);

SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 1);   // <-- REQUIRED
SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1);

// 0,0,0 = desktop mode. Do NOT pass an explicit size, SDL_OPENGLES or
// SDL_FULLSCREEN yourself — see the two traps below.
SDL_Surface *screen = SDL_SetVideoMode(0, 0, 0, SDL_OPENGL);
// screen->w / screen->h are now the panel's native size (1024x768 on a TouchPad)

// Each frame:
SDL_GL_SwapBuffers();    // NOT eglSwapBuffers()
```

**Trap 1 — you must ask for a GLES *1* context.** Palm's SDL otherwise requests
`EGL_CONTEXT_CLIENT_VERSION = 2` and adds `EGL_RENDERABLE_TYPE = ES2_BIT` to the
config, and the TouchPad's Adreno driver refuses that combination with
`EGL_BAD_ALLOC`. SDL reports this only as the unhelpful
`Could not create EGL context`, for every pixel format, at every size, from
inside or outside the app jail. Setting `SDL_GL_CONTEXT_MAJOR_VERSION` to 1
makes SDL drop `RENDERABLE_TYPE` and pass NULL context attributes, and the
context allocates first try. Raw EGL from the same process succeeds on all 27
configs, which is what proves the fault is SDL's ES2 request rather than the
driver, the jail, or permissions.

**Trap 2 — ask for size 0x0.** Requesting an explicit `1024, 768` (with
`SDL_OPENGLES | SDL_FULLSCREEN`) returns a **320x480** Palm-Pre-sized surface.
Desktop mode returns the panel's native 1024x768, and SDL sets the fullscreen
and GLES flags itself.

**Trap 3 — do not ship `metadata.json`.** Gating an app to the TouchPad with
`{"version":1,"devices":[101]}` puts it into **phone compatibility mode**, and
the compositor then hands it a 320x480 surface no matter what it asks for.
Verified by A/B on one binary: with the file 320x480, without it 1024x768.
Counter-intuitive, since 101 *is* the TouchPad. Working GLES apps on this device
ship no `metadata.json`.

> **Method note.** All three of the above were found by `LD_PRELOAD`-logging the
> EGL and SDL calls of a **known-working GLES app on the same device**
> (`com.studio3d.tuxr`, Tux Racer) and diffing its call sequence against the
> failing one. Theorising about EGL from the failure message alone produced only
> wrong answers. When a platform API fails, find something that works on that
> platform and diff it — before patching anything.

```c
// WRONG — causes touch flicker
eglGetDisplay(...);
eglCreateContext(...);
eglSwapBuffers(...);

// Also wrong — dlopen() for EGL at runtime also causes flicker
dlopen("libEGL.so", ...);
```

**GL header and linking:**
```c
#include <GLES/gl.h>    // Use OpenGL ES 1.1 directly
```
```makefile
LDLIBS += -lGLES_CM    # Link directly to GLES, NOT to libEGL
```

Reference implementation: `frontend/libpicofe/gl_webos.c` in PCSX-ReARMed for webOS.

### Ghost Pixels on Resolution Change

**Problem:** When an SDL surface shrinks (e.g., a game changes from 640×480 to 320×240), the compositor does not clear the pixels that were outside the new window boundary. Old pixels from the previous frame — including touch control overlays — remain visible as "ghosts."

**Solution:** Before switching to a smaller resolution, briefly create a full-screen surface, clear it, and flip twice (for double buffering), then switch to the target resolution:

```c
// Before changing to smaller resolution:
SDL_Surface *tmp = SDL_SetVideoMode(FULL_W, FULL_H, 16, flags | SDL_FULLSCREEN);
if (tmp) {
    if (SDL_MUSTLOCK(tmp)) SDL_LockSurface(tmp);
    memset(tmp->pixels, 0, tmp->pitch * tmp->h);
    if (SDL_MUSTLOCK(tmp)) SDL_UnlockSurface(tmp);
    SDL_Flip(tmp);
    SDL_Flip(tmp);    // Double flip for double buffering
}
// Now switch to the actual target resolution:
screen = SDL_SetVideoMode(target_w, target_h, 16, flags);
```

This forces the compositor to update its entire buffer. Only needed for software rendering (not GL).

---

## Multi-Touch Input via SDL 1.2

webOS extends SDL 1.2 mouse events with a **non-standard `which` field** carrying the finger index (0–4). Standard SDL ignores this field; webOS PDK apps must handle it explicitly.

```c
case SDL_MOUSEBUTTONDOWN:
    int finger = event.button.which;   // 0–4
    // handle finger down for this finger index
    break;

case SDL_MOUSEBUTTONUP:
    int finger = event.button.which;
    break;

case SDL_MOUSEMOTION:
    int finger = event.motion.which;
    break;
```

You can also poll directly:
```c
// Up to SDL_MAXMOUSE (5) simultaneous fingers
int x, y;
SDL_GetMultiMouseState(finger_index, &x, &y);
```

### Per-Finger State Management

Track state per-finger, not globally:

```c
#define MAX_FINGERS 5

typedef struct {
    int active;
    int zone;           // which control zone this finger is in
    int keys_held;      // bitmask of keys being held by this finger
    Uint32 hold_start;  // for minimum-hold timer
} FingerState;

FingerState fingers[MAX_FINGERS];
```

Key rules:
- **Don't release a key when a finger lifts if another finger is still holding the same zone.** Check whether any other finger still maps to the same keys before releasing.
- A **~150ms minimum-hold timer** prevents tap-release races when the render loop and game logic run at different rates.

### Touch Controls on 8-Bit Surfaces

No alpha blending is available on 8-bit palettized surfaces. Draw overlays using only `SDL_FillRect` with palette indices. To maintain contrast against any game background:

- Draw the shape twice: once in black at +2px offset (shadow), then in white at the original position
- For text labels, use hardcoded 5×7 pixel bitmap glyphs rendered with `SDL_FillRect` at 3× scale

### Touch Input for Menu Navigation

Menu systems expect sustained key states, but touch events are instantaneous. After testing many approaches, **TapKey is the recommended pattern**:

On each tap, inject a complete synthetic keystroke (KEY_DOWN immediately followed by KEY_UP) into SDL's event queue:

```c
static void inject_key_event(SDLKey key, int pressed)
{
    SDL_Event event;
    memset(&event, 0, sizeof(event));
    event.type = pressed ? SDL_KEYDOWN : SDL_KEYUP;
    event.key.state = pressed ? SDL_PRESSED : SDL_RELEASED;
    event.key.keysym.sym = key;
    SDL_PushEvent(&event);
}

// On SDL_MOUSEBUTTONDOWN in menu mode:
if (zone >= 0) {
    SDLKey key = map_zone_to_sdlkey(zones[zone].action);
    inject_key_event(key, 1);    // KEY_DOWN
    inject_key_event(key, 0);    // KEY_UP
}
```

This is simpler and more reliable than tracking press/release state — one tap produces exactly one menu action, no timing dependencies, no stuck keys possible.

When switching between game mode and menu mode, flush stale touch events:
```c
SDL_Event event;
while (SDL_PeepEvents(&event, 1, SDL_GETEVENT,
       SDL_EVENTMASK(SDL_MOUSEBUTTONDOWN) |
       SDL_EVENTMASK(SDL_MOUSEBUTTONUP) |
       SDL_EVENTMASK(SDL_MOUSEMOTION)) > 0) {
    /* discard */
}
```

---

## Software Rendering: 8-Bit Surface Scaling

For games with internal palettized rendering (8-bit color), use an off-screen game surface at native game resolution and stretch to full screen each frame:

```c
// Setup
SDL_Surface *screen     = SDL_SetVideoMode(1024, 768, 8, SDL_FULLSCREEN);
SDL_Surface *game_surf  = SDL_CreateRGBSurface(SDL_SWSURFACE, 320, 240, 8, 0,0,0,0);
// Both surfaces must share the same palette
apply_palette(screen);
apply_palette(game_surf);

// Each frame
SDL_SoftStretch(game_surf, NULL, screen, NULL);  // 3.2× scale (320→1024, 240→768)
draw_touch_overlay(screen);                       // overlay drawn after stretch
SDL_Flip(screen);
```

**Critical:** All internal `setpixel()`/`getpixel()` calls and render pointer assignments must target `game_surf`, not `screen`. `SDL_SoftStretch` overwrites the screen every frame — anything written directly to `screen` between flips is erased.

After any palette change, apply the new palette to **both** surfaces.

---

## Filesystem Layout

```
/media/cryptofs/apps/usr/palm/applications/<app-id>/   ← app install dir, READ-ONLY at runtime
/media/internal/                                        ← user storage, always writable
/var/log/messages                                       ← system log (but NOT where a launcher-
                                                          launched PDK app's stdout/stderr go —
                                                          see "How the Launcher Runs a PDK App")
```

> **stdout/stderr caveat:** the line above is true only when you run the binary **directly** from a
> novacom shell. A PDK app launched **from the launcher** runs in a jail and its stdout/stderr reach
> **neither a terminal nor `/var/log/messages`** — they are lost unless the binary redirects them to a
> file itself. See the jail section below.

Pattern for bundled vs. user-supplied data:
1. Ship required data (shareware content, stubs) inside the IPK
2. At load time, `stat()` a user directory under `/media/internal/`; if it exists, switch the data path
3. Check per-load, not just at startup — different content packs may need different directories

---

## How the Launcher Runs a PDK App (the jail)

Running your binary directly from a novacom shell is **not** how the launcher runs it, and the
differences bite. When `LunaSysMgr` launches a PDK app (icon tap, or
`luna-send -n 1 palm://com.palm.applicationManager/launch '{"id":"<app-id>"}'`), it runs the binary
in a **hybrid jail** with a restricted environment. Verified on a TouchPad (webOS 3.0.5) by catching
the live process and reading `/proc/<pid>/{cmdline,cwd,environ,status,root}`:

- **It runs jailed**, chrooted under `/var/palm/jail/<app-id>/`, as a non-root user
  (**uid 5003 `jailuser`**, gid 5000), with `LD_PRELOAD=libpvrtc.so` and `HOME`/CWD set to the app
  install dir. Only a curated set of mounts exists inside the jail (see below).
- **`main` must be the native ARM binary.** A shell-script `main` (e.g. a launch wrapper that sets env
  then `exec`s the real binary) is **not** executed — nothing runs, silently. If you need a wrapper,
  do the work *inside* the binary instead.
- **The launch parameters arrive as `argv`.** The app is exec'd roughly as `myapp "{ }"` (the launch
  JSON params object). A binary that treats `argv[1]` / the last arg as a file path will choke on it.
  Parse defensively, or ignore argv for a single-purpose app.
- **`argv[0]` is unreliable** (may be a bare name). To self-locate (e.g. to `chdir` into the app dir so
  run-dir-relative paths resolve), use `readlink("/proc/self/exe", ...)`, not `argv[0]`.
- **stdout/stderr go nowhere** — not a tty, not `/var/log/messages`. To get any logs from a
  launcher-launched app, redirect them yourself, early in `main`, to a file on writable storage:
  ```c
  /* do this before anything that can fail */
  FILE *lf = fopen("/media/internal/<app-id>.log", "w");
  if (lf) { dup2(fileno(lf), 1); dup2(fileno(lf), 2); fclose(lf);
            setvbuf(stdout, NULL, _IONBF, 0); setvbuf(stderr, NULL, _IONBF, 0); }
  ```
- **`/media/internal` *is* bind-mounted read-write into the jail** (the real partition, same files),
  so it remains your reliable writable scratch/log/save location from inside the jail. The app install
  dir under `/media/cryptofs/...` is present but read-only.

### Mounts visible inside the jail
`/proc/<pid>/root` (read from outside, as root) shows what the app actually sees. On a TouchPad it is
roughly: the app dir under `/media/cryptofs/apps/...` (ro), `/media/internal` (rw, bind-mounted),
`/lib` `/bin` `/usr/{bin,lib,share,plugins}` `/etc/ssl` (ro, from `store-root`), `tmpfs` on `/tmp`
`/dev/snd` `/dev/shm`, GPU/framebuffer device nodes (`/dev/fb1`, `/dev/kgsl-*`, `/dev/pmem_smipool`),
a fresh `/proc`, and a small slice of `/var` (`luna`, `palm`, `run`, `ssl`). Anything **not** in that
list (e.g. an arbitrary `/var/...` path, or `/media/cryptofs` outside your app dir) does **not** exist
for the app — design your runtime paths accordingly.

### Debugging a jailed app
The jail is **torn down when the app exits**, and (per `system-internals` / `gotchas`) **capabilities
are stripped so even root cannot `ptrace` it**. So:
- Read the app's in-jail files **while it is alive**, from the host, via `/proc/<pid>/root/...`
  (e.g. `cat /proc/$(pidof myapp)/root/media/internal/<app-id>.log`) — post-mortem the path is gone.
- A tight `pidof` poll loop catches a short-lived process to snapshot its log/`/proc` before it dies.

### Native libraries on noexec storage (loader-dependent)
The kernel won't `mmap(PROT_EXEC)` a file from a noexec mount, so a *normally dynamically-linked* PDK
binary needs its `.so`s on an exec partition (the app dir works). But a host that maps code itself —
its own ELF loader copying segments into anonymous RWX memory (e.g. an Android `bionic`-linker-as-a-
library shim) — can load `.so`s as plain data from a **noexec** partition like `/media/internal`. Only
the top-level binary the kernel `exec`s needs the exec partition. Useful when bundling a large,
writable, or user-supplied library payload.

---

## Build Script Pattern

```bash
#!/bin/bash
set -e

TOOLCHAIN_BIN="/home/youruser/linaro-toolchain/bin"
PDK="/opt/PalmPDK"
CC=arm-linux-gnueabi-gcc
CXX=arm-linux-gnueabi-g++

export PATH="$TOOLCHAIN_BIN:/usr/bin:/bin:$PATH"

CFLAGS="-O2 -mcpu=cortex-a8 -mfpu=neon -mfloat-abi=softfp"
CFLAGS="$CFLAGS -D__webos__ -DLINUX -I$PDK/include -I$PDK/include/SDL"
CFLAGS="$CFLAGS -Wall -fsigned-char -D_GNU_SOURCE=1 -D_REENTRANT"
LDFLAGS="-L$PDK/device/lib -lSDL -lSDL_mixer -lpdl -lz -lstdc++ -lm"

BUILDDIR="build/webos"
mkdir -p "$BUILDDIR"

# Incremental build — skip unchanged files
for src in $C_SRCS; do
    obj="$BUILDDIR/$(basename ${src%.c}.o)"
    if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]; then
        echo "CC $src"
        $CC $CFLAGS -c "$src" -o "$obj"
    fi
    OBJECTS="$OBJECTS $obj"
done

$CXX $OBJECTS $LDFLAGS -o "$BUILDDIR/myapp"
```

Use `rm -rf build/webos/` for a clean rebuild.

### Packaging Script Pattern

```bash
# Read version from appinfo.json rather than hardcoding it
VERSION=$(grep '"version"' appinfo.json | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
APP_ID=$(grep '"id"' appinfo.json | sed 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# palm-package reads the webos/ directory and outputs an .ipk
/opt/PalmSDK/Current/bin/palm-package webos/
```

The `palm-package` tool is in the **PalmSDK** (not PalmPDK) — these are two separate installs:
- **PalmPDK** (`/opt/PalmPDK/`) — headers and device libraries for compilation
- **PalmSDK** (`/opt/PalmSDK/`) — packaging and deployment tools (`palm-package`, `palm-install`)

---

## Deployment via novacom

```bash
# Easiest: palm-install talks to the device over novacom directly (no manual copy)
palm-install myapp_1.0.0_all.ipk

# Or copy + install on-device with ipkg:
novacom put file:///media/internal/myapp.ipk < myapp_1.0.0_all.ipk
novacom run file:///usr/bin/ipkg install /media/internal/myapp.ipk

# Reinstalling? Bump the appinfo.json "version" first — palm-install silently
# refuses a same-or-lower version (see gotchas.md).

# Direct shell access for debugging
novacom -t open tty://
```

---

## Debugging PDK Apps

**Run directly from a novacom shell** for live stdout — the easiest early-stage loop, before you have a
working IPK:
```bash
novacom run file:///media/cryptofs/apps/usr/palm/applications/com.example.myapp/myapp
```

**Launcher-launched is different.** A jailed app's stdout/stderr do **not** reach `/var/log/messages`
(see "How the Launcher Runs a PDK App") — so for the real launch path, have the binary redirect its
own stdout/stderr to a file on `/media/internal`, then read it:
```bash
# while the app is alive — the in-jail file is also reachable via /proc/<pid>/root:
novacom run file:///bin/cat /media/internal/com.example.myapp.log
novacom run 'cat /proc/$(pidof myapp)/root/media/internal/com.example.myapp.log'
```

Add `fprintf(stderr, ...)` liberally when diagnosing path, stat, or file-open failures — logs are the primary debugger.

---

## PDK App appinfo.json

```json
{
  "id": "com.example.myapp",
  "version": "1.0.0",
  "vendor": "My Company",
  "type": "pdk",
  "main": "myapp",
  "title": "My App",
  "icon": "icon.png"
}
```

- `"type": "pdk"` — identifies this as a native app
- `"main": "myapp"` — the name of the native binary inside the package

---

## Working Reference Projects

- **Commander Keen for webOS** (`com.cmdrkeen.game`) — SDL 1.2, software rendering, 8-bit palette, multi-touch: https://github.com/codepoet80/webOS-CommanderKeen-SDL
- **PCSX-ReARMed for webOS** (`com.starkka.pcsxrearmed`) — SDL + OpenGL ES 1.1, NEON dynarec, full touch control system: https://github.com/codepoet80/PCSX_Rearmed-WebOS
- **TuxRacer** (`com.studio3d.tuxr`) — working example of SDL + `libGLES_CM.so` without EGL (no flicker)

---

## See Also

- `webos://knowledge/postinst-packaging` — postinst/prerm scripts for installing setuid helpers and upstart daemons alongside a PDK app
- `webos://knowledge/nizovn-packages` — Qt 5, modern glibc, and OpenSSL ports that extend what's possible in PDK apps
