# URL Redirect Handlers

## Overview

webOS lets apps register as the handler for URL patterns — so that when the system opens a URL matching that pattern, your app launches instead of the browser. This is how Touch2Share receivers work, how apps handle custom URI schemes, and how tools like URL Assist redirect YouTube links to a video player app.

**This API was not documented by HP/Palm.** It was reverse-engineered by the community. The information here was derived from the [webos-urlassist](https://github.com/codepoet80/webos-urlassist) project.

**Service:** `palm://com.palm.applicationManager`

**Privilege required for registration:** Yes — `addRedirectHandler` and `removeHandlersForAppId` require a **`com.palm.*` app ID**. Being the *target* of a redirect handler does not require a privileged ID; any app can receive URL launches.

---

## The Privilege Problem

Most third-party apps have IDs like `com.example.myapp` and **cannot register their own URL handlers**. The `addRedirectHandler` call will silently fail (or return an error) from a non-`com.palm.*` app.

Two solutions:

1. **Use a `com.palm.*` app ID** for your own app (see the `com.palm.*` workaround in `services.md`). Then register handlers from within your own app's code.

2. **Use URL Assist as a privileged proxy.** URL Assist (`com.palm.app.jonandnic.urlassist`) has a privileged ID and was built specifically to let non-privileged apps get URL handlers registered on their behalf. Users install URL Assist and toggle the handler on.

---

## Registering a Handler

```javascript
// Requires com.palm.* app ID
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "addRedirectHandler",
    parameters: {
        "appId":      "com.example.myapp",           // app to launch when URL matches
        "urlPattern": "^[^:]+://yourdomain.com",     // regex pattern (see below)
        "schemeForm": false                           // false for URLs, true for URI schemes
    },
    onSuccess: function(response) {
        Mojo.Log.info("Handler registered: " + JSON.stringify(response));
    },
    onFailure: function(response) {
        Mojo.Log.error("Handler registration failed: " + JSON.stringify(response));
    }
});
```

### `schemeForm` — URL vs URI scheme

| `schemeForm` | Use for | Example pattern |
|---|---|---|
| `false` | Regular `http://` / `https://` URLs | `^[^:]+://youtu.be` |
| `true` | Custom URI schemes (no `://`) | `^myapp:` |

For URL patterns, `^[^:]+://` means "any protocol, then `://`". This lets you match both `http://` and `https://` variants of the same domain with one pattern.

### Pattern examples

```
^[^:]+://www.youtube.com/watch    — matches youtube.com/watch (any protocol)
^[^:]+://youtu.be                  — matches youtu.be short links
^[^:]+://m.youtube.com/watch       — matches mobile YouTube
^[^:]+://v.redd.it                 — matches Reddit video links
^[^:]+://share.wosa.link           — matches a specific domain
^myapp:                            — matches myapp: URI scheme (schemeForm: true)
```

The pattern is a **regex** matched against the full URL. Anchoring with `^` is important — without it the pattern could match URLs containing your string anywhere.

---

## Removing a Handler

**Removal is all-or-nothing per app ID.** There is no way to remove a single pattern; calling `removeHandlersForAppId` removes every pattern registered for that app. If your app registered three patterns, all three are cleared at once.

```javascript
// Requires com.palm.* app ID
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "removeHandlersForAppId",
    parameters: {
        "appId": "com.example.myapp"
    },
    onSuccess: function(response) {
        Mojo.Log.info("Handlers removed: " + JSON.stringify(response));
    },
    onFailure: function(response) {
        Mojo.Log.error("Handler removal failed: " + JSON.stringify(response));
    }
});
```

**Implication:** If you need to update one pattern, you must remove all patterns and re-add them. Design your patterns as a set that is always registered together.

---

## Checking the Current Handler for a URL

To discover which app (if any) is currently registered as the handler for a URL, call `listAllHandlersForUrl` with a **sample URL** that would be matched by the pattern. The service evaluates registered patterns against the sample URL and returns the active handler.

```javascript
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "listAllHandlersForUrl",
    parameters: {
        "url": "https://www.youtube.com/watch?v=example"   // sample URL to test
    },
    onSuccess: function(response) {
        Mojo.Log.info("Handlers: " + JSON.stringify(response));

        if (response && response.redirectHandlers) {
            var activeAppId = response.redirectHandlers.activeHandler.appId;
            if (activeAppId === "com.example.myapp") {
                // Your app is the active handler for this URL pattern
            } else {
                // Either no handler, or a different app is registered
            }
        }
    },
    onFailure: function(response) {
        Mojo.Log.error("List handlers failed: " + JSON.stringify(response));
    }
});
```

### Response structure

```json
{
    "redirectHandlers": {
        "activeHandler": {
            "appId": "com.example.myapp",
            "urlPattern": "^[^:]+://yourdomain.com"
        },
        "handlers": [ ... ]
    },
    "returnValue": true
}
```

`activeHandler` is the currently active (winning) handler for the sample URL. `handlers` lists all registered handlers that matched. When no handler is registered, `redirectHandlers` may be absent or `activeHandler` may be null — always guard with an existence check.

---

## Loading Toggle State from Handler Registration

A common UI pattern (from URL Assist): show toggles that reflect whether each URL pattern is currently registered. Implement by calling `listAllHandlersForUrl` for each pattern and checking if your app is the `activeHandler`:

```javascript
// Check if com.example.myapp is registered for YouTube long URLs
MainAssistant.prototype.checkYouTubeHandler = function(callback) {
    new Mojo.Service.Request("palm://com.palm.applicationManager", {
        method: "listAllHandlersForUrl",
        parameters: {
            "url": "https://www.youtube.com/watch?v=test"
        },
        onSuccess: function(response) {
            var isActive = false;
            if (response && response.redirectHandlers) {
                isActive = (response.redirectHandlers.activeHandler.appId === "com.example.myapp");
            }
            if (callback) callback(isActive);
        }.bind(this),
        onFailure: function(response) {
            if (callback) callback(false);
        }.bind(this)
    });
};
```

Since each `listAllHandlersForUrl` call is async and you may need to check several patterns, chain them sequentially using a counter or a recursive callback pattern — not in parallel, to avoid clobbering the same `this.serviceRequest`:

```javascript
// Sequential loading pattern (from URL Assist)
MainAssistant.prototype.loadAllHandlerStates = function() {
    switch (this.loadStep) {
        case 0:
            this.checkHandler("https://youtu.be/x", "com.example.myapp", "toggleShortLinks", this.loadAllHandlerStates);
            break;
        case 1:
            this.checkHandler("https://www.youtube.com/watch?v=x", "com.example.myapp", "toggleLongLinks", this.loadAllHandlerStates);
            break;
        // done
    }
};
```

---

## How the Receiving App Is Launched

When a URL matches a registered handler, webOS calls `applicationManager/open` with `target` set to the URL. The registered app is launched (or relaunched if already running) and receives the URL in `handleLaunch`:

```javascript
// Mojo — app-assistant.js
AppAssistant.prototype.handleLaunch = function(params) {
    if (params && params.target) {
        // Launched because a URL matched our registered pattern
        // params.target = the full URL that was opened
        appModel.LaunchUrl = params.target;
        // ... open the appropriate scene and handle the URL
    } else {
        // Normal user-initiated launch
    }
};
```

The URL is passed verbatim in `params.target`. Parse it yourself — there is no pre-parsing of query strings or path components.

### Testing URL launch manually

Use `applicationManager/open` to simulate what the system does when a URL is clicked:

```javascript
// Fire a URL as if the user tapped a link — invokes the registered handler
new Mojo.Service.Request("palm://com.palm.applicationManager", {
    method: "open",
    parameters: {
        "target": "https://youtu.be/dQw4w9WgXcQ"
    },
    onSuccess: function(r) { Mojo.Log.info("Opened: " + JSON.stringify(r)); },
    onFailure: function(r) { Mojo.Log.error("Open failed: " + JSON.stringify(r)); }
});
```

This is the correct way to test a registered handler: pass a real URL through `open` and verify your app launches.

---

## The URL Assist Proxy Pattern

If your app has a non-privileged ID (`com.example.*`) but needs URL handler registration, there are two approaches:

### Option 1: Register from within your app (requires `com.palm.*` ID)

The cleanest solution if you can use a `com.palm.*` ID. Call `addRedirectHandler` from your own app's `activate()` each time the app foregrounds. Re-registering is idempotent and defensive — if another app stole your handler, you'll reclaim it.

```javascript
// Re-register on every activate() to reclaim handler if stolen
MainAssistant.prototype.activate = function(event) {
    this.registerUrlHandlers();
};

MainAssistant.prototype.registerUrlHandlers = function() {
    new Mojo.Service.Request("palm://com.palm.applicationManager", {
        method: "addRedirectHandler",
        parameters: {
            "appId": Mojo.Controller.appInfo.id,
            "urlPattern": "^[^:]+://share.yourdomain.com",
            "schemeForm": false
        }
    });
};
```

### Option 2: Rely on URL Assist (for non-privileged apps)

Document that users must install URL Assist and manually enable your app's handler. Your app does not need any code to register — it only needs to handle `params.target` in `handleLaunch`. URL Assist does the registration.

---

## Persistence

Handler registrations **persist across app restarts and device reboots**. Once registered, the handler is active until explicitly removed with `removeHandlersForAppId` or the registered app is uninstalled. However, another app can overwrite your handler by registering a conflicting pattern — last one wins.

---

## Constraints

| | |
|---|---|
| **Registration privilege** | `com.palm.*` app ID required for `addRedirectHandler` / `removeHandlersForAppId` |
| **Receiving privilege** | None — any app ID can be the `appId` target |
| **Remove granularity** | Per appId only — all patterns for an app are removed at once |
| **Pattern format** | ECMAScript regex matched against the full URL string |
| **Conflict resolution** | Last registration wins; no error for conflicting patterns |
| **Persistence** | Survives reboots; lost if app is uninstalled |
| **Testing** | Use `applicationManager/open` with `target` to trigger the handler |

---

## See Also

- `webos://knowledge/touch2share` — Touch2Share uses the same `addRedirectHandler` API to make your app open on the receiving device
- `webos://knowledge/services` — full privileged services reference
