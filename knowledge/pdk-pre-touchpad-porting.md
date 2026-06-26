# Porting Pre PDK Games to the TouchPad

Many Palm Pre PDK games (native C/C++ apps built with the Plug-in Development Kit) will *install* on the HP TouchPad with nothing more than a `metadata.json` device patch — but then render garbled, monochrome, mis-sized, or not at all. The cause is almost always one of two things: the game hardcodes Pre assumptions (a 320×480 surface, a single ~600 MHz core), or it relies on lenient behavior in the Pre's PowerVR SGX GL driver that the TouchPad's stricter, more spec-conformant Qualcomm Adreno driver (`/dev/kgsl-3d0`) refuses to replicate.

A third, easily-misread failure mode has nothing to do with graphics at all: the game's declared **memory budget**, tuned for the Pre, is too small for the TouchPad's larger framebuffer, so the game gets reaped when real gameplay loads — *looking* like a graphics crash. That one is `appinfo.json`-only and is covered in its own section below.

This is a field guide for diagnosing and fixing those ports by **binary-patching the shipped `.ipk`** — and, when static analysis stalls, by **tracing the running game's OpenGL calls over USB**. Several of the fixes (memory budget, device gating) need no binary changes at all and stay fully Pre-compatible.

> **Worked examples:** Gameloft's *DRIVER* (2010) shipped garbled and unplayable on the TouchPad — root cause was a per-frame depth-buffer clear the Adreno driver correctly treats as a no-op (see below); fixed and given MSAA/32-bit color/anisotropic filtering entirely by binary patching. EA's *Monopoly* went black the instant the board loaded — a pure memory-quota problem fixed by one `appinfo.json` number. EA's *Tiger Woods PGA Tour* got the graphics lift as a single **universal** build that's enhanced on the TouchPad and falls back cleanly on the Pre.

---

## Instrument on-device early; don't guess from the disassembly

The single biggest time sink is reverse-engineering a Glide-over-GLES wrapper statically and guessing at runtime behavior. A disassembly cannot show you the GL *state* that actually matters — e.g. the value of `glDepthMask` at the moment of a `glClear`. If you have a TouchPad on `novacom`, build a GL tracer in the first hour. The DRIVER port took ~11 blind attempts before a 10-line trace made the bug obvious.

**Jailed apps can't be ptraced** (capabilities are stripped), so `gdb`/`strace` are useless for inspecting GL. Use an **`LD_PRELOAD` OpenGL interposer** instead — it works because it's resolved at link time, not via the debugger:

```c
/* gltrace.c — log + forward the GL calls that matter */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <unistd.h>
typedef unsigned int GLbitfield; typedef unsigned char GLboolean;
static void* nxt(const char*n){ return dlsym(RTLD_NEXT,n); }
static void log_(const char*s){ int fd=open("/media/internal/gltrace.log",O_WRONLY|O_CREAT|O_APPEND,0666);
                                if(fd>=0){ write(fd,s,/*len*/0); close(fd);} }
void glClear(GLbitfield m){ static void(*r)(GLbitfield); if(!r)r=nxt("glClear");
                            /* log m here */ r(m); }
void glDepthMask(GLboolean f){ static void(*r)(GLboolean); if(!r)r=nxt("glDepthMask");
                               /* log f here */ r(f); }
/* ...also glClearDepthf, glDepthFunc, glScissor, glViewport; mark frames at SDL_GL_SwapBuffers */
```

**Compile with the PalmPDK's own toolchain**, not the host's modern cross-compiler:

```bash
/opt/PalmPDK/arm-gcc/bin/arm-none-linux-gnueabi-gcc \
    -std=gnu99 -mfloat-abi=softfp -shared -fPIC -O2 -o gltrace.so gltrace.c -ldl
```

GCC 4.3.3 in the PDK links against the device's old glibc (2.4). A modern `arm-linux-gnueabi-gcc` pulls in `GLIBC_2.34` symbols, and the `.so` simply won't load on-device.

**Inject the preload with a tiny launcher** set as the app's `main` (`driver/driver`), which sets `LD_PRELOAD` and `execv`s the real binary (renamed to `driver.bin`). This is targeted to one app, touches no system files, and is trivially reversible:

```c
int main(int argc,char**argv){
    setenv("LD_PRELOAD","/media/internal/gltrace.so",1);
    execv("/media/cryptofs/apps/usr/palm/applications/<id>/driver/driver.bin",argv);
    return 1;
}
```

> **Trace only — never ship via the launcher.** Running a PDK game through the `execv` launcher / `LD_PRELOAD` path produces a washed-out, over-white render (a webOS PDK quirk). Use it to *observe*; always bake the actual fix into the binary.

---

## Fast iteration loop

Skip the repackage/install/reboot cycle. Force-push the patched binary straight into the (already-installed) app directory and drop the cached jail:

```bash
# TouchPad apps install under /media/cryptofs/apps/..., NOT /usr/palm/applications/
novacom put file:///media/cryptofs/apps/usr/palm/applications/<id>/driver/driver < ./driver
novacom run file:///usr/bin/jailer -- -N -i <id>     # discard the cached jail; next launch uses the new binary
```

`novacom run` word-splits its command argument (and `novacom run 'cmd'` returns "unknown command"), so for anything non-trivial write a script locally, push it, and run it:

```bash
novacom put file:///tmp/x.sh < x.sh
novacom run file:///bin/sh -- /tmp/x.sh
```

> **The stale-code trap.** Same-version reinstalls plus PDK jail caching make the device silently keep running old code, so two different builds look identical on screen. Always either bump the version (`control` `Version:` **and** `appinfo.json` `"version"`) or force-push + clear the jail — then confirm with `md5sum` on the device against your local build. If two builds look the same, suspect this first.

---

## Symptom → cause map

The TouchPad's Adreno driver enforces the GL spec where the Pre's SGX driver was forgiving. Most "worked on Pre, broken on TouchPad" rendering bugs fall into these buckets:

| On-screen symptom | Likely cause | Fix |
|---|---|---|
| Garbled / black-and-white / wrong-size at startup | App got a **non-native GL surface** (Pre games hardcode 320×480) | Patch `SDL_SetVideoMode` to native resolution (or pass `0,0` = desktop mode) |
| **Static world black; only *moving* things visible; spinning the camera reveals everything** | The **depth buffer is never actually cleared** — `glClear(GL_DEPTH_BUFFER_BIT)` is a no-op while `glDepthMask` is `FALSE`, and the game clears with the mask off | Force `glDepthMask(GL_TRUE)` **at the clear only** (not globally — that breaks transparency passes and over-occludes) |
| See-through geometry / wrong draw order | Depth test disabled or broken | Fix depth properly; don't paper over it with `glDepthFunc(GL_ALWAYS)` (that disables sorting) |
| Colors banded, especially gradients | 16-bit (RGB565) color buffer | Request `RED/GREEN/BLUE/ALPHA = 8` via `SDL_GL_SetAttribute` |
| Jagged edges | No anti-aliasing | Request `MULTISAMPLEBUFFERS=1`, `MULTISAMPLESAMPLES=4` |
| Menus fine, then **black or a "crash" the instant gameplay/the level loads** | The game exceeds its `appinfo.json` `requiredMemory` quota — the TouchPad's larger framebuffer pushes peak RAM over a Pre-tuned budget, and webOS reaps it (looks like a graphics crash; it isn't one) | Raise `requiredMemory` — see the memory section below. **Not** a GL fix |

The depth-clear-no-op is the subtle one and the reason on-device tracing is worth it: the per-frame trace shows `glClear(0x4100)` issued immediately after `glDepthMask(0)`, which a disassembly will never make obvious.

---

## When the black screen is memory, not graphics

Not every black screen is a render bug. A very common one: the **menus work, then the screen goes black (or the app "crashes") the moment real gameplay loads**. This is almost always the game blowing past its declared memory budget — fine on the Pre, but the TouchPad's larger framebuffer (a 1024×768-class surface vs the Pre's 320×480) raises peak RSS over the limit, and webOS's MemoryMonitor reaps the process.

**Diagnose it from the log, no GL trace needed.** `grep -iE 'exceeded its memory quota|childProcessDied|processRemoved' /var/log/messages`. The smoking gun is a line like:

```
MemoryMonitor: Monitored native process #807 exceeded its memory quota. ProcMem = 71, restriction = 67
```

`restriction = N` **is** the app's `appinfo.json` `requiredMemory`. The death then logs as `childProcessDied ... status 0` — a clean exit, *not* a `SIGSEGV`, so don't go hunting for a "received 11" crash; there isn't one.

**Fix:** raise `requiredMemory` in `appinfo.json` above the observed peak. The binary is untouched, so it stays fully Pre-compatible. Keep the bump modest — the original 256 MB Pre checks free RAM against `requiredMemory` *at launch*, so don't go huge. (Monopoly: shipped at 67, peaked ~80 on the TouchPad, set to 100 — worked on both a 256 MB-class Pre and the TouchPad.) This is the rare fix that's `appinfo`-only, needs no binary patch, and stays a single universal build.

> **Gotcha applying it for a live test:** editing the *installed* `appinfo.json` and calling `applicationManager/rescan` does **not** refresh the live quota — LunaSysMgr keeps the cached value, and you'll keep seeing the old `restriction=` across relaunches. **Restart Luna** (`restart LunaSysMgr`, or `killall LunaSysMgr` — upstart respawns it) to make the new `requiredMemory` take effect. For a real install it's moot (the installer reads `appinfo` fresh), though a freshly-installed PDK app sometimes needs a device reboot before its jail/descriptor goes fully live the first time.

---

## Binary-patching mechanics

- These binaries are usually **not stripped** — `arm-linux-gnueabi-objdump -d` yields full symbol names. File offset = **VMA − 0x8000** (the first r-x `LOAD` segment).
- Gameloft Pre ports commonly run a **Glide→GLES1 wrapper**: look for `ogles_Sst*` symbols and `gr*` function pointers in BSS (called indirectly, so direct cross-references read as 0). It's GLES1 fixed-function.
- Prefer **length-preserving byte patches inside the gzipped `data.tar`**: `gunzip`, seek to the member's data offset (Python `tarfile` exposes `member.offset_data`), patch, `gzip`. Reuse the original `debian-binary` and `control.tar.gz` untouched. The archive is `ar` (`debian-binary`, `control.tar.gz`, `data.tar.gz`); the tar is ustar with absolute paths, owner `root/wheel` (0/0), and the binary stored mode `0644` (PDK binaries don't need the execute bit).
- **Code caves:** there is no safe zero-gap in `.text`/`.rodata` — every long zero run is a *live, indexed* data table (lookup tables, font tables), and a reference scan for `movw`/`movt`/word-pointers will *not* catch indexed access, so "zero references" is a false negative. The usable cave is **`.ARM.extab` / `.ARM.exidx`** (the C++ exception-unwind tables): they sit in the executable `LOAD` segment but are dead in the gameplay hot path. Verify stability by actually playing on-device.
- **To add GL calls** (e.g. the depth-mask fix, MSAA, or anisotropy), redirect one existing `bl <fn>` to a stub in the cave that performs the original call plus the extras and returns. Verify the stub with `objdump -D` (capital `D` disassembles data sections too).

---

## Repackaging for release

- **App-id rename** (to avoid clashing with the Pre version): the binary usually does *not* embed its own id, so change only `appinfo.json`'s `id`/`title`, the install path inside `data.tar`, and `control`'s `Package:`. Distinct ids let the Pre original and the TouchPad build coexist.
- **TouchPad gating:** add `metadata.json` `{"version":1,"devices":[101]}` in the app directory (it's additive — a well-behaved app that does screen-size detection still runs on phones).
- Install via **Preware** or **WebOS Quick Install**, not `palm-install` (those run the package's control scripts as root and honor the device metadata).

---

## Graphics upgrades (the TouchPad has GPU headroom to spare)

The Adreno 220 dwarfs the Pre's SGX, so era-appropriate enhancements are cheap to add via the cave-stub technique:

- **4× MSAA + 32-bit color:** redirect the game's single `SDL_GL_SetAttribute` call to a stub that also issues `MULTISAMPLEBUFFERS=13`/`MULTISAMPLESAMPLES=14` and `RED/GREEN/BLUE/ALPHA=8`, before `SDL_SetVideoMode`. Prove the EGL config exists by testing once via the interposer before baking it in.
- **Anisotropic filtering:** `glTexParameterf(GL_TEXTURE_2D, GL_TEXTURE_MAX_ANISOTROPY_EXT /*0x84FE*/, 4.0)`, hooked into the wrapper's filter routine (e.g. `ogles_TexFilterMode`). It only does anything on textures that use linear filtering.
- **Caveat:** if the 3D renders at a small internal resolution that the compositor upscales (DRIVER renders 320×480), MSAA/anisotropy gains are muted — true native-resolution rendering is the bigger win, but a much harder one, since the HUD layout, touch input, and projection are all built around the small size.

---

## One universal IPK: enhance on TouchPad, fall back on Pre

When the lift isn't worth a separate release, you can ship **one** `.ipk` that's enhanced on the TouchPad and safe on the Pre. The trick is to gate the *risky* part with a **capability probe, not a device check**.

Only one upgrade is actually Pre-risky: **MSAA + 32-bit color**, because the Pre's GPU may have no such EGL config and a failed `SDL_SetVideoMode` is a black screen. Gate it like this, in the SetVideoMode cave stub:

1. Stash the real `SDL_SetVideoMode` args (e.g. in r4–r7).
2. Request the HD config (the extra `SDL_GL_SetAttribute` calls) and call `SDL_SetVideoMode`.
3. `cmp r0, #0` — if it returned **NULL**, reset the attributes to the stock config (`RED/GREEN/BLUE/ALPHA = 5/6/5/0`, `MULTISAMPLEBUFFERS/SAMPLES = 0`) and call `SDL_SetVideoMode` again.
4. Return `r0`.

The TouchPad takes the HD config; the Pre's NULL triggers the retry and gets its original config. This uses **only already-imported calls** (`SDL_SetVideoMode`, `SDL_GL_SetAttribute`), so there's no need to add a dynamic import.

> The PDK *documents* proper detection — `PDL_GetHardwareID()` and `PDL_GetScreenMetrics()` — but a game usually doesn't *import* them, and you can't add a dynamic import with a length-preserving binary patch (`.dynsym`/`.rel.plt`/PLT/GOT are fixed-size). The capability probe sidesteps that entirely and is more robust than a hardware whitelist — it works on any GPU, not just the ones in a 2011 enum.

The low-risk upgrades — **trilinear** (standard GLES1) and **anisotropy** (clamps to the GPU's max, or is a `GL_INVALID_ENUM` no-op if the extension is absent) — can stay unconditional. They're not just harmless on the Pre's SGX; they actually *work* there, so the Pre gets a small filtering lift too.

**Validate the fallback without a Pre:** build a throwaway variant whose first request is impossible (e.g. `MULTISAMPLESAMPLES=64`) to force the fallback branch on the TouchPad. If the game renders (jaggy, no MSAA) instead of going black, the retry path is proven on real hardware.

Ship it under the **original** app id (not a separate `*hd` id), bump the version, keep the additive `metadata.json` — one build for Pre and TouchPad. (*Tiger Woods PGA Tour* shipped this way: HD on the TouchPad, stock-plus-filtering on the Pre, from a single `.ipk`.)

---

## See Also

- `webos://knowledge/pdk` — PDK fundamentals: toolchain, PDL/SDL, the 3-layer compositor, packaging
- `webos://knowledge/sdk-tools` — `novacom`, `luna-send`, `palm-package`, force-pushing files
- `webos://knowledge/gotchas` — jails, the web/jail caching trap, BusyBox quirks, `luna-send` stdout/stderr
- `webos://knowledge/system-internals` — jails as partial namespaces, why ptrace fails on jailed processes, debug-info-rich binaries, binary-patching tricks
- `webos://knowledge/nizovn-packages` — the jailer, clearing a stale jail, modern ARM cross-compilation for the device
- `webos://knowledge/postinst-packaging` — `.ipk` `ar`/tar structure and repacking
