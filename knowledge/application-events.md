# Application Events (Enyo)

`ApplicationEvents` is an Enyo 1 component (introduced in Enyo 0.10) that receives global window-level events that have no specific target — device rotation, window activation/deactivation, app relaunch, key events, and the back gesture. Events flow to *all* instances of `ApplicationEvents` in the component tree, so keep that in mind if you use it in more than one place.

---

## Usage

Declare one instance in your component's `components` array and map event names to handler methods:

```javascript
components: [
    {
        kind: "ApplicationEvents",
        onWindowRotated:     "handleRotation",
        onWindowActivated:   "handleActivated",
        onWindowDeactivated: "handleDeactivated",
        onApplicationRelaunch: "handleRelaunch",
        onBack:              "handleBack",
        onOpenAppMenu:       "handleAppMenu"
    }
],

handleRotation: function(inSender) {
    // window.orientation: 0 (portrait), 90, -90, 180
    var landscape = (Math.abs(window.orientation) === 90);
    this.adjustLayout(landscape);
},

handleActivated: function(inSender) {
    // App is now in the foreground — resume timers, refresh data
},

handleDeactivated: function(inSender) {
    // App moved to background — pause timers, save state
},

handleRelaunch: function(inSender) {
    // System relaunched the app (e.g., via Just Type or a URL handler)
    // Check enyo.windowParams for new launch parameters
    if (enyo.windowParams) {
        this.handleLaunchParams(enyo.windowParams);
    }
},

handleBack: function(inSender) {
    // Back gesture — navigate back or dismiss
    this.$.panels.selectPrevious();
},

handleAppMenu: function(inSender) {
    // User tapped the app menu area — show your app menu
    this.$.appMenu.open();
}
```

No handlers are assigned by default — you must map each event you care about.

---

## Event Reference

| Event | Fires when |
|-------|-----------|
| `onLoad` | Window has finished loading |
| `onUnload` | Window is being closed |
| `onError` | Window cannot be loaded properly |
| `onWindowActivated` | User brings the window to the front |
| `onWindowDeactivated` | User leaves the window (another card takes focus) |
| `onWindowParamsChange` | Window parameters changed via `enyo.windows.activateWindow` or `setWindowParams` |
| `onApplicationRelaunch` | System manager relaunches the app |
| `onWindowRotated` | User rotates the device |
| `onOpenAppMenu` | User taps the app menu area or presses CTRL+~ on desktop |
| `onCloseAppMenu` | App menu is dismissed |
| `onKeyup` | DOM `keyup` event |
| `onKeydown` | DOM `keydown` event |
| `onKeypress` | DOM `keypress` event |
| `onBack` | User makes back gesture on device, or presses ESC on desktop |

---

## Handling Relaunch Parameters

When your app is relaunched by Just Type, a URL handler, or another app, `onApplicationRelaunch` fires and `enyo.windowParams` contains the launch arguments:

```javascript
handleRelaunch: function(inSender) {
    var params = enyo.windowParams;
    if (params && params.target) {
        // URL handler relaunch
        this.openURL(params.target);
    } else if (params && params.query) {
        // Just Type "Search Using" relaunch
        this.runSearch(params.query);
    }
}
```

Also handle parameters at initial load (before the first `onApplicationRelaunch`):

```javascript
// In index.html, after creating the app kind:
var app = enyo.create({ kind: "MyApp" });
if (window.PalmSystem && enyo.windowParams) {
    app.handleLaunchParams(enyo.windowParams);
}
app.renderInto(document.body);
```

---

## Key Events

`onKeydown`, `onKeyup`, and `onKeypress` receive standard DOM `KeyboardEvent` objects:

```javascript
handleKeydown: function(inSender, inEvent) {
    if (inEvent.keyCode === 27) {  // ESC
        this.dismiss();
    }
}
```

On a real device, keyboard hardware is limited (phone keyboard or TouchPad on-screen keyboard). These events are most useful for desktop testing with `novacom` or the emulator.

---

## Multiple Instances

All instances of `ApplicationEvents` receive all global events. If you have components at different levels of the tree that each need to respond to rotation, for example, both will fire. This is usually fine but can cause double-handling if you're not careful — prefer a single top-level instance and dispatch from there.

---

## Mojo Equivalent

In Mojo, global app events are handled differently:
- Window activation/deactivation → scene `activate`/`deactivate` methods
- App relaunch → `AppAssistant.prototype.handleLaunch`
- Back gesture → handled automatically by the scene stack; override in scene if needed
- Orientation → `Mojo.Event.orientationChange` on the stage

---

## See Also

- `webos://knowledge/enyo` — Enyo 1 component model and event system
- `webos://knowledge/touch-and-gestures` — Touch events and back gesture details
- `webos://knowledge/just-type` — Relaunch parameters from Just Type
- `webos://knowledge/url-handlers` — Relaunch parameters from URL handler registration
