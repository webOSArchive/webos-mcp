# nizovn Add-on Packages & Modern PDK Porting

Community member nizovn ported Qt 5, a newer glibc, OpenSSL, and related libraries to webOS as installable packages. This makes it possible to build and run significantly more modern C++/Qt software on original webOS hardware than HP's PDK alone supports. Several community ports (QupZilla browser, VLC media player) use this foundation, which compliments the SDL/PDL support built-into the PDK.

---

## The Package Ecosystem

The following packages must be installed on the device before running any Qt5 app:

| Package ID | Provides | Device Path |
|---|---|---|
| `com.nizovn.glibc` | Modern glibc (replaces webOS's ancient libc) | `/media/cryptofs/apps/usr/palm/applications/com.nizovn.glibc/lib/` |
| `com.nizovn.qt5` | Qt 5.9.7 runtime libraries | `/media/cryptofs/apps/usr/palm/applications/com.nizovn.qt5/lib/` |
| `com.nizovn.qt5qpaplugins` | Qt Platform Abstraction plugins for webOS | same prefix |
| `com.nizovn.qt5sdk` | **The jailer wrapper** — enables Qt5 apps in the sandbox | system-level install |
| `com.nizovn.openssl` | OpenSSL 1.0.2p | `/media/cryptofs/apps/usr/palm/applications/com.nizovn.openssl/lib/` |
| `com.nizovn.cacert` | CA certificates | `/media/cryptofs/apps/usr/palm/applications/com.nizovn.cacert/files/cert.pem` |
| `org.webosinternals.dbus` | D-Bus | system-level |

All of these (plus any extras needed by your app) should be distributed alongside your app as `related-packages/` IPKs, with installation instructions. Users must install them first.

---

## The webOS Jail/Sandbox System

webOS runs PDK apps in a **jail** (sandbox) as the `prisoner` user. By default, an app can only see its own install directory under `/media/cryptofs/apps/usr/palm/applications/` and user storage at `/media/internal`. This means Qt5 and glibc, installed as separate packages, are invisible to your app unless explicitly mounted into the jail.

### How the Jailer Works

The `com.nizovn.qt5sdk` package installs:
1. A wrapper script at `/usr/bin/jailer` that intercepts app launches
2. A jail config at `/etc/jail_qt5.conf` that mounts the external packages into the sandbox

### Triggering the Qt5 Jail

Add a `qt5sdk` section to your `appinfo.json`. The mere **presence** of this key signals the jailer to use `jail_qt5.conf`, which mounts glibc, Qt5, OpenSSL, D-Bus, and other dependencies into the sandbox:

```json
{
  "id": "com.example.myapp",
  "type": "pdk",
  "main": "bin/myapp",
  "qt5sdk": {
    "exports": [
      "QMLSCENE_DEVICE=softwarecontext",
      "QT_QPA_WEBOS_AUTOROTATE=1"
    ]
  },
  "requiredMemory": 150
}
```

### Jail Gotchas

**`main` must point directly to the binary** — not to a shell script. The jailer needs to exec the actual binary.

**Empty exports array breaks the launcher.** Either omit `exports` entirely or include at least one value:
```json
// WRONG — breaks launch
"exports": []

// CORRECT — omit if you have nothing to export
"qt5sdk": {}

// CORRECT — or include at least one value
"qt5sdk": {
  "exports": ["QMLSCENE_DEVICE=softwarecontext"]
}
```

**Jail caching**: webOS caches jail directory structures at `/var/palm/jail/<appid>/`. If you add `qt5sdk` to an app that was previously installed without it, the cached jail won't have the external mounts.

Fix: delete the stale jail and relaunch:
```bash
novacom run file:///usr/bin/jailer -- -N -i com.example.myapp
palm-launch com.example.myapp
```

Verify the jail has the correct mounts:
```bash
novacom run file:///bin/ls /var/palm/jail/com.example.myapp/media/cryptofs/apps/usr/palm/applications/
# Should show: com.nizovn.glibc, com.nizovn.qt5, etc.
```

---

## Cross-Compilation for Qt5 Apps

Qt5 apps use a **hybrid build approach**:
- **Build tools**: Qt 5.15 (`qmake`, `moc`, `rcc`, `uic`) — runs on your host machine
- **Target runtime**: Qt 5.9.7 libraries — what's actually on the device
- **Compiler**: Linaro GCC 4.9.4 (`arm-linux-gnueabi-`)

This works because Qt 5.15 tools are backward-compatible with Qt 5.9.7 for standard Qt features.

### Compiler Flags

```bash
CFLAGS="-march=armv7-a -mtune=cortex-a8 -mfpu=neon -mfloat-abi=softfp -O2"
CXXFLAGS="${CFLAGS} -std=gnu++11"
```

Note: `-march=armv7-a` (not `-mcpu=cortex-a8`) when targeting the Qt5 ecosystem, since Qt5 itself is built for generic ARMv7.

### Linker Flags — The Critical Part

Qt5 apps must link against the nizovn glibc and point to it as the ELF interpreter. The binary on the device must load using nizovn's `ld.so`, not the system one, because the system glibc is too old.

```bash
# Define runtime paths (where libs live on the device at runtime)
APP_RUNPATH="/media/cryptofs/apps/usr/palm/applications/com.example.myapp"
QT5_RUNPATH="/media/cryptofs/apps/usr/palm/applications/com.nizovn.qt5/lib"
GLIBC_RUNPATH="/media/cryptofs/apps/usr/palm/applications/com.nizovn.glibc/lib"
OPENSSL_RUNPATH="/media/cryptofs/apps/usr/palm/applications/com.nizovn.openssl/lib"

LDFLAGS="-L${SDK_DIR}/lib"
LDFLAGS="${LDFLAGS} -L${DEVICE_LIB}"
LDFLAGS="${LDFLAGS} -L${PALM_PDK}/device/lib"
LDFLAGS="${LDFLAGS} -Wl,-rpath-link,${SDK_DIR}/lib"        # for linker resolution
LDFLAGS="${LDFLAGS} -Wl,-rpath,${QT5_RUNPATH}"             # runtime Qt5 path
LDFLAGS="${LDFLAGS} -Wl,-rpath,${GLIBC_RUNPATH}"           # runtime glibc path
LDFLAGS="${LDFLAGS} -Wl,-rpath,${OPENSSL_RUNPATH}"         # runtime OpenSSL path
LDFLAGS="${LDFLAGS} -Wl,--dynamic-linker=${GLIBC_RUNPATH}/ld.so"  # use nizovn ld.so
LDFLAGS="${LDFLAGS} -Wl,--allow-shlib-undefined"
```

The `--dynamic-linker` flag is what makes everything work — it embeds the path to nizovn's `ld.so` in the binary's ELF header. Without it, the OS uses the system `ld.so` which can't find the newer glibc.

### OpenSSL Version — Critical Gotcha

The PalmPDK provides `libcrypto.so.0.9.8` but the device needs `libcrypto.so.1.0.0` (from `com.nizovn.openssl`). The device ships OpenSSL 1.0.0 through nizovn's package, so the binary must link to that version.

**Always verify after build:**
```bash
readelf -d libMyApp.so | grep libcrypto
# Must show: libcrypto.so.1.0.0
# NOT: libcrypto.so.0.9.8  ← this will crash on device
```

To ensure the right version is picked up, place the nizovn OpenSSL libs in the link path **before** `/opt/PalmPDK/device/lib`.

### ABI Compatibility Stubs

When mixing Linaro GCC 4.9 (C++11 ABI) with Qt 5.9.7 (which may have been built with GCC 5+), you may need stub libraries:
- `libctype_stub.so` — provides `_M_widen_init`
- `libqt_resource_stub.so` — provides `qt_resourceFeatureZlib`

These are small stubs that satisfy linker symbols from the newer ABI without pulling in incompatible code.

### qmake Cross-Compilation mkspec

For qmake-based projects, use a custom mkspec that sets the ARM cross-compiler and the Qt5 ARM library paths. The mkspec lives at `sdk/qt5-arm/mkspecs/linux-webos-arm-g++/` in the QupZilla project and is referenced as:

```bash
qmake MyApp.pro -spec linux-webos-arm-g++ \
  "DEFINES+=NO_X11 PORTABLE_BUILD DISABLE_DBUS NO_SYSTEM_DATAPATH"
```

Key mkspec setting to fix OpenGL linking:
```
# In qt_lib_gui_private.pri:
QMAKE_LIBS_OPENGL = -lGLESv2   # was -lGL — wrong for ARM/GLES
```

For Qt 5.15 rcc generating resources compatible with Qt 5.9.7 runtime:
```
QMAKE_RESOURCE_FLAGS += --no-compress --format-version 1
```

---

## GPU Acceleration on the TouchPad (PowerVR SGX540)

The TouchPad GPU is a **PowerVR SGX540** supporting OpenGL ES 2.0. When using Qt5/QtWebEngine:

### Working Chromium GPU Flags

```cpp
// Set before QApplication creation:
qputenv("QTWEBENGINE_CHROMIUM_FLAGS",
    "--use-gl=egl "                          // EGL for OpenGL ES (not direct EGL — see below)
    "--enable-gpu-rasterization "            // GPU page painting
    "--enable-native-gpu-memory-buffers "    // Efficient GPU memory
    "--num-raster-threads=2 "               // Parallel rasterization (dual-core CPU)
    "--disable-background-timer-throttling"  // Responsive JS timers
);
```

### GPU Flags That Break the UI (DO NOT USE)

These flags cause the Qt widget layer (toolbar, navigation bar) to disappear behind web content on the TouchPad. The PowerVR SGX540 doesn't properly support the layer ordering they require:

- `--enable-zero-copy` — breaks layer compositing order
- `--disable-gpu-vsync` — causes rendering/compositing issues
- `--ignore-gpu-blocklist` — forces unsupported GPU features
- `--enable-accelerated-2d-canvas` — affects layer compositing
- `--single-process` — causes the app to hang indefinitely after entering the event loop
- `QSG_RENDER_LOOP=basic` (env var) — breaks Qt widget layer rendering

### Software Rendering Fallback

If GPU issues occur:
```cpp
qputenv("QTWEBENGINE_CHROMIUM_FLAGS",
    "--disable-gpu "
    "--disable-gpu-compositing "
    "--enable-software-rasterizer");
qputenv("QMLSCENE_DEVICE", "softwarecontext");
qputenv("QT_QUICK_BACKEND", "software");
```

---

## Environment Variables for Qt5 Apps

Set these in `main.cpp` before `QApplication` creation, or via `appinfo.json` exports:

```cpp
// Physical screen dimensions (mm) — enables proper DPI calculation
qputenv("QT_QPA_WEBOS_PHYSICAL_WIDTH", "197");
qputenv("QT_QPA_WEBOS_PHYSICAL_HEIGHT", "148");

// Font discovery
qputenv("QT_QPA_FONTDIR", "/usr/share/fonts");

// SSL certificates from nizovn's cacert package
qputenv("SSL_CERT_FILE",
    "/media/cryptofs/apps/usr/palm/applications/com.nizovn.cacert/files/cert.pem");
```

In `appinfo.json` exports:
```json
"exports": [
  "QMLSCENE_DEVICE=softwarecontext",
  "QT_QPA_WEBOS_AUTOROTATE=1",
  "QT_QPA_WEBOS_RIGHT_CLICK_ON_LONG_TAP=1"
]
```

**Important**: `QMLSCENE_DEVICE=softwarecontext` must be in `appinfo.json` exports (not set in code) to take effect before Qt initializes. Do NOT also set `QT_QUICK_BACKEND` in exports — it conflicts.

---

## The Compositor Still Applies — But Differently for Qt

The 3-layer compositor rules from the PDK still apply, but the SDL fix does **not** work for Qt apps:

**SDL and Qt cannot coexist on webOS.** Both try to create EGL contexts and own the display. `SDL_SetVideoMode()` conflicts with Qt's display initialization — even if SDL is initialized first, or using only software surfaces. Do not attempt to use SDL in a Qt app for compositor workarounds.

### Qt Video Rendering — What Works and What Doesn't

When rendering video in a Qt app (e.g., via VLC callbacks), multiple approaches were tested:

| Approach | Performance | Status |
|---|---|---|
| Qt QPainter (VideoWidget) | ~4 FPS | Works, too slow |
| Qt OpenGL widget (GLVideoWidget) | — | Crashes on TouchPad |
| Direct EGL + GLES2 | Fast | Works, touch flicker (same EGL problem as PDK) |
| Direct `/dev/fb0` framebuffer writes | ~20 FPS | Works, layer conflicts with Qt |
| **SDL + GLES (SDLVideoWidget)** | Fast | **Recommended — no flicker** |

The SDL+GLES approach works for the **video widget only** because it doesn't use Qt's windowing for the video surface — just for the surrounding UI. This is different from mixing SDL and Qt at the display initialization level.

### The Triple-Buffered Framebuffer

The TouchPad framebuffer is **triple-buffered**:

```
/dev/fb0 layout:
┌─────────────────┐  yoffset=0     (Page 0)
│   1024 × 768    │
├─────────────────┤  yoffset=768   (Page 1)
│   1024 × 768    │
├─────────────────┤  yoffset=1536  (Page 2)
│   1024 × 768    │
└─────────────────┘
Total virtual size: 1024 × 2304
```

When writing directly to `/dev/fb0`, you **must** query the current `yoffset` before each frame and render into the correct page:

```cpp
struct fb_var_screeninfo vinfo;
ioctl(fbFd, FBIOGET_VSCREENINFO, &vinfo);
unsigned int pageYOffset = vinfo.yoffset;  // 0, 768, or 1536

// Adjust target Y coordinates for the current page
targetY += pageYOffset;

// Clip to current page bounds
if (fbY < (int)pageYOffset || fbY >= (int)(pageYOffset + 768)) continue;
```

Writing to the wrong page produces invisible output or flickering as the display hardware cycles through pages.

### Qt + Framebuffer Layer War

When a Qt app writes directly to `/dev/fb0` for video while Qt paints UI to the same framebuffer, they fight for the same buffer. The approaches that do **not** fix this:
- `Qt::WA_PaintOnScreen`
- `Qt::WA_OpaquePaintEvent` + `Qt::WA_NoSystemBackground`
- Event filters to intercept Qt paint events
- Rendering to all 3 pages simultaneously
- `FBIO_WAITFORVSYNC` before writes
- Hiding the video widget during playback

**Working solution — complete layer separation:**

During video playback, hide all Qt UI widgets (toolbar, title, controls). Render video fullscreen to the framebuffer. When paused, show Qt UI and clear the framebuffer region.

```cpp
connect(videoWidget, &FBVideoWidget::firstFrameReady, this, &MainWindow::hideForPlayback);
connect(player, &VlcMediaPlayer::paused, this, &MainWindow::showForUI);

void MainWindow::hideForPlayback() {
    titleLabel->hide();
    controlsWidget->hide();
}

void MainWindow::showForUI() {
    titleLabel->show();
    controlsWidget->show();
}
```

**Use `firstFrameReady`, not the `playing` signal.** VLC calls `formatCallback` and starts delivering frames **before** emitting `playing`. If you hide UI on `playing`, the user sees a black screen briefly. Fire `firstFrameReady` after the first frame is actually rendered.

**Track playing state to suppress post-pause frames.** VLC may deliver buffered frames after pause is requested. Only render when `m_isPlaying` is true to prevent frames from overwriting the Qt UI after pausing.

---

## PDK App Launch Behavior with Qt

### Killing Qt PDK Apps

**`palm-launch -c` does not work for PDK apps.** Use `killall` via novacom:

```bash
echo "killall myapp" | novacom run file://bin/sh
# or
novacom run file:///bin/sh -- -c 'killall myapp'
```

### Launch Parameters for PDK Apps

PDK apps receive launch parameters via `argv`, not via Luna callbacks like JS apps:

```bash
# Launch with a URL parameter
luna-send -n 1 -f luna://com.palm.applicationManager/launch \
  '{ "id": "com.example.myapp", "params": ["http://example.com"] }'
```

The app receives this as `argv[1]` in JSON array format with escaped slashes:
```
argv[1] = [ "http:\/\/example.com" ]
```

Parse it in `main()`:
```cpp
if (arg.startsWith("[") && arg.contains("\\/")) {
    int first = arg.indexOf('"');
    int last  = arg.lastIndexOf('"');
    QString url = arg.mid(first + 1, last - first - 1);
    url.replace("\\/", "/");   // unescape
    launchUrl = url;
}
```

Use event-driven initialization (wait for a "ready" signal from your window) rather than timers to act on `launchUrl` — initialization time varies and timer-based delays are unreliable.

---

## Running External Binaries (ffmpeg, etc.) via glibc

If your app needs to exec an external binary that also requires nizovn's glibc, you must invoke it through the glibc `ld.so`:

```bash
# Instead of: /path/to/ffmpeg <args>
/media/cryptofs/apps/usr/palm/applications/com.nizovn.glibc/lib/ld.so \
  --library-path /media/cryptofs/apps/usr/palm/applications/com.nizovn.glibc/lib \
  /path/to/ffmpeg <args>
```

From Qt via `QProcess`:
```cpp
QStringList args;
args << "--library-path" << glibcLibPath
     << ffmpegPath
     << ffmpegArguments;
process.start(glibcLdSo, args);
```

---

## Debugging Qt5 Apps on webOS

**stderr does NOT appear in `/var/log/messages` for Qt5 apps.** Use file-based logging:

```cpp
static FILE *g_log = nullptr;
static void logMsg(const char *fmt, ...) {
    if (!g_log)
        g_log = fopen("/media/internal/myapp.log", "a");
    if (g_log) {
        va_list args;
        va_start(args, fmt);
        vfprintf(g_log, fmt, args);
        va_end(args);
        fflush(g_log);
    }
}
```

Log to `/media/internal/` — it persists across relaunches and is accessible via USB.

Check jailer logs for startup failures:
```bash
novacom run file:///bin/sh -- -c 'grep jailer /var/log/messages | tail -20'
novacom run file:///bin/sh -- -c 'grep myapp /var/log/messages | tail -10'
```

### Iteration Workflow

```bash
# Build
make -j4

# Copy binary to staging
cp bin/myapp package-staging/com.example.myapp/bin/

# Package and install
palm-package package-staging/com.example.myapp
palm-install com.example.myapp_1.0.0_all.ipk

# Kill existing instance
echo "killall myapp" | novacom run file://bin/sh
sleep 10

# Launch and wait (Qt5 + Chromium startup is slow)
palm-launch com.example.myapp
sleep 45

# Pull logs
novacom get file://media/internal/myapp.log
```

**Startup timing on the TouchPad:**
- First launch (QtWebEngine/Chromium init): ~45 seconds
- Relaunches: ~35 seconds
- Between kill and relaunch: wait at least 15 seconds

Use `palm-launch` (non-blocking) for iteration scripts, not `palm-run` (which streams stdout and kills the app if the script exits).

---

## See Also

- `webos://knowledge/pdk` — PDK provides PDL, Palm's version of SDL

---

## Reference Projects

- **QupZilla for webOS** — Qt5/QtWebEngine browser, qmake build, GPU acceleration: https://github.com/codepoet80/qupzilla-webos
- **VLC-Qt for webOS** — CMake build, libVLC, framebuffer video rendering, SDL+GLES: https://github.com/webOSArchive/vlc-qt
