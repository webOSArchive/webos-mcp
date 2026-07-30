# OpenGL ES on the HP TouchPad

Everything needed to get a **hardware-accelerated** PDK app running on the
TouchPad's Adreno 220, and to port a desktop OpenGL 1.x renderer to the
OpenGL ES 1.1 the device actually provides.

All of it was verified on hardware while converting SDL Quake from its software
rasterizer to GL at the panel's native 1024×768 — a change worth roughly **4–6×**
the frame rate (9.8 fps → 22–60 fps at the same resolution).

> See also `pdk.md` for the 3-layer compositor and the "never call EGL directly"
> rule, which still applies. This document is about making SDL's GL path
> actually work, and about the ES-vs-desktop porting differences.

---

## Getting a context (the part that blocks everyone)

```c
PDL_Init(0);                     /* BEFORE SDL_Init */
SDL_Init(SDL_INIT_VIDEO);

SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 1);   /* THE key line */
SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1);

SDL_Surface *screen = SDL_SetVideoMode(0, 0, 0, SDL_OPENGL);
/* screen->w x screen->h is now 1024x768 */

/* per frame */
SDL_GL_SwapBuffers();
```

Build with `-lGLES_CM` and `#include <GLES/gl.h>`. Never link or `dlopen`
`libEGL` — that is the compositor-flicker trap in `pdk.md`.

### Three traps, each of which produces a *silent* wrong result

| Symptom | Cause | Fix |
|---|---|---|
| `Could not create EGL context` for every format and size | SDL requests an **ES2** context (`EGL_CONTEXT_CLIENT_VERSION=2`, `EGL_RENDERABLE_TYPE=ES2_BIT`); the Adreno driver answers `EGL_BAD_ALLOC` | `SDL_GL_CONTEXT_MAJOR_VERSION = 1` |
| Context works but the surface is **320×480** | An explicit size (especially with `SDL_OPENGLES`/`SDL_FULLSCREEN`) gets a Palm-Pre-sized surface | `SDL_SetVideoMode(0, 0, 0, SDL_OPENGL)` — desktop mode |
| Surface is **320×480** no matter what | Shipping `metadata.json` `{"version":1,"devices":[101]}` puts the app in **phone compatibility mode** | Do not ship `metadata.json` |

That last one is genuinely counter-intuitive: device 101 *is* the TouchPad, yet
gating to it is what triggers phone compatibility. Verified by A/B on a single
binary, dropping the file in and out — with it 320×480, without it 1024×768.

### Ruled out by measurement — do not re-investigate

- **Not the pixel format.** Nine colour/depth/size combinations all fail
  identically without the context-version fix.
- **Not `eglGetDisplay(native=1)`.** Working apps use display 1 too.
- **Not permissions or the jail.** `libEGL`/`libGLES_CM`/`libGLESv2` are all in
  `/usr/lib`; the jailed process is in group `video`, so `/dev/kgsl-3d0`
  (`root:video`, mode 660) is accessible; `jailer -t game -i <appid> <prog>`
  shows `kgsl-3d0`, `fb1` and `pmem_smipool` present inside.
- **Not app type.** `type: "pdk"` and `type: "game"` behave the same here.
- **Raw EGL from a plain shell succeeds on all 27 configs**, which is what
  proves the fault is SDL's ES2 request and nothing lower down.

### Adreno 220 capabilities

```
GL_VENDOR    Qualcomm            GL_RENDERER  Adreno (TM) 220
GL_VERSION   OpenGL ES-CM 1.1    MAX_TEXTURE_SIZE 4096, MAX_TEXTURE_UNITS 2
```
Useful extensions: `GL_OES_texture_npot`, `GL_EXT_texture_filter_anisotropic`,
`GL_OES_framebuffer_object`, `GL_OES_compressed_paletted_texture`,
`GL_EXT_texture_format_BGRA8888`, `GL_QCOM_tiled_rendering`,
`GL_AMD_compressed_ATC_texture`. EGL is 1.4, Qualcomm, with 27 configs.

---

## Porting a desktop GL 1.x renderer to GLES 1.1

GLES 1.1 is fixed-function, so a 1990s renderer maps onto it well — no shaders
to write, the matrix stack still exists. What it removes:

### Immediate mode — emulate it, don't rewrite the call sites

There is no `glBegin`/`glVertex`/`glTexCoord`/`glColor`/`glEnd`. Reimplement
them over vertex arrays rather than hand-converting every draw site: accumulate
into arrays, and emit one `glDrawArrays` on `glEnd`. GLQuake has 28 `glBegin`
blocks and 54 `glVertex` calls; a shim is a few hundred lines and mechanical,
where rewriting each site is tedious and easy to get subtly wrong.

Points to get right in the shim:
- Track "current" colour/texcoord stickily across vertices, as desktop GL does.
- Only enable the colour and texcoord arrays if the batch actually set them —
  otherwise a stale colour array overrides the fixed-function current colour.
- Restore the current colour with `glColor4f` after a batch that used a colour
  array, since the array overrides it while enabled.
- Size the buffers generously: 4096 vertices was too small for world/sky
  surfaces and silently dropped geometry. 16384 was enough.

### Primitives, types and enums

| Desktop | GLES 1.1 |
|---|---|
| `GL_QUADS` | expand to `GL_TRIANGLES` (0-1-2, 0-2-3) |
| `GL_POLYGON` | `GL_TRIANGLE_FAN` |
| `GL_QUAD_STRIP` | `GL_TRIANGLE_STRIP` |
| `glOrtho` / `glFrustum` | `glOrthof` / `glFrustumf` |
| `glDepthRange` / `glClearDepth` | `glDepthRangef` / `glClearDepthf` |
| `glDrawBuffer` / `glReadBuffer` | gone — no-op them |
| `glPolygonMode` | gone — filled is the only mode |
| `GLdouble` / `GLclampd` | no double precision — typedef to `GLfloat` |
| `GL_INTENSITY` | absent (`LUMINANCE`/`ALPHA`/`RGBA` exist) |
| `GL_COLOR_INDEX`, paletted-texture enums | absent; usually dead code you only need to compile |

### Two bugs that render everything WHITE

**1. `glTexImage2D` internalformat.** GLES requires `internalformat == format`
and a real enum. Desktop code often passes the old component-count shorthand
(`3` for RGB, `4` for RGBA) — in GLES that is `GL_INVALID_VALUE`, so **every
texture upload silently fails** and all geometry renders untextured white. Pass
`GL_RGBA` for both when your data is RGBA.

**2. Ancient multitexture enums.** Code written for `GL_SGIS_multitexture` uses
`TEXTURE0_SGIS = 0x835E` / `TEXTURE1_SGIS = 0x835F`, which are **not** the
ARB/GLES values `GL_TEXTURE0 = 0x84C0` / `GL_TEXTURE1 = 0x84C1`. Passing them
through makes every `glActiveTexture` fail `GL_INVALID_ENUM` and sends lightmap
coordinates to the wrong unit — world surfaces render white while models look
fine. Translate the enums. (GLES 1.1 has multitexture natively; just point the
old function pointers at `glActiveTexture`/`glMultiTexCoord4f`.)

### HUD/2D flicker on a triple-buffered panel

Renderers that skip redrawing static 2D after `vid.numpages` frames assume each
buffer keeps what it was given. A GL back buffer is undefined after a swap, and
this panel is **triple**-buffered, so such a HUD flashes as buffers rotate.
Force the 2D layer to redraw every frame.

### Scaling the HUD/menus without wrecking the 3D

At 1024×768 a 320-unit-wide HUD drawn at 1:1 pixels looks tiny. Do **not** fix
this by running the engine in a smaller virtual coordinate space and scaling
every `glViewport` up — that tiles the screen (the backtile texture in
`SCR_TileClear` smears across it) and has to be reverted.

What works: keep `vid.width/height` as REAL pixels so the 3D path is untouched,
make `vid.conwidth/conheight` a smaller 2D space (half the surface works well),
and have `GL_Set2D` project that over the full viewport:

```c
vid.width  = real_w;  vid.height = real_h;      /* 3D: real pixels   */
scale      = 2;
vid.conwidth = real_w / scale;  vid.conheight = real_h / scale;  /* 2D */
/* in GL_Set2D: */
glOrtho(0, vid.conwidth, vid.conheight, 0, -99999, 99999);
```

Then convert the pure-2D code (status bar, menus, console, 2D `Draw_*`) from
`vid.width/height` to `vid.conwidth/conheight`. **The two spaces meet in exactly
two places, and both must be handled:**

1. The 3D view must reserve `sb_lines * scale` REAL pixels for the status bar
   (`sb_lines` is measured in 2D units), or you get a gap or an overlap at the
   bottom of the view.
2. `SCR_TileClear` draws in 2D but is handed the 3D view rect in real pixels —
   divide it by the scale. Getting this wrong is what smears the backtile
   texture over the screen.

Menus can be magnified further on their own with a modelview transform around
just the menu content (`x' = k·x + cx(1-k)`, `y' = k·y + yoff`), leaving the
full-screen background behind them untransformed.

### Touch overlays belong in REAL pixels

If the app draws on-screen touch controls, draw them under their own ortho in
real pixels, *not* in the scaled 2D space. Touch zones are compared against SDL
mouse coordinates, which are real surface pixels — if the art lives in a
different coordinate system, the buttons are not where the user presses.

Size the artwork from the touch ZONE rather than the source image: art authored
for a 480×320 phone is only ~72px square and looks lost inside the region it
represents on a 1024×768 panel. And if the zones scale, normalise any analog
displacement they produce by the same factor, or a bigger control silently
becomes a more sensitive one.

---

## Debugging technique that actually works

**Find a known-good GL app on the device and diff its call sequence.** Passive
`LD_PRELOAD` shims over `libEGL` and `libSDL` — forwarding every call unchanged
and logging arguments and results — answered in one run what hours of
theorising did not. `com.studio3d.tuxr` (Tux Racer) is a good reference: SDL +
`libGLES_CM`, no EGL, and it gets a native-resolution context.

Keep such shims **passive**. Rewriting arguments underneath SDL to force a
result "works" while telling you nothing, and it left a device with a garbled
low-resolution display.

Two supporting notes:

- **A launcher-launched PDK app's stdout/stderr go nowhere.** Redirect them to
  `/media/internal/<app>.log` as the very first thing in `main`, before anything
  that can fail. Without this none of the above is diagnosable.
- **`main` in `appinfo.json` must be the native binary, not a shell wrapper.**
  The installer writes an LS2 role naming that exact path and the bus matches it
  against `/proc/<pid>/exe`; a wrapper leaves the real process unable to
  register (`No role file for executable ... .bin`), which breaks PDL. Have the
  binary `chdir` to its own directory via `readlink("/proc/self/exe")` instead.

---

## See Also

- `pdk.md` — PDK fundamentals, the 3-layer compositor, the EGL flicker rule
- `pdk-pre-touchpad-porting.md` — binary-patching Pre-era GL games, the
  `requiredMemory` reaping trap
- `game-controllers.md` — evdev input for PDK games, and the 1 Hz hotplug scan
  that costs ~180 ms a second on this hardware and reads as a rendering stall
