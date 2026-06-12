# Luna Services Reference

Apps call built-in system services via the Luna bus using `Mojo.Service.Request` (Mojo) or a `PalmService` kind (Enyo). For writing your own Node.js background services, see `js-services.md`.

```javascript
// Mojo — one-shot
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "open",
    parameters: { target: "http://example.com" },
    onSuccess: function(r) { ... },
    onFailure: function(r) { ... }
});

// Mojo — persistent subscription
this.sub = new Mojo.Service.Request("palm://com.palm.display/", {
    method: "status", parameters: { subscribe: true },
    onSuccess: function(r) { /* called each time state changes */ }
});
// Cancel: this.sub.cancel();

// Enyo — component form
{ name: "svc", kind: "PalmService", service: "palm://com.palm.display/",
  method: "status", subscribe: true, onSuccess: "onDisplayState" }
// Call: this.$.svc.call({});
```

---

## Built-in Services Quick Reference

**P** = privileged (requires app ID starting with `com.palm` — see below).

| Service URI | Method(s) | Purpose | P? |
|---|---|---|---|
| `palm://com.palm.power/timeout` | `set`, `clear` | Alarms / wakeup timers | No |
| `palm://com.palm.audio/systemsounds` | `playFeedback` | Named UI sounds | No |
| `palm://com.palm.keys/audio` | `status` (subscribe) | Volume key events | No |
| `palm://com.palm.keys/media` | `status` (subscribe) | BT media key events | No |
| `palm://com.palm.keys/switches` | `status` (subscribe) | Ringer/slider switch | No |
| `palm://com.palm.vibrate` | `vibrate` | Vibrate device | No |
| `palm://com.palm.applicationManager` | `open` | Launch app or URL | No |
| `palm://com.palm.applicationManager` | `listAllHandlersForUrl` | Query URL handler | No |
| `palm://com.palm.stservice` | `shareData` | Touch2Share send | No |
| `palm://com.palm.downloadmanager/` | `download` | Download file to device | No |
| `palm://com.palm.db/` | `put`, `find`, `del`, `putKind`, `putPermissions` | MojoDB document store | No |
| `palm://com.palm.systemservice/` | `getPreferences` | Read system prefs, time, locale | No |
| `palm://com.palm.audio/system` | `setVolume`, `getVolume` | System (UI) volume | **Yes** |
| `palm://com.palm.audio/ringtone` | `setVolume`, `getVolume` | Ringtone volume | **Yes** |
| `palm://com.palm.display/control` | `setProperty`, `getProperty`, `setState`, `status` | Brightness, display on/off/dim | **Yes** |
| `palm://com.palm.systemservice` | `setPreferences` | Write system prefs (LED, lock alerts) | **Yes** |
| `palm://com.palm.connectionmanager` | `getStatus` | Internet connection state | **Yes** |
| `palm://com.palm.wan/` | `set` | Enable/disable cellular data | **Yes** |
| `palm://com.palm.wifi` | `setstate` | Enable/disable Wi-Fi | **Yes** |
| `palm://com.palm.btmonitor/monitor/` | `radioon`, `radiooff` | Enable/disable Bluetooth | **Yes** |
| `palm://com.palm.applicationManager` | `running`, `listApps`, `close` | Enumerate/kill apps | **Yes** |
| `palm://com.palm.applicationManager` | `addRedirectHandler`, `removeHandlersForAppId` | Register URL handler | **Yes** |
| `palm://org.webosinternals.ipkgservice` | `restartLuna` | Restart Luna window manager | **Yes** |

---

## Privileged Services

Some services refuse calls from apps whose ID does not start with `com.palm` — enforced at the Luna bus level via role files. The call fails silently (`onFailure` fires) for non-privileged apps.

**Workaround:** Community apps that need privileged access use a `com.palm.*` app ID (e.g., `com.palm.webos.myname.myapp`). This is acceptable for homebrew/Preware/AppMuseum distribution; Palm is no longer around to enforce the naming privilege.

```javascript
// Guard privileged calls client-side for a meaningful error
if (Mojo.Controller.appInfo.id.indexOf("com.palm") === 0) {
    // make the privileged call
} else {
    throw new Error("Privileged service requires com.palm.* app ID");
}
```

Note: `indexOf(...) === 0` (starts with), not `!= -1` (contains anywhere).

---

## Privileged Service Reference

### Audio volume

```javascript
// Set system volume (0–100)
new Mojo.Service.Request("palm://com.palm.audio/system", {
    method: "setVolume", parameters: { volume: 75 }
});
// Get: method "getVolume" → { volume: 75 }
// Same API at palm://com.palm.audio/ringtone for ringtone volume
```

### Display brightness and state

See `exhibition.md` for full context on saving/restoring brightness and display state during Touchstone dock sessions. Core calls:

```javascript
// Brightness (0–100)
new Mojo.Service.Request("palm://com.palm.display/control", {
    method: "setProperty", parameters: { maximumBrightness: 80 }
});
// Get: method "getProperty", parameters: { properties: ["maximumBrightness", "timeout"] }

// Display state: "on" | "off" | "dimmed" | "unlock" | "dock"
new Mojo.Service.Request("palm://com.palm.display/control", {
    method: "setState", parameters: { state: "on" }
});
// Get current state: method "status" → { state: "on", active: true }

// Prevent/allow screen sleep (no privilege required — uses stage window properties)
stageController.setWindowProperties({ blockScreenTimeout: true });   // prevent
stageController.setWindowProperties({ blockScreenTimeout: false });  // allow

// Dim the notification LED bar (no privilege required)
stageController.setWindowProperties({ setSubtleLightbar: true });
```

### System preferences

```javascript
// LED blink notifications
new Mojo.Service.Request("palm://com.palm.systemservice", {
    method: "setPreferences", parameters: { BlinkNotifications: true }
});
// Lock-screen alerts
new Mojo.Service.Request("palm://com.palm.systemservice", {
    method: "setPreferences", parameters: { showAlertsWhenLocked: false }
});
```

### Network radios

```javascript
// Wi-Fi
new Mojo.Service.Request("palm://com.palm.wifi", {
    method: "setstate", parameters: { state: "enabled" }  // or "disabled"
});

// WAN/cellular — note inverted logic: disablewan:"off" = WAN enabled
new Mojo.Service.Request("palm://com.palm.wan/", {
    method: "set", parameters: { disablewan: "off" }  // "off"=WAN on; "on"=WAN off
});

// Bluetooth on / off
new Mojo.Service.Request("palm://com.palm.btmonitor/monitor/radioon",
    { parameters: { visible: true, connectable: true } });
new Mojo.Service.Request("palm://com.palm.btmonitor/monitor/radiooff",
    { parameters: {} });
```

### App enumeration and management

```javascript
// List running apps → { running: [{ id, processid, ... }] }
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "running", parameters: {}, onSuccess: callback
});
// List installed apps → { apps: [{ id, title, version, ... }] }
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "listApps", parameters: {}, onSuccess: callback
});
// Kill by process ID
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "close", parameters: { processId: pid }
});
```

### Internet connection status

```javascript
new Mojo.Service.Request("palm://com.palm.connectionmanager", {
    method: "getStatus", parameters: { subscribe: false },
    onSuccess: function(r) {
        // r.isInternetConnectionAvailable — boolean
        // r.wifi.state — "connected" | "disconnected"
        // r.wan.state  — "connected" | "disconnected"
    }
});
```

### URL redirect handlers

Registration and querying of URL redirect handlers (so your app opens instead of the browser for matching URLs) is a **privileged, undocumented API**. See `url-handlers.md` for the complete reference including pattern format, response structure, and the all-or-nothing removal constraint.

### Notification stage (`popupalert`)

Creates a lock-screen-visible overlay — used by alarm apps to force real background execution on TouchPad. See `alarms.md` for context and full usage. Core call:

```javascript
Mojo.Controller.getAppController().createStageWithCallback({
    name: "alarm", lightweight: true, height: 140,
    sound: "assets/silent.mp3", clickableWhenLocked: true
}, function(sc) { sc.pushScene({ name: "alarm", sceneTemplate: "main/alarm-scene" }); },
"popupalert");  // third arg = stage type
```

### Luna restart

```javascript
// Requires com.palm.webos.* ID AND org.webosinternals.ipkgservice installed (via Preware)
new Mojo.Service.Request("palm://org.webosinternals.ipkgservice", {
    method: "restartLuna"
});
```

---

## MojoDB (On-Device JSON Store)

webOS ships MojoDB, accessible via Luna. Kinds (schemas) must be registered with `putKind` before first use.

```javascript
// Register a kind (once, at first run)
new Mojo.Service.Request("palm://com.palm.db/", {
    method: "putKind",
    parameters: { id: "com.example.myapp.item:1", owner: "com.example.myapp",
                  indexes: [{ name: "title", props: [{ name: "title" }] }] }
});

// Put a record
new Mojo.Service.Request("palm://com.palm.db/", {
    method: "put",
    parameters: { objects: [{ _kind: "com.example.myapp.item:1", title: "Test" }] },
    onSuccess: function(r) { /* r.results[0].id */ }
});

// Query
new Mojo.Service.Request("palm://com.palm.db/", {
    method: "find",
    parameters: { query: { from: "com.example.myapp.item:1",
                            where: [{ prop: "title", op: "%", val: "test" }] } },
    onSuccess: function(r) { /* r.results */ }
});

// Delete
new Mojo.Service.Request("palm://com.palm.db/", {
    method: "del",
    parameters: { query: { from: "com.example.myapp.item:1", where: [...] } }
});
```

`op` values: `"="` exact, `"?"` prefix, `"%"` substring, `">"` / `"<"` numeric.

---

## Caller Identity (Why `Invalid permissions` Happens)

When a service stores per-caller data — keymanager rows, mojodb-owned kinds, accountservices credentials — what it remembers is **the LS2 service name the caller registered as**, not a uid or process ID. That name is governed by an LS2 *role file* binding the calling binary's path to a list of allowed names.

Two errors look similar but mean very different things:

| Error | Source | What it means |
|---|---|---|
| `LUNASERVICE ERROR -1027: Invalid permissions for <name>` | the LS2 hub | The calling binary is not allowed to register as `<name>` per its role file. |
| `{"errorText":"db: permission denied", "errorCode":-3963}` | mojodb (or another service) | You're registered fine, but the target service is rejecting your call (e.g. you're trying to read a kind owned by someone else without a `putPermissions` grant). |

If you need to call a system service *as another app* — to read data your app stored, recover from a stuck registration, or migrate state to a new device — the lever is the LS2 role file for `/usr/bin/luna-send`. See `ls2-roles.md` for the full pattern and safety notes.

### Keymanager specifically

`palm://com.palm.keymanager/` returns only rows whose `ownerID` matches the caller's service name. There is no admin override. The only way to read another app's keys is to call as that app via the role-file trick above. The on-disk backing store is `/var/palm/data/keys.db` (plain SQLite), so as a last resort you can read encrypted-at-rest values directly — but if the app wrapped its values further before storing (some do), you'll still need the app's own crypto to decode them.
