# Alarms and Background Timers

## Overview

webOS apps can schedule timers that fire even when the device is asleep or the app is not running, using the power management service: `palm://com.palm.power/timeout`. This is the primary mechanism for apps that need to perform periodic background work without running a JS service.

**Reference implementation:** [webos-nightmoves](https://github.com/codepoet80/webos-nightmoves) — a scheduler app that changes brightness/volume/radio state on a time-of-day schedule. The most complete community example of alarm management.

---

## Two Alarm Types

| Type | Parameter | Time format | Max | Use when |
|------|-----------|-------------|-----|----------|
| **Relative** (monotonic) | `"in"` | `"HH:MM:SS:00"` | 24h | < 1 minute from now |
| **Absolute** (calendar) | `"at"` | `"MM/DD/YYYY HH:MM:SS"` (UTC) | None | > 1 minute from now, or specific time |

**Always prefer absolute alarms for scheduled times.** Relative alarms are only necessary when the target time is imminent (< 1 minute), because absolute alarms require the time to be in the future and you cannot set an absolute alarm for "right now."

---

## Setting Alarms

### Alarm key naming

Every alarm needs a unique key. Convention: `appId + "-" + alarmName`. The same key overwrites any existing alarm with that key — there is no "update" operation, only set/clear.

```javascript
var alarmKey = Mojo.Controller.appInfo.id + "-" + alarmName;
// e.g. "com.palm.webos.myapp-Morning"
```

### Relative alarm (monotonic)

Use when the alarm should fire in less than a minute — e.g., when the scheduled time is imminent and you need to fire it "shortly."

```javascript
new Mojo.Service.Request("palm://com.palm.power/timeout", {
    method: "set",
    parameters: {
        "key": Mojo.Controller.appInfo.id + "-" + alarmName,
        "in": "0:00:45:00",   // HH:MM:SS:00 — fires in 45 seconds
        "wakeup": true,        // wake device if sleeping
        "uri": "palm://com.palm.applicationManager/open",
        "params": {
            "id": Mojo.Controller.appInfo.id,
            "params": { "action": alarmName }   // passed to handleLaunch
        }
    },
    onSuccess: function(r) { Mojo.Log.info("Alarm set: " + JSON.stringify(r)); },
    onFailure: function(r) { Mojo.Log.error("Alarm set failed: " + r.errorText); }
});
```

### Absolute alarm (calendar)

Use for a specific time of day. **Requires UTC time** — convert from local time first (see below).

```javascript
new Mojo.Service.Request("palm://com.palm.power/timeout", {
    method: "set",
    parameters: {
        "key": Mojo.Controller.appInfo.id + "-" + alarmName,
        "at": "01/15/2024 14:30:00",   // MM/DD/YYYY HH:MM:SS in UTC
        "wakeup": true,
        "uri": "palm://com.palm.applicationManager/open",
        "params": {
            "id": Mojo.Controller.appInfo.id,
            "params": { "action": alarmName }
        }
    },
    onSuccess: function(r) { Mojo.Log.info("Alarm set: " + JSON.stringify(r)); },
    onFailure: function(r) { Mojo.Log.error("Alarm set failed: " + r.errorText); }
});
```

### Clearing an alarm

```javascript
new Mojo.Service.Request("palm://com.palm.power/timeout", {
    method: "clear",
    parameters: { "key": Mojo.Controller.appInfo.id + "-" + alarmName },
    onSuccess: function(r) { Mojo.Log.info("Alarm cleared"); },
    onFailure: function(r) { Mojo.Log.error("Clear failed: " + r.errorText); }
});
```

**Always clear before re-setting.** There is no "update" — clearing and re-setting is the only way to change an alarm's time.

---

## UTC Conversion for Absolute Alarms

The alarm service stores absolute times in UTC. Convert local time to UTC before calling `set`:

```javascript
var constructUTCAlarm = function(localDate) {
    var d = new Date(localDate);
    // getTimezoneOffset() returns minutes west of UTC; divide by 60 for hours
    var utcOffset = d.getTimezoneOffset() / 60;
    d.setHours(d.getHours() + utcOffset);

    var pad = function(n) { return (n < 10 ? "0" : "") + n; };

    // Format: "MM/DD/YYYY HH:MM:SS"
    return pad(d.getUTCMonth() + 1) + "/" +
           pad(d.getDate()) + "/" +
           pad(d.getUTCFullYear()) + " " +
           pad(d.getHours()) + ":" +
           pad(d.getUTCMinutes()) + ":" +
           pad(d.getUTCSeconds());
};
```

---

## Alarm Launch Detection

When an alarm fires, the power service relaunches your app via `applicationManager/open` with the `"params"` object you specified. In `handleLaunch`, detect this by checking for the `"action"` key:

```javascript
AppAssistant.prototype.handleLaunch = function(params) {
    if (!params || params["action"] === undefined) {
        // Normal (user-initiated) launch
        appModel.AlarmLaunch = false;
        // ... create or reactivate normal stage
    } else {
        // Alarm launch — params["action"] is the alarm name
        appModel.AlarmLaunch = true;
        appModel.AlarmLaunchName = params["action"];  // e.g., "Morning"
        this.handleAlarmLaunch(params["action"]);
    }
};
```

Suggestion: track whether the app was already running and whether the screen was on — in case you need to restore that state after the alarm fires (see [Cleanup After Alarm](#cleanup-after-alarm)):

```javascript
// Early in handleLaunch, before async calls:
var mainStage = this.controller.getStageProxy("main");
AppRunning = !!mainStage;

// Then check screen state async, continue in callback:
systemModel.GetDisplayState(function(response) {
    ScreenWasOn = (response && response.state === "on");
    // ... proceed with launch logic
});
```

---

## The `manageAlarm` Pattern

The central problem with recurring daily alarms: when should the next firing be scheduled?

- If the target time is **> 1 min in the future** → absolute alarm for **today**
- If the target time is **in the past** → absolute alarm for **tomorrow**
- If the target time is **< 1 min in the future** → relative alarm for **seconds from now**
- If the alarm **just fired** (the current alarm) → force it to be rescheduled for **tomorrow**, not seconds from now

```javascript
AppAssistant.prototype.manageAlarm = function(alarmName, alarmTime, alarmEnabled, forceAbsoluteOrName, isBulkUpdate) {
    // Always clear first
    systemModel.ClearSystemAlarm(alarmName);

    if (!alarmEnabled || alarmEnabled === "false") return;  // disabled — cleared, not rescheduled

    // Adjust the stored alarm time to today's date
    var now = new Date();
    var target = adjustAlarmTimeToToday(alarmTime);

    // Window: "close to now" = ±60 seconds
    var nowMin = new Date(now.getTime() - 60000);
    var nowMax = new Date(now.getTime() + 60000);

    if (target > nowMin && target < nowMax) {
        // Imminent — use relative alarm, UNLESS this is the alarm that just fired
        if (forceAbsoluteOrName === true || forceAbsoluteOrName === alarmName) {
            // This alarm just fired; back it up 30 seconds so it falls "in the past"
            // and will be rescheduled for tomorrow in the next branch
            target.setSeconds(target.getSeconds() - 30);
        } else {
            // Truly imminent and not the one that just fired
            var remaining = target - now;
            var h = Math.floor(remaining / 3600000);
            remaining -= h * 3600000;
            var m = Math.floor(remaining / 60000);
            remaining -= m * 60000;
            var s = Math.floor(remaining / 1000);
            var relTime = pad(h) + ":" + pad(m) + ":" + pad(s) + ":00";
            systemModel.SetSystemAlarmRelative(alarmName, relTime);
            return;
        }
    }

    if (target <= nowMin) {
        // Past — schedule for tomorrow
        target.setDate(target.getDate() + 1);
        // Optional: adjust for weekends
        target = checkAdjustAlarmTimeForWeekends(target);
        systemModel.SetSystemAlarmAbsolute(alarmName, constructUTCAlarm(target));
    } else {
        // Future (> 1 min away) — schedule for today
        systemModel.SetSystemAlarmAbsolute(alarmName, constructUTCAlarm(target));
    }
};

// Helper: move a stored alarm time to today's date
var adjustAlarmTimeToToday = function(storedTime) {
    var today = new Date();
    var t = new Date(storedTime);
    t.setFullYear(today.getFullYear());
    t.setMonth(today.getMonth());
    t.setDate(today.getDate());
    return t;
};
```

### Re-establishing all alarms after one fires

Alarms can't fire when the device is off. Alarms are lost when the device is rebooted, battery dies, or if the app crashes without rescheduling. To address, re-schedule **all** alarms after any alarm fires. Pass the just-fired alarm's name as `forceAbsoluteOrName` so it gets pushed to tomorrow instead of re-firing immediately:

```javascript
AppAssistant.prototype.manageAllAlarms = function(appSettings, justFiredAlarmName) {
    this.manageAlarm("Morning", appSettings.MornStart, appSettings.MornEnabled, justFiredAlarmName, true);
    this.manageAlarm("Evening", appSettings.EveStart,  appSettings.EveEnabled,  justFiredAlarmName, true);
    this.manageAlarm("Night",   appSettings.NiteStart, appSettings.NiteEnabled,  justFiredAlarmName, true);
};
```

---

## Self-Healing on Normal Launch

Alarms are lost when the device is rebooted, battery dies, or if the app crashes without rescheduling. Re-establish all alarms on every normal foreground launch. This is cheap and ensures the schedule recovers automatically:

```javascript
MainAssistant.prototype.activate = function(event) {
    if (!appModel.AlarmLaunch) {
        // Normal launch — heal alarms in case they were lost
        alarmUtils.manageAllAlarms(appModel.AppSettingsCurrent, true);
    }
};
```

---

## Cleanup After an Alarm Fires

To improve the user experience, after applying the alarm's action, restore the device to its pre-alarm state. Track two flags before doing any alarm work:

- `ScreenWasOn` — was the screen on when the alarm fired?
- `AppRunning` — was the app already running in the foreground?

```javascript
AppAssistant.prototype.finishAlarmHandling = function() {
    var stageController = Mojo.Controller.appController.getStageController("main");

    // If the screen was off when the alarm fired, turn it off again
    if (!ScreenWasOn)
        systemModel.SetDisplayState("off");

    // If the app wasn't running when the alarm fired, close the stage we created
    if (!AppRunning && stageController)
        stageController.window.close();
};
```

---

## TouchPad Background Alarm Workaround

**Critical device difference.** On Pre phones, the OS gives background apps enough execution time to apply settings directly. On the **TouchPad**, when the screen is off, background JavaScript execution is throttled or faked — setting brightness/volume from `handleLaunch` with the screen off will silently fail.

**The fix:** Force the TouchPad's screen on, then create a `popupalert` notification stage. Presenting a stage forces the system to allocate real execution resources. Apply settings from within the stage's `setup()`. Then clean up.

```javascript
AppAssistant.prototype.handleAlarmLaunch = function(alarmName) {
    if (IsTouchPad && !ScreenWasOn) {
        // Unlock and turn on the screen so we can affect system state
        systemModel.SetDisplayState("unlock");
        systemModel.SetDisplayState("on");

        // Present a notification stage — this forces real execution on TouchPad
        // Use a silent sound so there's no audible alert
        systemModel.ShowNotificationStage("alarm", "main/alarm-scene", 140, false, false);

        // Re-establish alarms
        alarmUtils.manageAllAlarms(appModel.AppSettingsCurrent, alarmName);

        // After a delay, close the stage and restore screen state
        setTimeout(this.finishTouchPadAlarm.bind(this), 2500);
    } else {
        // Pre phones, or TouchPad with screen already on — apply directly
        alarmUtils.manageAllAlarms(appModel.AppSettingsCurrent, alarmName);
        alarmUtils.applySettingsFromAlarm(alarmName);
        this.finishAlarmHandling();
    }
};

AppAssistant.prototype.finishTouchPadAlarm = function() {
    systemModel.AllowDisplaySleep();          // Re-enable sleep
    Mojo.Controller.appController.closeStage("alarm");  // Close notification stage
    this.finishAlarmHandling();               // Restore screen/app state
};
```

### The `popupalert` stage

The `popupalert` stage type creates a notification-style overlay window. It fires even when the lock screen is active (`clickableWhenLocked: true`). Pushing a scene into it forces the device to actually execute the JavaScript:

```javascript
SystemModel.prototype.ShowNotificationStage = function(stageName, sceneName, height, sound, vibrate) {
    var soundToUse = sound ? sound : "assets/silent.mp3";  // silent if no sound wanted

    Mojo.Controller.getAppController().createStageWithCallback({
        name: stageName,
        lightweight: true,
        height: height,
        sound: soundToUse,
        clickableWhenLocked: true   // works on lock screen
    }, function(stageController) {
        stageController.pushScene({ name: stageName, sceneTemplate: sceneName });
    }, "popupalert");               // third arg = stage type
};
```

The scene pushed into the alarm stage should immediately apply settings in `setup()` — the stage exists only to force execution, not for user interaction:

```javascript
// app/assistants/alarm-assistant.js
AlarmAssistant.prototype.setup = function() {
    // Apply the alarm's settings now that we have real execution time
    alarmUtils.applySettingsFromAlarm(appModel.AlarmLaunchName);
    // The app-assistant's setTimeout will close this stage shortly
};
```

---

## Alarm Coarseness

- The power service fires alarms up to **±20 seconds** late. This is normal and expected.
- Alarms that would have fired while the device was powered off **fire on next boot**.
- Setting the same key twice overwrites — the second call wins.
- Alarms are **global per key** — if two apps use the same key string, one will overwrite the other. Always prefix with your app ID.

---

## Banner Feedback

Show the user a banner so they know the alarm was set and when it will next fire:

```javascript
// After manageAlarm sets the alarm:
Mojo.Controller.getAppController().showBanner(
    "Next trigger: later today.",
    { source: 'notification' },
    "MyApp"
);
```

Useful user-facing messages: `"Next trigger: in seconds."`, `"Next trigger: later today."`, `"Next trigger: tomorrow."`, `"Failed to set next trigger!"`.

---

## Checklist

- [ ] Use `appId + "-" + alarmName` as the alarm key to avoid collisions
- [ ] Always clear an alarm before re-setting it
- [ ] Absolute alarms need UTC time — convert with `getTimezoneOffset()`
- [ ] Relative alarm format is `"HH:MM:SS:00"` (four colon-separated fields)
- [ ] Detect alarm launch in `handleLaunch` via `params["action"]`
- [ ] Re-establish all alarms when any one fires (pass fired alarm name to avoid immediate re-fire)
- [ ] Re-establish alarms on every normal foreground launch (self-heal)
- [ ] On TouchPad with screen off: unlock/turn on screen, use `popupalert` stage, delay cleanup 2500ms
- [ ] Use `clickableWhenLocked: true` on the notification stage

---

## See Also

- `webos://knowledge/system-features` — dashboard stage and `setTimeout` polling (complementary background patterns)
- `webos://knowledge/services` — other privileged system service calls (display state, app management) used alongside alarm handling
- `webos://knowledge/exhibition` — practical example of alarm-based time scheduling in an Exhibition app
- `webos://knowledge/activity-manager` — details of how scheduled activities are controled by the OS
