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
// CORRECT — no flicker
SDL_GL_SetAttribute(SDL_GL_RED_SIZE, 5);
SDL_GL_SetAttribute(SDL_GL_GREEN_SIZE, 6);
SDL_GL_SetAttribute(SDL_GL_BLUE_SIZE, 5);
SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 0);
SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);

SDL_Surface *screen = SDL_SetVideoMode(1024, 768, 16, SDL_OPENGL | SDL_FULLSCREEN);

// Each frame:
SDL_GL_SwapBuffers();    // NOT eglSwapBuffers()
```

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
/var/log/messages                                       ← system log (stdout/stderr end up here)
```

Pattern for bundled vs. user-supplied data:
1. Ship required data (shareware content, stubs) inside the IPK
2. At load time, `stat()` a user directory under `/media/internal/`; if it exists, switch the data path
3. Check per-load, not just at startup — different content packs may need different directories

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
# Copy IPK to device's user storage
novacom put file:///media/internal/myapp.ipk < myapp_1.0.0_armv7.ipk

# Install via ipkg (not palm-install, which requires host-side tool)
novacom run file:///usr/bin/ipkg install /media/internal/myapp.ipk

# View live stdout/stderr from your app
novacom run 'tail -f /var/log/messages'

# Direct shell access for debugging
novacom -t open tty://
```

---

## Debugging PDK Apps

PDK apps write stdout/stderr to the system log:
```bash
# On the device (via novacom shell):
tail -f /var/log/messages | grep myapp

# Or cat a log file the app wrote to its working dir:
novacom run file:///bin/cat /media/cryptofs/apps/usr/palm/applications/com.example.myapp/app.log
```

The app binary can also be run directly from a novacom shell for live stdout — useful for early-stage debugging before you have a working IPK workflow.

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
