# webOS System Features

## Exhibition Mode (Touchstone Dock)

Apps opt in with `"dockMode": true` in `appinfo.json` and appear in the Exhibition preferences list. When the device is placed on the Touchstone, the app is (re)launched with `params.dockMode === true`. Full implementation details — brightness management, the `stageDeactivated` lifecycle bug, TouchPad workarounds, UTC alarm scheduling — are in `exhibition.md`.

---

## Just Type (Universal Search)

Just Type activates when the user starts typing from the Card or Launcher view. Apps integrate via `appinfo.json`:

```json
{
    "universalSearch": {
        "action": {
            "displayName": "Add New Contact",
            "url": "com.example.myapp",
            "launchParam": "addItem"
        },
        "search": {
            "displayName": "Search My App",
            "url": "com.example.myapp",
            "launchParam": "query"
        },
        "dbsearch": {
            "displayName": "My App Records",
            "url": "com.example.myapp",
            "launchParam": "itemId",
            "launchParamDbField": "_id",
            "displayFields": ["title", "subtitle"],
            "dbQuery": {
                "from": "com.example.myapp.item:1",
                "where": [{ "prop": "title", "op": "%", "val": "" }],
                "orderBy": "title",
                "limit": 20
            }
        }
    },
    "keywords": ["myapp", "example"]
}
```

| Key | Just Type label | Launched with |
|-----|----------------|--------------|
| `action` | Quick Actions | `launchParam` string |
| `search` | Search Using | user-typed text |
| `dbsearch` | Launch (content) | selected record's ID |

**`launchParam` for `search`:** A string names the property; an object with `"#{searchTerms}"` gets the placeholder replaced with typed text.

**`op` values:** `"?"` prefix, `"%"` substring, `"="` exact.

**`keywords`:** App appears in Just Type when user types any of these words.

**`dbsearch` requires granting the launcher read access** to your db8 kind (call once after registering the kind):

```javascript
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "putPermissions",
    parameters: {
        permissions: [{
            "type": "db.kind",
            "object": "com.example.myapp.item:1",
            "caller": "com.palm.launcher",
            "operations": { "read": "allow" }
        }]
    }
});
```

**Handling Just Type launches (Mojo):**

```javascript
AppAssistant.prototype.handleLaunch = function(params) {
    if (params.addItem)      this.controller.pushScene("new-item");
    else if (params.query)   this.controller.pushScene("search", { query: params.query });
    else if (params.itemId)  this.controller.pushScene("detail", { id: params.itemId });
};
```

> **User opt-in required:** Each category (Actions, Search Using, Content) must be enabled by the user in Settings → Just Type. Your app doesn't appear automatically.

---

## `noWindow: true` — Hidden Background Window

```json
{ "noWindow": true }
```

Makes the initial app window permanently hidden — no card is shown. Use for apps that manage background state, dashboards, and notifications without a primary card UI.

**Mojo:** All scenes share one JS context in the hidden window — efficient.

**Enyo:** Each window (card, dashboard, popup) loads the framework **independently**. Only `enyo.application` is shared. The hidden window's `index.html` should load only background logic, no UI components:

```
index.html (hidden)  → app/Global.js, app/Monitor.js   (no UI kinds)
card.html            → full UI
dashboard.html       → dashboard UI
```

Relaunch arguments always arrive at the hidden window.

**Creating windows from the hidden window (Enyo):**

```javascript
enyo.windows.openWindow("card.html", "main", { windowType: "card" });
enyo.windows.openWindow("dashboard.html", "dash", { windowType: "dashboard" });

// Guard against opening a window that already exists:
if (!enyo.windows.fetchWindow("main"))
    enyo.windows.openWindow("card.html", "main", { windowType: "card" });
```

---

## Background Applications and Dashboard

### Detecting foreground/background (Mojo)

```javascript
MainAssistant.prototype.setup = function() {
    Mojo.Event.listen(this.controller.stageController.document,
        Mojo.Event.stageActivate,   this.onActivate.bind(this));
    Mojo.Event.listen(this.controller.stageController.document,
        Mojo.Event.stageDeactivate, this.onDeactivate.bind(this));
};
// onActivate: resume animations, shorten polling intervals
// onDeactivate: pause animations, lengthen polling intervals
```

### Dashboard stage (Mojo)

A dashboard panel lives in the notification area. Create it from `AppAssistant`:

```javascript
AppAssistant.prototype.createDashboard = function() {
    var app = Mojo.Controller.getAppController();
    if (!app.getStageController("dashboard")) {
        app.createStageWithCallback(
            { name: "dashboard", lightweight: true },
            function(sc) { sc.pushScene("dashboard"); },
            "dashboard"
        );
    }
};
```

Use `setTimeout` inside a dashboard scene for periodic updates — but note **`setTimeout` only fires while the device is awake**. For reliable background wake-up when the device may be sleeping, use the Alarms service (see `alarms.md`).

### Dashboard from a plain web app (no Mojo, no Enyo)

A `"type": "web"` app that loads neither framework can still open a dashboard. Enyo 1's `enyo.Dashboard` is a thin layer over the following calls (`/usr/palm/frameworks/enyo/1.0/framework/source/palm/system/windows/agent.js` and `events.js` on the device):

```javascript
// Open: an absolute URL, plus window attributes as JSON. "icon" is the small status-bar icon.
var dash = window.open(appDir + 'dashboard.html', 'myapp-dashboard',
    'attributes=' + JSON.stringify({ window: 'dashboard', icon: 'icon-sm.png' }));

// Card minimized / maximized: LunaSysMgr calls these on the app window.
window.Mojo = window.Mojo || {};
Mojo.stageDeactivated = function () { /* minimized, or another app in front */ };
Mojo.stageActivated   = function () { /* back in front */ };

// From the dashboard: bring the app's card forward.
window.opener.PalmSystem.activate();
```

- **The dashboard page must call `PalmSystem.stageReady()`**, as every window must. Without it the dashboard appears as an empty slot, and `/var/log/messages` shows `timed out in waiting for stageReady: …/dashboard.html`. Enyo's own `dashboard.html` gets this for free from `enyo.js`.
- A dashboard page in the app's own folder is same-origin, so it can call `window.opener.someObject` directly. Enyo uses `postMessage` only because its `dashboard.html` lives in the framework directory.
- Leave out Enyo's `webosDragMode: "manual"` and the system handles swipe-to-dismiss itself.
- **Telling a swipe-away from your own `close()`:** the dashboard's `unload` fires in both cases, and it fires *after* `close()` has returned. So a flag set before `close()` and cleared after it is already false by then. Mark the window object itself (`dash.closedByApp = true; dash.close();`), and have the page pass `window` back in its `unload` handler.
- Dashboards also appear on the lock screen.

Working example: SoundCloud Player 4.5.0 (`dashboard.html`, `js/sc-dashboard.js` in [alan-morford/soundcloudplayer](https://github.com/alan-morford/soundcloudplayer)), a now-playing panel with artwork and back/play-pause/next.

### Background app guidelines

- Poll as infrequently as possible; use lengthening intervals when backgrounded
- Only notify on genuinely important events
- Shorten/lengthen intervals on `stageActivate`/`stageDeactivate`

---

## Alarms Service

`palm://com.palm.power/timeout` fires timers even when the device is asleep, waking it if `"wakeup": true`. The fired alarm relaunches your app via `applicationManager/open`, passing the `params` you specified — detect this with `params["action"]` in `handleLaunch`.

For the full implementation — relative vs absolute alarm selection, UTC conversion, self-healing on launch, the TouchPad screen-off workaround, and managing multiple alarms — see `alarms.md`.

---

## Key Service

Subscribe to hardware key events:

```javascript
// Volume keys → r.key: "volume_up"|"volume_down", r.state: "up"|"down"
this.controller.serviceRequest("palm://com.palm.keys/audio",
    { method: "status", parameters: { subscribe: true }, onSuccess: handler });

// Bluetooth media keys → r.key: "play"|"pause"|"stop"|"next"|"prev"
this.controller.serviceRequest("palm://com.palm.keys/media",
    { method: "status", parameters: { subscribe: true }, onSuccess: handler });

// Ringer/slider switches → r.key: "ringer"|"slider", r.state: "up"|"down"
this.controller.serviceRequest("palm://com.palm.keys/switches",
    { method: "status", parameters: { subscribe: true }, onSuccess: handler });

// Wired headset button → r.key: "headset_button", r.state: "up"|"down"
this.controller.serviceRequest("palm://com.palm.keys/headset",
    { method: "status", parameters: { subscribe: true }, onSuccess: handler });
```

---

## System Sounds

Low-latency UI sound feedback via `palm://com.palm.audio/systemsounds`:

```javascript
// Mojo
new Mojo.Service.Request("palm://com.palm.audio/systemsounds", {
    method: "playFeedback", parameters: { name: "card_01" }
});

// Enyo component
{ kind: "PalmService", service: "palm://com.palm.audio/systemsounds",
  method: "playFeedback" }
// Call: this.$.snd.call({ name: "error_01" });
```

**Available names:** `appclose`, `back_01`, `browser_01`, `card_01`–`card_05`, `default_425hz`, `delete_01`, `discardingapp_01`, `down2`, `dtmf_0`–`dtmf_9`, `dtmf_asterisk`, `dtmf_pound`, `error_01`–`error_03`, `focusing`, `launch_01`–`launch_03`, `pagebackwards`, `pageforward_01`, `shuffle_02`–`shuffle_08`, `shuffling_01`, `shutter`, `switchingapps_01`–`switchingapps_03`, `tones_3beeps_otasp_done`, `unassigned`, `up2`

Sound names may vary between webOS versions — test on target hardware.
