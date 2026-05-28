# webOS App Portability: PWA and Cordova

## Overview

Enyo 2.x apps can be distributed as:
1. **webOS IPK** — native package for Palm/HP webOS devices
2. **Android APK** — via Apache Cordova wrapper
3. **Web PWA** — Progressive Web App with service worker + manifest
4. **LuneOS IPK** — open-source webOS fork (same build path as webOS)

The canonical reference implementation is **enyo2-bootplate** (https://github.com/webOSArchive/enyo2-bootplate), which provides the build scaffolding. Production examples: **enyo2-checkmate**, **FeedSpider2**, **webos-papyrus-ereader**.

Enyo 1 apps can be distributed similarily, but require some additional consideration:

- Enyo 1 apps typically expect to find the enyo library on-device
- The Enyo 1 library wasn't bundled for distribution
- Enyo 1 support on modern browsers is compromised (although not unusable)

To support portability, a developer must bundle the Enyo library within the app and update the reference to load it from a relative path, rather than the absolute on-device path.

---

## Multi-Platform Build System

### Directory Structure

```
project/
├── build.sh                  # Master build script
├── cordova-webos.js          # Full Cordova shim for webOS
├── cordova-www.js            # Minimal stub for web builds
├── enyo-app/                 # The actual Enyo 2 app
│   ├── index.html
│   ├── source/
│   ├── enyo/                 # The Enyo library in-use, typically minified
│   ├── lib/
│   └── tools/
│       └── deploy.sh         # Enyo build tool
├── cordova-wrapper/          # Cordova project for Android
│   ├── config.xml
│   ├── package.json          # cordova-android dependency
│   └── www/                  # populated from enyo-app/deploy/
└── bin/                      # Output: .ipk, .apk, .zip
```

### build.sh Pattern

```bash
#!/bin/bash
# Build flags
webOS=0; luneos=0; android=0; www=0; verbose=""

while getopts "wlav" opt; do
    case $opt in
        w) webOS=1 ;;
        l) luneos=1 ;;
        a) android=1 ;;
        v) verbose="-v" ;;
        *) www=1 ;;   # default
    esac
done

mydir="$(cd "$(dirname "$0")" && pwd)"

# webOS build
if [ $webOS -eq 1 ]; then
    cp $mydir/cordova-webos.js $mydir/enyo-app/cordova.js -f
    $mydir/enyo-app/tools/deploy.sh -w $verbose   # -w = package as IPK
    mv $mydir/enyo-app/deploy/bin/*.ipk $mydir/bin/
fi

# LuneOS build (same as webOS with different deploy flags)
if [ $luneos -eq 1 ]; then
    cp $mydir/cordova-webos.js $mydir/enyo-app/cordova.js -f
    $mydir/enyo-app/tools/deploy.sh -w $verbose
    mv $mydir/enyo-app/deploy/bin/*.ipk $mydir/bin/luneos-
fi

# Web/PWA build
if [ $www -eq 1 ]; then
    cp $mydir/cordova-www.js $mydir/enyo-app/cordova.js -f
    $mydir/enyo-app/tools/deploy.sh $verbose      # no -w = just deploy folder
    # Copy to bin/ or serve directly
fi

# Android build
if [ $android -eq 1 ]; then
    cp $mydir/cordova-www.js $mydir/enyo-app/cordova.js -f
    $mydir/enyo-app/tools/deploy.sh $verbose
    cd $mydir/cordova-wrapper
    cordova platform add android 2>/dev/null || true
    cp $mydir/enyo-app/deploy/* $mydir/cordova-wrapper/www -R
    cordova build android
    cp $mydir/cordova-wrapper/platforms/android/app/build/outputs/apk/debug/*.apk $mydir/bin/
fi
```

### The Cordova Shim Swap

The key insight: `cordova.js` is referenced by `index.html` but the actual file is swapped per platform at build time. The app code calls `cordova.*` APIs unconditionally — the shim handles the difference.

**`cordova-www.js`** (web/PWA builds):
```javascript
/* For backward compatibility with legacy webOS, do not modify */
var cordova = {
    platformId: "www"
}
```
This minimal stub prevents ReferenceErrors when app code checks `cordova.platformId`.

**`cordova-webos.js`** (webOS/LuneOS builds):
Full ~2013-era Cordova implementation for legacy webOS. Implements:
- `deviceready`, `pause`, `resume` Cordova events (fired on Luna lifecycle)
- `cordova.exec()` bridge to native
- `cordova.platformId = "webos"`

The file lives in the project root and is copied to `enyo-app/cordova.js` before each build. It is NOT checked in to `enyo-app/` directly.

### Platform Detection at Runtime

```javascript
// Check platform in app code
var isWebOS = (typeof window.PalmSystem !== 'undefined');
var isAndroid = (typeof cordova !== 'undefined' && cordova.platformId === 'android');
var isWeb = (typeof cordova !== 'undefined' && cordova.platformId === 'www');
var isCordova = (typeof cordova !== 'undefined' && cordova.platformId !== 'www');
```

---

## Cordova Android Integration

### `cordova-wrapper/config.xml`

```xml
<?xml version='1.0' encoding='utf-8'?>
<widget id="com.yourapp.cordova.app" version="1.0.0"
    xmlns="http://www.w3.org/ns/widgets"
    xmlns:cdv="http://cordova.apache.org/ns/1.0">
    <name>Your App Name</name>
    <content src="index.html" />

    <!-- Required: allow all navigation and network access -->
    <allow-navigation href="http://*/*" />
    <allow-navigation href="https://*/*" />
    <access origin="*" />

    <!-- Required for HTTP on Android 9+ (API 28+) -->
    <preference name="Scheme" value="http" />
    <platform name="android">
        <edit-config file="AndroidManifest.xml" mode="merge"
            target="/manifest/application">
            <application android:usesCleartextTraffic="true" />
        </edit-config>
    </platform>
</widget>
```

### `cordova-wrapper/package.json`

```json
{
    "name": "your-app-cordova",
    "version": "1.0.0",
    "dependencies": {
        "cordova-android": "^14.0.0"
    }
}
```

Note: enyo2-bootplate uses cordova-android 10.x; newer projects (checkmate) use 14.x. Use 14.x for new projects targeting Android 12+.

### Content Security Policy for Cordova WebView

Add to `enyo-app/index.html`:
```html
<meta http-equiv="Content-Security-Policy"
      content="default-src *; style-src * 'unsafe-inline'; script-src * 'unsafe-inline' 'unsafe-eval'">
```

Enyo 2 uses `eval()` internally for compiled templates. `'unsafe-eval'` is required. This CSP is intentionally permissive for Enyo apps.

### CORS in Android WebView

Android WebView cannot circumvent CORS — it respects the Same-Origin Policy just like a browser. Backend services accessed from Cordova Android must add CORS headers:
```
Access-Control-Allow-Origin: *
```
There is no workaround at the app level; fix the server.

### Android Debugging

```bash
# List connected devices
adb devices

# View logs (filter to your app)
adb logcat | grep -i "chromium\|your-app-id"

# Remote debug via Chrome DevTools
# Navigate to chrome://inspect in Chrome desktop while app is running on device
```

---

## Progressive Web App Infrastructure

### `index.html` PWA Meta Tags

Add to `<head>` in `enyo-app/index.html`:
```html
<!-- PWA Manifest -->
<link rel="manifest" href="manifest.json">

<!-- Theme colors -->
<meta name="theme-color" content="#000000">
<meta name="msapplication-TileColor" content="#000000">

<!-- iOS PWA support -->
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Your App">

<!-- Viewport — NOTE: do NOT add viewport-fit=cover (breaks iOS file picker) -->
<meta name='viewport' content='height=device-height, width=device-width'>

<!-- Favicon chain for all platforms -->
<link rel="icon" type="image/png" sizes="32x32" href="assets/images/icon32.png">
<link rel="apple-touch-icon" sizes="180x180" href="assets/images/icon180.png">
```

**CRITICAL: Do NOT use `viewport-fit=cover`.** It silently breaks the iOS Safari file picker — the `change` event never fires after the user selects a file.

### `manifest.json` Template

```json
{
    "name": "Your App Full Name",
    "short_name": "YourApp",
    "description": "Short description for app stores",
    "start_url": "./index.html",
    "id": "./manifest.json",
    "display": "standalone",
    "orientation": "portrait-primary",
    "theme_color": "#000000",
    "background_color": "#000000",
    "icons": [
        { "src": "assets/images/icon16.png",   "sizes": "16x16",   "type": "image/png" },
        { "src": "assets/images/icon32.png",   "sizes": "32x32",   "type": "image/png" },
        { "src": "assets/images/icon48.png",   "sizes": "48x48",   "type": "image/png" },
        { "src": "assets/images/icon72.png",   "sizes": "72x72",   "type": "image/png" },
        { "src": "assets/images/icon96.png",   "sizes": "96x96",   "type": "image/png" },
        { "src": "assets/images/icon128.png",  "sizes": "128x128", "type": "image/png" },
        { "src": "assets/images/icon144.png",  "sizes": "144x144", "type": "image/png" },
        { "src": "assets/images/icon152.png",  "sizes": "152x152", "type": "image/png" },
        { "src": "assets/images/icon180.png",  "sizes": "180x180", "type": "image/png" },
        { "src": "assets/images/icon192.png",  "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
        { "src": "assets/images/icon256.png",  "sizes": "256x256", "type": "image/png" },
        { "src": "assets/images/icon512.png",  "sizes": "512x512", "type": "image/png" },
        { "src": "assets/images/icon1024.png", "sizes": "1024x1024", "type": "image/png" }
    ],
    "screenshots": [],
    "categories": ["utilities"]
}
```

Cover all sizes from 16px to 1024px. iOS requires icons without transparency (use solid background). Windows tile meta (`msapplication-TileImage`) takes a 144px PNG.

### Service Worker Registration

Add at end of `<body>` in `index.html`:
```html
<script>
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('./serviceworker.js', {
            updateViaCache: 'none'   // CRITICAL: prevents SW self-caching on iOS
        }).then(function(reg) {
            console.log('SW registered:', reg.scope);
        }).catch(function(err) {
            console.log('SW registration failed:', err);
        });
    });
}
</script>
```

### PWA Install Prompt

```html
<script>
var _installPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    _installPrompt = e;
    // Show your "Install App" button
    document.getElementById('install-btn').style.display = 'block';
});

document.getElementById('install-btn').addEventListener('click', function() {
    if (_installPrompt) {
        _installPrompt.prompt();
        _installPrompt.userChoice.then(function(result) {
            _installPrompt = null;
            document.getElementById('install-btn').style.display = 'none';
        });
    }
});
</script>
```

---

## Service Worker

### `serviceworker.js` Template

```javascript
var CACHE_NAME = 'yourapp-v1.0';

// Assets to cache on install
var STATIC_ASSETS = [
    './',
    './index.html',
    './build/enyo.js',
    './build/enyo.css',
    './build/app.js',
    './build/app.css'
    // Add your app's static resources
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        Promise.all([
            caches.open(CACHE_NAME).then(function(cache) {
                return cache.addAll(STATIC_ASSETS);
            }),
            self.skipWaiting()    // Activate immediately
        ])
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        Promise.all([
            // Delete old caches
            caches.keys().then(function(cacheNames) {
                return Promise.all(
                    cacheNames.filter(function(name) {
                        return name !== CACHE_NAME;
                    }).map(function(name) {
                        return caches.delete(name);
                    })
                );
            }),
            self.clients.claim()  // Take control immediately
        ])
    );
});

self.addEventListener('fetch', function(event) {
    var url = event.request.url;

    // CRITICAL: Never intercept the SW file itself — iOS routes SW
    // update checks through the active SW, causing update loops
    if (url.indexOf('serviceworker.js') !== -1) {
        return;  // Fall through to network
    }

    event.respondWith(
        caches.match(event.request).then(function(cached) {
            if (cached) {
                return cached;
            }
            return fetch(event.request).then(function(response) {
                // Dynamically cache images, audio, CSS, JS
                if (response.ok) {
                    var ct = response.headers.get('content-type') || '';
                    if (ct.indexOf('image') !== -1 ||
                        ct.indexOf('audio') !== -1 ||
                        ct.indexOf('css') !== -1 ||
                        ct.indexOf('javascript') !== -1) {
                        var clone = response.clone();
                        caches.open(CACHE_NAME).then(function(cache) {
                            cache.put(event.request, clone);
                            // FIFO cleanup: limit dynamic cache size
                            cache.keys().then(function(keys) {
                                if (keys.length > 100) {
                                    cache.delete(keys[0]);
                                }
                            });
                        });
                    }
                }
                return response;
            });
        })
    );
});
```

### Service Worker Self-Caching Bug (Critical)

**Symptom:** App never updates on iOS; users stuck on old version indefinitely.

**Cause:** iOS Safari routes the SW's own update-check request through the active SW. If the SW caches itself, it returns the cached (old) version to its own update check — the browser thinks there's no new SW.

**Fixes (all three required for full coverage):**

1. **In `serviceworker.js`:** Never match and cache requests to `serviceworker.js` (shown above).

2. **In SW registration:** Use `{ updateViaCache: 'none' }` to bypass HTTP cache for SW script:
   ```javascript
   navigator.serviceWorker.register('./serviceworker.js', { updateViaCache: 'none' });
   ```

3. **Nginx config** (serve SW with no-cache headers):
   ```nginx
   location = /serviceworker.js {
       add_header Cache-Control "no-store, no-cache, must-revalidate";
       add_header Pragma "no-cache";
   }
   ```

---

## webOS API Compatibility (webos-compat.js Pattern)

The canonical approach from webos-papyrus-ereader: put ALL browser shims in a single `webos-compat.js` file that exits immediately on real webOS. Never scatter `if (window.PalmSystem)` checks throughout app code.

### File Structure

```javascript
// webos-compat.js — load AFTER enyo, BEFORE app code
(function() {
    // Exit immediately on real webOS — native APIs are available
    if (window.PalmSystem) { return; }

    // All shims follow...
})();
```

Load order in `index.html`:
```html
<script src="build/enyo.js"></script>
<script src="webos-compat.js"></script>    <!-- after enyo, before app -->
<script src="build/app.js"></script>
```

### API Mapping Table

| webOS / Enyo 1 API | Modern Browser Equivalent | Notes |
|---|---|---|
| `window.PalmSystem` | Not available | Check absence to detect non-webOS |
| `enyo.windows.setWindowProperties({blockScreenTimeout:true})` | `navigator.wakeLock.request('screen')` | Store lock; release on app blur |
| `enyo.windows.addBannerMessage(msg, params, icon)` | DOM toast element | Fixed position, auto-dismiss |
| `enyo.windows.addAlertBannerMessage(msg, params)` | DOM toast (persistent) | Dismiss on tap |
| `window.PalmServiceBridge` | Stub returning `{returnValue:false}` | Async via setTimeout |
| `enyo.kind({name:'PalmService',...})` | Component stub | `.call()`, `.response()`, `.cancel()` no-ops |
| `ApplicationEvents` kind | `window.addEventListener(...)` | focus, blur, orientationchange, resize |
| `enyo.FilePicker` | `<input type="file">` | See iOS gotchas below |
| `palm://com.palm.display/control/setUserTimeout` | `navigator.wakeLock` | — |
| `palm://com.palm.keys/audio/...` | `KeyboardEvent` listeners | VolumeUp/Down = ArrowUp/Down |
| `window.openDatabase()` (WebSQL) | IndexedDB shim | WebSQL removed Chrome 130+ |
| `enyo.fetchAppInfo()` | Sync XHR on `appinfo.json` | Returns parsed JSON |
| Gesture area back button | Hamburger menu + Escape key | `enyo.appMenu.toggle()` |
| `enyo.windows.openWindow()` | `window.open()` | Remove webOS attributes |

### Screen Wake Lock Shim

```javascript
var _wakeLock = null;
enyo.windows.setWindowProperties = function(win, props) {
    if (props.blockScreenTimeout === true) {
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').then(function(lock) {
                _wakeLock = lock;
            }).catch(function(err) {
                console.warn('Wake lock failed:', err);
            });
        }
    } else if (props.blockScreenTimeout === false) {
        if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
    }
};
// Re-acquire on page visibility (wake lock releases on page hide)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _wakeLock !== null) {
        navigator.wakeLock.request('screen').then(function(lock) { _wakeLock = lock; });
    }
});
```

### Toast Notification Shim

```javascript
function _showToast(message, icon) {
    var toast = document.createElement('div');
    toast.style.cssText = [
        'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(0,0,0,0.8)', 'color:#fff', 'padding:12px 20px',
        'border-radius:8px', 'z-index:99999', 'max-width:80vw',
        'font-size:14px', 'pointer-events:none'
    ].join(';');
    if (icon) {
        toast.innerHTML = '<img src="' + icon + '" style="height:1em;margin-right:6px;vertical-align:middle">' + message;
    } else {
        toast.textContent = message;
    }
    document.body.appendChild(toast);
    setTimeout(function() {
        if (toast.parentNode) { toast.parentNode.removeChild(toast); }
    }, 3000);
}
enyo.windows.addBannerMessage = function(message, launchParams, icon) {
    _showToast(message, icon);
};
```

### PalmServiceBridge Stub

```javascript
window.PalmServiceBridge = function() {
    this.onservicecallback = null;
};
PalmServiceBridge.prototype.call = function(url, params) {
    var self = this;
    var cb = self.onservicecallback;
    setTimeout(function() {
        if (cb) { cb(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Not on webOS' })); }
    }, 0);
};
PalmServiceBridge.prototype.cancel = function() {};
```

### ApplicationEvents Shim

```javascript
enyo.kind({
    name: 'ApplicationEvents',
    kind: enyo.Component,
    published: {
        onWindowActivated: '',
        onWindowDeactivated: '',
        onApplicationRelaunch: '',
        onWindowRotated: ''
    },
    create: function() {
        this.inherited(arguments);
        var self = this;
        this._onFocus = function() { if (self.onWindowActivated) self.waterfall(self.onWindowActivated); };
        this._onBlur  = function() { if (self.onWindowDeactivated) self.waterfall(self.onWindowDeactivated); };
        this._onRotate = function() { if (self.onWindowRotated) self.waterfall(self.onWindowRotated); };
        window.addEventListener('focus', this._onFocus);
        window.addEventListener('blur', this._onBlur);
        window.addEventListener('orientationchange', this._onRotate);
        window.addEventListener('resize', this._onRotate);
    },
    destroy: function() {
        window.removeEventListener('focus', this._onFocus);
        window.removeEventListener('blur', this._onBlur);
        window.removeEventListener('orientationchange', this._onRotate);
        window.removeEventListener('resize', this._onRotate);
        this.inherited(arguments);
    }
});
```

### FilePicker Shim

```javascript
enyo.kind({
    name: 'enyo.FilePicker',
    kind: enyo.Component,
    published: {
        onPickFile: ''
    },
    // CRITICAL: opacity:0, NOT display:none — iOS suppresses change event on hidden inputs
    // CRITICAL: do NOT set viewport-fit=cover in viewport meta — breaks iOS file picker
    _createInput: function() {
        var input = document.createElement('input');
        input.type = 'file';
        input.style.cssText = 'position:absolute;top:-1000px;left:-1000px;opacity:0;width:1px;height:1px';
        document.body.appendChild(input);
        return input;
    },
    pickFile: function() {
        var self = this;
        // Modern File System Access API (Chrome 86+, Safari 15.2+)
        if (window.showOpenFilePicker) {
            window.showOpenFilePicker().then(function(handles) {
                handles[0].getFile().then(function(file) {
                    self.waterfall(self.onPickFile, { file: file, name: file.name });
                });
            }).catch(function() {});
            return;
        }
        // Fallback: hidden input
        var input = self._createInput();
        input.addEventListener('change', function() {
            if (input.files && input.files[0]) {
                self.waterfall(self.onPickFile, { file: input.files[0], name: input.files[0].name });
            }
            document.body.removeChild(input);
        });
        input.click();
    }
});
```

### WebSQL → IndexedDB Shim

WebSQL was removed in Chrome 130 (2024) and was never in Firefox. Enyo 1 apps that call `window.openDatabase()` need this shim.

```javascript
if (typeof window.openDatabase === 'undefined') {
    window.openDatabase = function(name, version, displayName, estimatedSize) {
        return new _WebSQLDB(name);
    };
}

function _WebSQLDB(name) {
    this._name = name;
    this._db = null;
    var req = indexedDB.open(name, 1);
    req.onupgradeneeded = function(e) { /* tables created via SQL CREATE TABLE */ };
    req.onsuccess = function(e) { this._db = e.target.result; }.bind(this);
}

_WebSQLDB.prototype.transaction = function(callback, errorCallback, successCallback) {
    // Provide _WebSQLTransaction to callback
};
_WebSQLDB.prototype.readTransaction = _WebSQLDB.prototype.transaction;

// SQL patterns handled by shim:
// PRAGMA ... → no-op
// CREATE TABLE IF NOT EXISTS → objectStore creation on upgrade
// INSERT OR REPLACE → store.put()
// DELETE FROM table WHERE id=? → store.delete(key)
// DELETE FROM table → store.clear()
// SELECT * FROM table WHERE id=? → store.get(key)
// SELECT * FROM table → store.getAll()
// UPDATE ... SET → store.get() then store.put()
// DROP TABLE → deleteObjectStore (on upgrade only)
```

Note: The shim cannot handle complex SQL (JOINs, GROUP BY, etc.). Apps that use complex queries need refactoring.

### `enyo.fetchAppInfo()` Shim

```javascript
enyo.fetchAppInfo = function(successCallback, failureCallback) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'appinfo.json', false);  // synchronous — matches webOS behavior
    try {
        xhr.send();
        var info = JSON.parse(xhr.responseText);
        if (successCallback) { successCallback(info); }
        return info;
    } catch(e) {
        if (failureCallback) { failureCallback(e); }
        return {};
    }
};
```

---

## Enyo 1 Flexbox Compatibility Fixes

Enyo 1 (device-bundled) used an old WebKit flex model. Modern browsers implement CSS Flexbox (2012 spec). Two fixes required in the framework internals:

### Fix 1: `flowExtent()` Must Use `flex-grow`

The old code wrote `flex: N` which modern browsers interpret as `flex-grow: N; flex-shrink: 1; flex-basis: 0%`. The `flex-basis: 0%` collapses elements.

```javascript
// In enyo's layout code, find flowExtent or equivalent:
// BAD (old webKit):
node.style.flex = extent;        // sets flex-basis:0% — collapses element
node.style.webkitFlex = extent;

// GOOD (modern):
node.style.flexGrow = extent;    // only sets grow factor
node.style.webkitFlexGrow = extent;
```

### Fix 2: Remove `width: 0px` Inline Style

Old Enyo layout wrote `width: 0px` on flex children expecting WebKit to override it. Modern browsers honor it and collapse the element.

```javascript
// Remove the width:0px assignment entirely:
// BAD:
node.style.width = '0px';

// GOOD: omit entirely, or:
node.style.width = '';
```

### Fix 3: SlidingPane / Split Panel Layout

```css
/* Prevent left panel from shrinking */
.library-panel {
    flex-shrink: 0;
}

/* Allow right content panel to shrink below its content size */
.content-panel {
    min-width: 0;
}
```

### Fix 4: Toolbar Layout

```css
/* Fix toolbar height when buttons shrink */
.bottom-row-controls {
    box-sizing: border-box;
}
```

---

## iOS Safari Gotchas

### 1. File Picker Broken by `viewport-fit=cover`

**Symptom:** User selects a file, `change` event never fires.
**Cause:** `viewport-fit=cover` in `<meta name="viewport">` silently suppresses the `change` event on iOS Safari.
**Fix:** Remove `viewport-fit=cover` from the viewport meta tag entirely.

### 2. Hidden File Input Breaks Change Event

**Symptom:** File picker `change` event doesn't fire.
**Cause:** `display:none` or `visibility:hidden` on `<input type="file">` suppresses the change event on iOS Safari.
**Fix:** Use `opacity:0` with `position:absolute; top:-1000px` instead.

```css
/* WRONG */
input[type=file] { display: none; }

/* CORRECT */
input[type=file] {
    position: absolute;
    top: -1000px;
    left: -1000px;
    opacity: 0;
    width: 1px;
    height: 1px;
}
```

### 3. Popup Immediate Dismissal (Chrome 56+ / iOS Safari 15.4+)

**Symptom:** Tap a button to open a popup; popup appears and immediately closes.
**Cause:** Modern browsers synthesize a `mousedown` + `click` sequence after a touch event. The popup registers an `onmousedown` handler during creation, and the synthesized `mousedown` (with `isTrusted === true`) immediately triggers popup dismissal logic.
**Fix:** In `BasicPopup.mousedownHandler` or equivalent, guard against events that occurred during or immediately after popup creation:

```javascript
mousedownHandler: function(sender, event) {
    // Ignore trusted mouse events fired within 500ms of popup creation
    // These are browser-synthesized events from the touch that opened us
    if (event.isTrusted && (Date.now() - this._openedAt) < 500) {
        return true;  // consume, don't dismiss
    }
    // Normal dismissal logic
    if (!this.isDescendantOf(event.target)) {
        this.hide();
    }
},
create: function() {
    this.inherited(arguments);
    this._openedAt = Date.now();
}
```

### 4. iOS Bounce / Scroll Prevention

```javascript
// Prevent rubber-band scrolling on iOS (common for full-screen apps)
document.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) { e.preventDefault(); }
}, { passive: false });

document.addEventListener('touchmove', function(e) {
    if (e.target === document.body || e.target === document.documentElement) {
        e.preventDefault();
    }
}, { passive: false });
```

---

## FeedSpider2: Multiple Entry Points

FeedSpider2 maintains separate entry points for webOS vs. web:

- **`index.html`** — web/PWA entry point (standard Enyo bootstrap)
- **`index-webos.html`** — webOS-specific entry point using `webOSWindowManager` kind and `window.open()` with webOS window attributes for multi-window support

This avoids runtime branching for platform-specific window management while sharing all other app code.

```javascript
// index-webos.html: webOS multi-window launch
enyo.kind({
    name: 'App',
    kind: 'webOSWindowManager',
    // webOS-specific window management
    openWindow: function(params) {
        window.open('window.html', '_blank', 'attributes=' + JSON.stringify(params));
    }
});
```

---

## Build Prerequisites

Same as Enyo 2.5 general builds (see enyo2.md):
- **Node.js 14.x** (newer Node breaks Grunt + deploy.js build chain)
- **Oracle JDK 8** for palm-package (checks "java version" string format; OpenJDK format fails)
- **Apache Cordova** (installed globally via npm) for Android builds
- **Android SDK** with platform-tools and build-tools for Android APK

```bash
# Install Cordova globally
npm install -g cordova

# Or use local Cordova from cordova-wrapper
cd cordova-wrapper
npm install
npx cordova build android
```

---

## Migration Checklist: webOS App → PWA

1. **Bundle Enyo locally** — do not rely on CDN; SW can only cache same-origin assets
2. **Copy `cordova-www.js`** to `enyo-app/cordova.js` for web builds
3. **Create `webos-compat.js`** with all API shims; load after Enyo, before app code
4. **Add `manifest.json`** with full icon set (16px–1024px)
5. **Add `serviceworker.js`** — never cache `serviceworker.js` itself
6. **Register SW** with `{ updateViaCache: 'none' }`
7. **Add nginx `no-store` header** for `serviceworker.js`
8. **Add PWA meta tags** to `index.html` — omit `viewport-fit=cover`
9. **Add PWA install prompt** handler (`beforeinstallprompt`)
10. **Fix Enyo 1 flex** — `flex-grow` not `flex`, remove `width:0px` (if using Enyo 1)
11. **Fix iOS file picker** — `opacity:0` not `display:none`
12. **Fix popup dismissal** — `isTrusted` + timestamp guard
13. **Test WebSQL** — shim or refactor if Chrome 130+ support needed
14. **Add CSP header** for Cordova WebView compatibility
15. **CORS-enable backend services** for Android WebView

---

## See Also

- `webos://knowledge/tls-and-networking` — TLS limitations on webOS; SSL-bump proxy setup for device testing
- `webos://knowledge/enyo2` — Enyo 2.x framework reference for the code inside the multi-platform build
