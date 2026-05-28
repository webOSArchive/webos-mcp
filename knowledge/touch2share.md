# Touch2Share

## Overview

Touch2Share is a webOS 2.24 and higher feature (TouchPad, Pre3 and meta-doctored Veer only) that lets users share a URL between two devices by tapping them back-to-back. It is implemented by the **Seamless Transitions (ST) service** — `palm://com.palm.stservice`.

**Transport:** Bluetooth. If Bluetooth is off when devices tap, the user sees a prompt to enable it and try again.

**What is shared:** A URL (string only). The receiving device opens the URL in the browser by default. To open your own app instead of the browser, register a URL redirect handler (requires a `com.palm.*` app ID — see [Receiving Side](#receiving-side) below).

**Hardware requirement:** TouchPad, Pre3 or a metadoctored Veer (webOS 2.2.4+) only. Touch2Share is not available on Pre, Pixi, or Pre 2.

---

## Sending Side

### Step 1: Declare support in `appinfo.json`

```json
{
    "id": "com.palm.webos.yourname.yourapp",
    "tapToShareSupported": true,
    ...
}
```

`tapToShareSupported: true` opts the app into receiving the `sendDataToShare` relaunch event when two devices tap. Without it, the system will not notify your app.

### Step 2: App must be running full-screen

The sending app **must be running full-screen** (not as a card in the card stack) when the two devices tap together. If your app is carded, Touch2Share will not trigger it.

### Step 3: Handle the relaunch event

When the two devices tap, System Manager relaunches the foreground app, passing `sendDataToShare` in the launch params. Check for this in `handleLaunch` (Mojo) or `onApplicationRelaunch` (Enyo).

**Mojo:**

```javascript
AppAssistant.prototype.handleLaunch = function(params) {
    if (params && params["sendDataToShare"]) {
        // The user tapped two TouchPads together — share the current URL
        var urlToShare = appModel.CurrentShareURL;  // whatever URL is currently "active"
        systemModel.SendDataForTouch2Share(urlToShare);
    }
    // ... normal launch handling
};
```

**Enyo:**

```javascript
components: [
    { kind: "ApplicationEvents", onApplicationRelaunch: "applicationRelaunchHandler" }
],

applicationRelaunchHandler: function(inSender) {
    var params = enyo.windowParams;
    if (params.sendDataToShare !== undefined) {
        this.$.touch2shareService.call({
            "data": {
                "target": this.currentUrl,
                "type": "rawdata",
                "mimetype": "text/html"
            }
        });
        return true;
    }
}
```

### Step 4: Call `stservice/shareData`

```javascript
// Mojo
this.shareRequest = new Mojo.Service.Request("palm://com.palm.stservice", {
    method: "shareData",
    parameters: {
        data: {
            target: urlToShare,      // The URL to send
            type: "rawdata",         // Currently the only valid value
            mimetype: "text/html"    // Currently the only valid value
        }
    },
    subscribe: true,   // REQUIRED — keeps the request alive while waiting for touch event
    onSuccess: function(response) {
        Mojo.Log.info("Touch2Share success: " + JSON.stringify(response));
    },
    onFailure: function(response) {
        Mojo.Log.error("Touch2Share failure: " + JSON.stringify(response));
    }
});
```

**The `subscribe: true` is required.** The ST service returns `returnValue: true` immediately and then sends a second response when the actual transfer completes. Without subscription, you'd miss the completion event.

### Enyo component form

```javascript
components: [{
    name: "touch2shareService",
    kind: "PalmService",
    service: "palm://com.palm.stservice",
    method: "shareData",
    subscribe: true,
    onSuccess: "onShareSuccess",
    onFailure: "onShareFailure"
}]
```

---

## Receiving Side

### Default behavior: browser

Without any additional work, the receiving device opens the shared URL in the webOS browser. No app registration required.

### Custom handler: open your app instead (privileged)

To intercept the incoming URL and launch your own app on the receiving device, register a URL redirect handler via `applicationManager/addRedirectHandler`. **This is a privileged API and requires a `com.palm.*` app ID.**

```javascript
// Register your app as the handler for a URL pattern
// Must be called from an app with ID starting with "com.palm"
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "addRedirectHandler",
    parameters: {
        appId: Mojo.Controller.appInfo.id,        // Your app's ID
        urlPattern: "^[^:]+://yourshortdomain.com",  // Regex — matches any protocol to your domain
        schemeForm: false
    },
    onSuccess: function(response) {
        Mojo.Log.info("URL handler registered: " + JSON.stringify(response));
    },
    onFailure: function(response) {
        Mojo.Log.error("URL handler registration failed: " + JSON.stringify(response));
    }
});
```

**When to register:** Call `addRedirectHandler` from the main scene's `activate()` — each time the app is foregrounded. Registrations persist but can be overwritten by other apps; re-registering on activate is defensive.

```javascript
// Unregister on removal/prerm
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "removeHandlersForAppId",
    parameters: {
        appId: Mojo.Controller.appInfo.id
    }
});

// List what's registered for a URL (useful for debugging)
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "listAllHandlersForUrl",
    parameters: { url: "http://yourshortdomain.com/example" },
    onSuccess: function(r) {
        // r.redirectHandlers — array of registered handler objects
        Mojo.Log.info("Handlers: " + JSON.stringify(r.redirectHandlers));
    }
});
```

### Handling an incoming URL

When the registered URL pattern matches the shared URL, webOS launches your app with the URL in the params. In Mojo, this arrives in `handleLaunch`:

```javascript
AppAssistant.prototype.handleLaunch = function(params) {
    if (params && params.target) {
        // Received via Touch2Share (or opened from browser via registered handler)
        appModel.LaunchQuery = params;
        // ... navigate to the scene that handles the URL
    }
};
```

In the main scene:

```javascript
MainAssistant.prototype.activate = function(event) {
    if (appModel.LaunchQuery && appModel.LaunchQuery.target) {
        this.handleURLInvocation(appModel.LaunchQuery.target);
        appModel.LaunchQuery = null;
    }
};

MainAssistant.prototype.handleURLInvocation = function(url) {
    // Fetch the content for this URL from your server/service
    serviceModel.QueryShareData(url, function(itemData) {
        if (itemData) {
            appModel.LastShareSelected = itemData;
            var stageController = Mojo.Controller.getAppController().getActiveStageController();
            stageController.pushScene({ transition: Mojo.Transition.crossFade, name: "detail" });
        }
    });
};
```

---

## The Server URL Pattern

The most practical Touch2Share architecture for community apps:

```
Device A                           Device B
---------                         ---------
User creates content               
 → generates short URL             
   (e.g., share.wosa.link/abc)     
                                    
Devices tap back-to-back           
 → sendDataToShare fires           
 → stservice sends the URL         
                                  URL received
                                  Your app is registered handler
                                   → your app launched with URL
                                   → app fetches content from server
                                   → displays it
```

This pattern — **share your server's URL as the Touch2Share payload, register as the URL handler for that domain** — gives you full app-to-app sharing without implementing any peer-to-peer protocol yourself. The server is the transport layer; Touch2Share is only used to convey the URL.

---

## Constraints

| Constraint | Detail |
|------------|--------|
| **Hardware** | TouchPad only (webOS 2.2.4+); not available on Pre, Pixi, Pre 2 |
| **Full-screen required** | Sending app must be full-screen (not carded) when devices tap |
| **Bluetooth** | Data sent over Bluetooth; user is prompted to enable if off |
| **URL only** | Only a URL string can be shared; no binary data or arbitrary payloads |
| **Type/mimetype** | Only `"rawdata"` / `"text/html"` are currently supported values |
| **URL handler registration** | `addRedirectHandler` / `removeHandlersForAppId` require `com.palm.*` app ID |
| **Default receiver** | Without a custom handler, the receiving device always opens the browser |

---

## `appinfo.json` Reference

```json
{
    "tapToShareSupported": true
}
```

Opts the app into receiving `sendDataToShare` relaunch events. Without this, tapping two devices together while your app is foreground does nothing.

---

## Debugging

**Touch2Share not triggering:** Verify `tapToShareSupported: true` is in `appinfo.json`. Verify the app is running full-screen (not carded). Verify Bluetooth is on on both devices.

**URL handler not opening your app:** Check that your app ID starts with `com.palm` — `addRedirectHandler` silently does nothing for non-privileged IDs. Use `listAllHandlersForUrl` to confirm registration. Verify the URL pattern regex matches the actual URL being shared.

**subscribe: true not set:** Without subscription, `shareData` sends the request but you can't confirm success/failure. Always use `subscribe: true`.

**Stale handler registration:** If you updated your app ID or URL pattern, the old handler may still be registered. Call `removeHandlersForAppId` then re-register with the new pattern.

---

## See Also

- `webos://knowledge/url-handlers` — registering your app as the URL handler on the *receiving* device (the other half of the Touch2Share pattern)
