# App Self-Update Pattern (App Museum II)

## Overview

webOS apps distributed through the webOS Archive community can self-check for updates without requiring App Museum II to be installed. This is a community-created pattern implemented as reusable library files in [webos-common](https://github.com/webOSArchive/webos-common).

There are three implementations — one per framework:

| Framework | Library file | Kind / Class |
|-----------|-------------|--------------|
| Mojo | `Mojo/updater-model.js` | `UpdaterModel` (plain JS class) |
| Enyo 1 | `Enyo/Updater-Helper.js` | `Helpers.Updater` (Enyo kind) |
| Enyo 2 | `Enyo2/updater.js` | `wosa.updater` (Enyo kind) |

All three work the same way at a high level:
1. Call the App Museum II web service with the app name and current version
2. Compare the returned version against the installed version
3. If an update is available, notify the user and optionally launch Preware to install it

The pattern does not require App Museum II to be installed on the device. It requires internet access to reach `appcatalog.webosarchive.org`.

---

## The App Museum II Update API

```
GET http://appcatalog.webosarchive.org/WebService/getLatestVersionInfo.php?app={appName}/{version}&clientid={deviceId}&device={deviceInfo}
```

**Parameters:**

| Parameter | Value | Notes |
|-----------|-------|-------|
| `app` | `{appName}/{currentVersion}` | URL-encoded. App name must match App Museum II registration |
| `clientid` | Device NDUID or generated UUID | Used for analytics, not auth |
| `device` | `{model}/{platformVersion}/{carrier}/{locale}` | URL-encoded device info string |

**Example URL:**
```
http://appcatalog.webosarchive.org/WebService/getLatestVersionInfo.php?app=Check%20Mate%20HD%2F1.2.0&clientid=abc123&device=TouchPad%2F3.0.5%2FWiFi%2Fen_us
```

**Response JSON:**
```json
{
    "version": "1.3.0",
    "versionNote": "Bug fixes and performance improvements",
    "downloadURI": "http://appcatalog.webosarchive.org/apps/com.example.myapp_1.3.0_all.ipk"
}
```

- `version` — latest version available in App Museum II (`#.#.#` format)
- `versionNote` — human-readable release notes for the update
- `downloadURI` — direct URL to the IPK file; passed to Preware for installation

If no app is found, or on error, the response is an empty string or starts with `"ERROR:"`.

### HTTPS

The service URL uses `http://`. For apps served over HTTPS (PWA contexts), the Enyo 1 helper automatically upgrades the URL to `https://`. Do the same in custom implementations:
```javascript
if (location.protocol === 'https:') {
    updateURL = updateURL.replace('http://', 'https://');
}
```

---

## Version Number Format

webOS app version numbers **must** be `#.#.#` (major.minor.build — exactly three dot-separated integers). All three updater implementations parse the version this way and will log an error and return `false` for any other format.

Comparison is numeric per component, not lexicographic:
- `1.10.0` > `1.9.0` ✓ (numeric comparison)
- `"1.10.0" > "1.9.0"` ✗ (string comparison — wrong)

Set the version in `appinfo.json`:
```json
{
    "id": "com.example.myapp",
    "version": "1.3.0",
    ...
}
```

---

## Mojo Integration

### Include the library

Add to `sources.json`:
```json
{
    "source": "app/models/updater-model.js"
}
```
Copy `updater-model.js` into your app's models directory.

### Usage

```javascript
// In your scene assistant's setup() — NOT in activate()
// (activate fires every time the scene comes to the top; setup fires once)

var updaterModel = null;

MainAssistant.prototype.setup = function() {
    updaterModel = new UpdaterModel();
    updaterModel.CheckForUpdate("Your App Museum Name", this.handleUpdateResponse.bind(this));
};

MainAssistant.prototype.handleUpdateResponse = function(responseObj) {
    if (responseObj && responseObj.updateFound) {
        // Option A: let the model handle the UI prompt
        updaterModel.PromptUserForUpdate(function(userSaidYes) {
            if (userSaidYes) {
                updaterModel.InstallUpdate();  // launches Preware
            }
        }.bind(this));

        // Option B: build your own UI, then call InstallUpdate() when ready
    }
    // If !responseObj.updateFound, optionally tell the user they're up to date
};
```

### Menu-triggered check

```javascript
// In setup():
this.appMenuModel = {
    label: "Settings",
    items: [
        { label: "Check for Updates", command: 'do-updateCheck' }
    ]
};
this.controller.setupWidget(Mojo.Menu.appMenu, this.appMenuAttributes, this.appMenuModel);

// In handleCommand():
MainAssistant.prototype.handleCommand = function(event) {
    if (event.type == Mojo.Event.command) {
        switch (event.command) {
            case 'do-updateCheck':
                updaterModel = new UpdaterModel();
                updaterModel.CheckForUpdate("Your App Museum Name", this.handleUpdateResponse.bind(this));
                break;
        }
    }
};
```

### API Reference (Mojo)

| Method | Parameters | Description |
|--------|-----------|-------------|
| `CheckForUpdate(appName, callback)` | `appName`: App Museum II name string; `callback(responseObj)` | Checks the service; calls back with full response object. `responseObj.updateFound` is `true` if newer version found |
| `PromptUserForUpdate(callback, message?)` | `callback(userSaidYes: boolean)`; optional custom `message` | Shows a Mojo dialog with "Update Now" / "Later" buttons |
| `InstallUpdate()` | — | Launches Preware with the `downloadURI` from the last check |
| `InstallViaPreware(url)` | Direct IPK URL | Launches Preware with a specific URL; called internally by `InstallUpdate()` |

---

## Enyo 1 Integration

### Include the library

Add to `depends.js`:
```javascript
enyo.depends(
    "source/Main.js",
    "../../Enyo/Updater-Helper.js"   // adjust relative path as needed
);
```

### Usage — automatic UI (`handleUI: true`, default)

```javascript
enyo.kind({
    name: "MyApp.Main",
    kind: enyo.VFlexBox,
    components: [
        {
            kind: "Helpers.Updater",
            name: "myUpdater"
            // handleUI defaults to true — built-in popup appears automatically
        }
    ],

    create: function() {
        this.inherited(arguments);
        // Check on launch — not in a scene activate equivalent
        this.$.myUpdater.CheckForUpdate("My App Museum Name");
    }
});
```

When `handleUI: true` (default), the helper automatically shows a popup with "Update Now" / "Later" buttons when an update is found, and calls `InstallViaPreware()` if the user confirms.

### Usage — manual UI (`handleUI: false`)

```javascript
{
    kind: "Helpers.Updater",
    name: "myUpdater",
    handleUI: false,
    onUpdateFound: "showUpdateUI"
}

// In your kind:
showUpdateUI: function(inSender, versionNote) {
    // this.$.myUpdater.VersionNote has the release notes
    var updateMsg = this.$.myUpdater.VersionNote;
    // Show your own UI, then when user confirms:
    this.$.myUpdater.PromptUserForUpdate(updateMsg);
    // Or call InstallViaPreware() directly when ready:
    // this.$.myUpdater.InstallViaPreware();
}
```

### Menu-triggered check (Enyo 1)

```javascript
handleItemSelected: function(inSender, inEvent) {
    switch (inEvent) {
        case 'Check for Updates':
            this.$.myUpdater.CheckForUpdate("My App Museum Name");
            break;
    }
}
```

### API Reference (Enyo 1)

| Member | Type | Description |
|--------|------|-------------|
| `handleUI` | published property (boolean, default `true`) | When `true`, helper manages the update prompt popup internally |
| `onUpdateFound` | event | Fired with `versionNote` string when a newer version is found |
| `CheckForUpdate(appName)` | method | Initiates the version check |
| `PromptUserForUpdate(message?)` | method | Shows built-in popup (regardless of `handleUI`); pass optional custom message |
| `InstallViaPreware(url?)` | method | Launches Preware; uses stored `downloadURI` if no URL passed |
| `VersionNote` | property | Release notes string from the last successful update check |
| `LastUpdateResponse` | property | Full response object from the last check |

---

## Enyo 2 Integration

The Enyo 2 updater is the most minimal of the three. It fires an event but provides no built-in install UI — the app is responsible for showing a prompt and directing the user to install. This is appropriate for apps that may run on both webOS (where Preware is available) and as PWAs/Cordova builds (where Preware is not relevant).

**Note:** The Enyo 2 updater only runs on device — it guards with `if (enyo.platform.webos || window.PalmSystem)` and exits silently on web browsers. Use it for webOS-only or Cordova builds; skip it entirely for pure PWAs.

### Include the library

Add to `package.js`:
```javascript
enyo.depends(
    "updater.js",      // adjust path to where you placed the file
    "example.js"
);
```

### Usage

```javascript
enyo.kind({
    name: "myapp.MainView",
    kind: "FittableRows",
    components: [
        {
            kind: "wosa.updater",
            name: "myUpdater",
            onUpdateFound: "handleUpdateFound"
        },
        {
            kind: "enyo.Popup",
            name: "updatePopup",
            modal: true,
            autoDismiss: false,
            centered: true,
            components: [
                { name: "updateMessage", allowHtml: true },
                { kind: "enyo.Button", content: "Close", ontap: "closeUpdatePopup" }
            ]
        }
    ],

    rendered: enyo.inherit(function(sup) {
        return function() {
            sup.apply(this, arguments);
            // Wait for Cordova deviceready if in a Cordova build
            if (typeof device !== 'undefined' && device.platform) {
                this.doUpdateCheck();
            } else {
                document.addEventListener('deviceready', this.doUpdateCheck.bind(this), false);
            }
        };
    }),

    doUpdateCheck: function() {
        this.$.myUpdater.CheckForUpdate("My App Museum Name");
    },

    handleUpdateFound: function(inSender, inEvent) {
        // $.myUpdater.UpdateMessage holds the versionNote
        this.$.updateMessage.setContent(
            "Update found!<br>" + this.$.myUpdater.UpdateMessage +
            "<br>Visit the App Museum to download it."
        );
        this.$.updatePopup.show();
    },

    closeUpdatePopup: function() {
        this.$.updatePopup.hide();
    }
});
```

### API Reference (Enyo 2)

| Member | Type | Description |
|--------|------|-------------|
| `onUpdateFound` | event | Fired when a newer version is available |
| `CheckForUpdate(appName)` | method | Initiates the version check (webOS/PalmSystem only) |
| `UpdateMessage` | published property | Release notes string from the last successful update check |
| `LastUpdateResponse` | property | Full response object from the last check |

The Enyo 2 helper has **no built-in prompt popup and no `InstallViaPreware` method**. The app handles UI and installation entirely.

---

## How Installation Works

All versions that support installation use the same mechanism: launching Preware with the IPK URL via `applicationManager/open`.

```javascript
// What InstallViaPreware() does under the hood:
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "open",
    parameters: {
        id: "org.webosinternals.preware",
        params: {
            type: "install",
            file: downloadURI    // direct URL to the .ipk file
        }
    }
});
```

Preware must be installed on the device. If it isn't, the `open` call will fail silently (no crash, just `onFailure` fires). For apps targeting non-technical users, consider checking for Preware first using `applicationManager/listApps` before offering the update install option.

---

## Device Identification

The updater sends a `clientid` with each check, used by App Museum II for download analytics (not authentication). The priority for obtaining the ID:

1. **NDUID** from `palm://com.palm.preferences/systemProperties` with key `com.palm.properties.nduid` — the device's hardware unique ID (most reliable on real webOS)
2. **Cordova `device.uuid`** — available in Cordova builds (Enyo 2 path)
3. **UUID cookie** `updater-uuid` — generated randomly if neither above is available; persists across sessions via cookie

```javascript
// Mojo: NDUID via service request (falls through to identified check on success or failure)
this.deviceInfoRequest = new Mojo.Service.Request("palm://com.palm.preferences/systemProperties", {
    method: "Get",
    parameters: { key: "com.palm.properties.nduid" },
    onSuccess: this.performIdentifiedUpdateCheck.bind(this, ...),
    onFailure: this.performIdentifiedUpdateCheck.bind(this, ...)  // same handler — graceful fallback
});
```

Note that `palm://com.palm.preferences/systemProperties` is **not** a privileged service — any app can read it.

---

## Device Info String

The `device` query parameter sends a string used for compatibility tracking:

```
{modelName}/{platformVersion}/{carrierName|"WiFi"}/{locale}
```

Examples:
- `TouchPad/3.0.5/WiFi/en_us`
- `Pre3/2.2.4/Verizon/en_us`
- On web (Enyo 1 fallback): `navigator.userAgent`

---

## Common Mistakes

**Checking in `activate` instead of `setup` (Mojo):** The `activate` method fires every time the scene comes to the top of the stack (e.g., when a dialog closes). An update check there will run repeatedly and spam the user with dialogs. Use `setup` or a deliberate menu action.

**App name mismatch:** The `appName` parameter must exactly match the app name as registered in App Museum II. It is case-sensitive and space-sensitive. If the API returns no version (`null`), the most common cause is an incorrect app name.

**Version format not `#.#.#`:** Versions like `"1.0"` or `"1.0.0.0"` cause the parser to return `false`, and the comparison will fail silently with no update detected even when one exists.

**Skipping the `onFailure` path:** Both `CheckForUpdate` response handlers (success and failure on the NDUID service call) are wired to the same internal function — this is intentional. The NDUID lookup failure is not a fatal error; the check proceeds without a hardware ID. Always wire both handlers.

**Forgetting `deviceready` in Enyo 2 / Cordova builds:** If the update check runs before Cordova is ready, `device.uuid` is undefined and the UUID fallback cookie is used instead. This is harmless but loses Cordova device info. Check `typeof device !== 'undefined'` and gate on `deviceready` if it matters.
