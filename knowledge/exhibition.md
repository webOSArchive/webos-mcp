# Exhibition Mode (Touchstone Dock)

## Overview

Exhibition mode activates when a webOS device is placed on a Touchstone wireless charging dock. Apps that opt in present a full-screen, always-on display experience (a clock, slideshow, ambient display, etc.). This is distinct from the normal card UI — no status bar, no gestures bar, no launcher chrome.

**Reference implementation:** [webos-onenightstand](https://github.com/codepoet80/webos-onenightstand) — a clock/alarm app that is the most complete community example of Exhibition mode.

---

## `appinfo.json` Setup

```json
{
    "id": "com.palm.webos.yourname.yourapp",
    "version": "1.0.0",
    "type": "web",
    "main": "index.html",
    "title": "My Exhibition App",
    "theme": "dark",
    "dockMode": true
}
```

`"dockMode": true` is the only flag needed for the app to appear in the device's Exhibition preferences list. The user still must enable it in Settings → Exhibition.

---

## Launch Detection

Exhibition launches pass dock mode through `handleLaunch` parameters. Check **both** parameter names — different webOS versions used different names:

```javascript
AppAssistant.prototype.handleLaunch = function(params) {
    var exhibitionLaunch = false;

    // Check both names — webOS used "dockMode" and "touchstoneMode" across versions
    if (params.dockMode || params.touchstoneMode) {
        appModel.dockMode = true;
        exhibitionLaunch = true;
    }

    var stageController = this.controller.getStageController("main");

    if (exhibitionLaunch) {
        if (stageController) {
            // Stage already exists — check if it's in a clean state
            if (appModel.ExhibitionStart || !stageController.activeScene()) {
                // Stage is in a bad state (deactivated when user lifted device)
                // Re-enter Exhibition by setting display state to "dock"
                this.RestartExhibition();
            } else {
                // Stage is alive and in good shape
                systemModel.SetDisplayState("unlock");
                stageController.activate();
            }
        } else {
            // First Exhibition launch — create the stage
            this.controller.pushScene("main");
        }
    } else {
        // Normal (non-Exhibition) launch — push main scene normally
    }
};

AppAssistant.prototype.RestartExhibition = function() {
    // Re-enter Exhibition by commanding the display into dock state
    new Mojo.Service.Request("palm://com.palm.display/control", {
        method: "setState",
        parameters: { state: "dock" },
        onSuccess: function(response) { Mojo.Log.info("Exhibition restarted"); },
        onFailure: function(response) { Mojo.Log.error("Could not restart Exhibition", response.errorText); }
    });
};
```

---

## Stage Assistant Setup

```javascript
StageAssistant.prototype.setup = function() {
    // disableSceneScroller: true is CRITICAL — without it, Mojo adds
    // scroll chrome that breaks full-screen display
    this.controller.pushScene({ name: "main", disableSceneScroller: true });

    // "free" lets the OS rotate the stage as the device rotates
    this.controller.setWindowOrientation("free");
};
```

---

## Scene Assistant: Full-Screen Setup

```javascript
MainAssistant.prototype.setup = function() {
    // Remove all system chrome — status bar, gesture bar, etc.
    this.controller.enableFullScreenMode(true);

    // Set black background via CSS (do not rely on theme)
    // ...

    // Calculate clock/content position now AND after render
    this.calculateContentPosition();
    setTimeout(this.calculateContentPosition.bind(this), 500);
    // The 500ms delay is required: the DOM isn't fully laid out at setup() time.
    // Calling only at setup() gives wrong dimensions; always add the setTimeout.

    // Listen for orientation changes to re-center content
    this.orientationHandler = this.onOrientationChange.bind(this);
    this.controller.listen(document, "resize", this.orientationHandler);
};

MainAssistant.prototype.calculateContentPosition = function() {
    var div = document.getElementById("clock");

    // Scale down slightly in portrait to fit
    if (window.innerWidth < window.innerHeight) {
        div.style.webkitTransform = "scale(0.9)";
    } else {
        div.style.webkitTransform = "scale(1.0)";
    }

    // Center the element regardless of orientation
    div.style.position = "absolute";
    div.style.top = ((window.innerHeight / 2) - (div.clientHeight / 2)) + "px";
    div.style.left = ((window.innerWidth / 2) - (div.clientWidth / 2)) + "px";
};

MainAssistant.prototype.onOrientationChange = function() {
    this.calculateContentPosition();
};
```

---

## The `stageDeactivated` Lifecycle Bug

When the user lifts the device off the Touchstone, webOS does **not** close the app — it becomes a background card. If the user later puts the device back on the dock, `handleLaunch` is called again with dock params, but the stage still exists with its old, deactivated state. Naively calling `stageController.activate()` on a deactivated Exhibition stage causes visual glitches or broken state.

**The fix:** Set a flag in `stageDeactivated` so that `handleLaunch` knows the stage needs to be rebuilt via `RestartExhibition`:

```javascript
MainAssistant.prototype.stageDeactivated = function() {
    // Mark that this stage was deactivated while in dock mode.
    // handleLaunch checks this flag to decide whether to activate
    // the existing stage or restart Exhibition fresh.
    if (appModel.dockMode) {
        appModel.ExhibitionStart = true;
    }
};
```

And in `handleLaunch` (shown above): if `appModel.ExhibitionStart` is true, call `RestartExhibition()` instead of `activate()`.

---

## Audio in Exhibition

Use an `<audio>` element in the scene HTML for ambient sounds:

```html
<audio id="audioPlayer">
    <source src="sounds/rain.mp3" type="audio/mp3">
</audio>
```

```javascript
// Play
var audio = document.getElementById("audioPlayer");
audio.play();

// Stop
audio.pause();
audio.currentTime = 0;
```

Volume management: save and restore system volume just like brightness if you need to set a specific volume for Exhibition audio.

---

## Minimal Scene HTML

Keep the Exhibition scene HTML minimal — no scroll containers, no complex layout. A single absolutely-positioned element centered dynamically via JavaScript:

```html
<div id="myScene" class="palm-scene" style="height:100%; overflow:hidden; background-color: black;">
    <div id="clock" style="position:absolute;"></div>
</div>
<audio id="audioPlayer">
    <source src="sounds/ambient.mp3" type="audio/mp3">
</audio>
```

---

## Sub-Scenes from Exhibition

Additional scenes (preferences, lamp control, etc.) are pushed onto the stage's scene stack while Exhibition is active. These sub-scenes should:

- Detect device type (TouchPad vs Pre-family) and scale UI accordingly using `webkitTransform`
- Implement an **auto-timeout**: if the user doesn't interact for N seconds, pop back to the clock scene automatically
- Call `enableFullScreenMode(true)` if they also need full-screen
- Clear all timers in `deactivate()`/`cleanup()` to avoid updates running when the scene is off-screen

```javascript
// Auto-return to clock after inactivity
SomeSceneAssistant.prototype.setTimerToGoBack = function() {
    if (this.goBackTimer) clearTimeout(this.goBackTimer);
    var timeout = appModel.getSettings().displayTimeout || 30;  // seconds
    this.goBackTimer = setTimeout(function() {
        this.controller.stageController.popScene();
    }.bind(this), timeout * 1000);
};
```

---

## Complete Checklist

- [ ] `"dockMode": true` in `appinfo.json`
- [ ] App ID starts with `com.palm.webos` (required for brightness/display control)
- [ ] Check `params.dockMode || params.touchstoneMode` in `handleLaunch`
- [ ] `disableSceneScroller: true` in `pushScene` call
- [ ] `setWindowOrientation("free")` in stage `setup()`
- [ ] `enableFullScreenMode(true)` in main scene `setup()`
- [ ] Dynamic centering: calculate position in `setup()` AND via 500ms `setTimeout`
- [ ] Re-calculate position on `resize` event for orientation changes
- [ ] `stageDeactivated` sets `ExhibitionStart = true` flag
- [ ] `handleLaunch` checks `ExhibitionStart` flag; calls `RestartExhibition()` if true
- [ ] Save/restore system volume if Exhibition audio changes it
- [ ] Sub-scenes implement auto-timeout to return to main Exhibition scene
- [ ] Black background in CSS — don't rely on theme

---

## See Also

- `webos://knowledge/system-features` — noWindow, dashboard stage, alarms overview, and other system features used alongside Exhibition
- `webos://knowledge/alarms` — scheduling the dim/wake alarms that Exhibition apps use for time-based brightness control
- `webos://knowledge/services` — privileged display and audio service calls referenced in this file
