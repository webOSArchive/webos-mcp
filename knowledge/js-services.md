# JavaScript (Node.js) Services

## Overview

Starting with webOS 2.0, third-party developers can write **JavaScript services** — background Node.js processes that run on the device, register on the Luna bus, and handle requests from apps or other services. This is distinct from the app itself (which runs in a WebKit browser context); services run in a separate V8 instance with no DOM.

Services enable:
- **Background processing** that continues after the app card is closed
- **Shared logic** callable by multiple apps
- **Low-level access** to filesystem, networking, and binary data not available in app JS
- **Synergy connectors** (every Synergy transport is a JS service)

> **Services require webOS 2.0+.** Original webOS 1.x devices (Pre, Pixi original) used Java-based services that were not well documented, and not supported here.

---

## Architecture

A service package contains three components, each in its own directory:

```
com.example.myapp/                  ← app directory (can be a stub)
com.example.myapp.service/          ← service directory
com.example.myapp.package/          ← package directory (glues them together)
```

A service **must be packaged with an app**, but the app can be a stub with no UI (hidden from Launcher).

### Naming Rules

- App ID: `com.example.myapp`
- Service ID: must **start with** the app ID — e.g. `com.example.myapp.service` or `com.example.myapp.sync.service`
- The service ID **must** start with the same base string as its accompanying app's ID
- The package ID **must** start with the same base string as the contained app and service IDs
- **No dashes** in service names — only letters, numbers, and dots
- One service per `services.json` (multiple services per app are not supported)

---

## File Structure

### Package directory — `packageinfo.json`

```json
{
    "id": "com.example.myapp",
    "package_format_version": 2,
    "loc_name": "My App",
    "version": "1.0.0",
    "icon": "icon.png",
    "miniicon": "icon.png",
    "vendor": "Example Corp",
    "vendorurl": "example.com",
    "app": "com.example.myapp",
    "services": ["com.example.myapp.service"]
}
```

If the package also includes a Synergy account:
```json
{
    ...
    "services": ["com.example.myapp.service"],
    "accounts": ["com.example.myapp.account"]
}
```

### Service directory — `services.json`

```json
{
    "id": "com.example.myapp.service",
    "description": "My App background service",
    "activityTimeout": 30,
    "services": [{
        "name": "com.example.myapp.service",
        "description": "My App service",
        "commands": [
            {
                "name": "hello",
                "assistant": "HelloCommandAssistant",
                "public": true
            },
            {
                "name": "watchStatus",
                "assistant": "WatchStatusAssistant",
                "subscribe": true,
                "public": true
            }
        ]
    }]
}
```

**Key `services.json` fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `activityTimeout` | 30 | Seconds service stays alive after last command completes |
| `commandTimeout` | 30 | Seconds a command can run before timeout error |
| `engine` | `"node"` | `"node"` or `"triton"` — always use `"node"` |
| `globalized` | false | Enable locale-dependent processing (slow — avoid) |
| `commands[].public` | false | Makes command available on the **public bus** (required for third-party callers) |
| `commands[].subscribe` | false | Command accepts subscriptions (keeps service alive) |
| `commands[].watch` | false | Command is watchable (like subscribe but different lifecycle) |

### Service directory — `sources.json`

```json
[
    {
        "library": {
            "name": "foundations",
            "version": "1.0"
        }
    },
    {
        "source": "MyServiceAssistant.js"
    },
    {
        "source": "HelloCommandAssistant.js"
    }
]
```

The Foundations library must be declared here to use Futures, DB access, and other utilities.

### Service directory — `MyServiceAssistant.js` (service-level assistant)

```javascript
// The service assistant is the top-level object for the service.
// It persists as long as the service is running.
// Store inter-command state here.

var MyServiceAssistant = function() {
    this.sharedState = null;
};

MyServiceAssistant.prototype.setup = function() {
    // Optional: return a Future if async setup is needed before any commands run
    // The framework will not dispatch commands until the Future completes.
    console.log("Service starting up");
};

MyServiceAssistant.prototype.cleanup = function() {
    console.log("Service shutting down");
};

// State stored here persists until the service process exits
MyServiceAssistant.prototype.saveState = function(state) {
    this.sharedState = state;
};
```

### Service directory — `HelloCommandAssistant.js` (command assistant)

```javascript
// Each command gets its own assistant class.
// Instantiated fresh for each request.

var HelloCommandAssistant = function() {
};

HelloCommandAssistant.prototype.run = function(future) {
    // this.controller.args — the parameters from the caller
    var name = this.controller.args.name || "World";

    console.log("Hello command running for: " + name);

    // Set future.result to return a response to the caller
    // Must always include returnValue: true on success
    future.result = {
        returnValue: true,
        reply: "Hello, " + name + "!"
    };
};
```

---

## Public Bus vs. Private Bus

By default, all services listen only on the **private bus**, which is accessible only to HP/Palm first-party apps and services. Third-party apps always send on the **public bus**.

To make a command callable by third-party apps, add `"public": true` to that command in `services.json`. This can be set per-command — you can make some commands public and others private.

```json
"commands": [
    { "name": "publicMethod",  "assistant": "PublicAssistant",  "public": true  },
    { "name": "privateMethod", "assistant": "PrivateAssistant", "public": false }
]
```

---

## Calling a Service from an App

### From Mojo

```javascript
// One-shot request
this.controller.serviceRequest("palm://com.example.myapp.service/", {
    method: "hello",
    parameters: { name: "webOS" },
    onSuccess: function(response) {
        Mojo.Log.info("Got:", response.reply);
    },
    onFailure: function(error) {
        Mojo.Log.error("Failed:", error.errorText);
    }
});

// IMPORTANT: For long-lived subscriptions, use Mojo.Service.Request (not controller.serviceRequest)
// The controller cancels requests when its scene closes.
this.serviceRequest = new Mojo.Service.Request("palm://com.example.myapp.service/", {
    method: "watchStatus",
    parameters: { subscribe: true },
    onSuccess: function(response) {
        // Called each time the service sends an update
    }
});
```

### From Enyo 1

```javascript
components: [{
    name: "helloService",
    kind: "PalmService",
    service: "palm://com.example.myapp.service/",
    method: "hello",
    onSuccess: "handleHello",
    onFailure: "handleError"
}],

callHello: function() {
    this.$.helloService.call({ name: "webOS" });
},

handleHello: function(inSender, inResponse) {
    enyo.log("Got:", inResponse.reply);
}
```

---

## Subscriptions (Long-Running Commands)

A subscribeable command lets the service push multiple updates to the caller over time. An open subscription keeps the service alive.

### `services.json`

```json
{
    "name": "watchStatus",
    "assistant": "WatchStatusAssistant",
    "subscribe": true,
    "public": true
}
```

### `WatchStatusAssistant.js`

```javascript
var WatchStatusAssistant = function() {
};

WatchStatusAssistant.prototype.run = function(future, subscription) {
    // future — used for the initial response
    // subscription — FutureFactory for pushing subsequent updates

    // Send the initial acknowledgment
    future.result = {
        returnValue: true,
        subscribed: true,
        message: "Subscription started"
    };

    // Set up a periodic update (example: every 5 seconds)
    var self = this;
    this.interval = setInterval(function() {
        var f = subscription.get();  // get a new Future for the next push
        f.result = {
            returnValue: true,
            message: "Status update: " + new Date().toISOString()
        };
    }, 5000);
};

WatchStatusAssistant.prototype.cancelSubscription = function() {
    // Called when the subscriber cancels
    if (this.interval) {
        clearInterval(this.interval);
    }
};
```

### Calling a subscription from Mojo

```javascript
// Must use Mojo.Service.Request (not controller.serviceRequest) so it
// persists beyond the scene lifecycle
this.statusRequest = new Mojo.Service.Request("palm://com.example.myapp.service/", {
    method: "watchStatus",
    parameters: { subscribe: true },
    onSuccess: function(r) {
        Mojo.Log.info("Update:", r.message);
    }
});

// Later, cancel it:
this.statusRequest.cancel();
```

---

## Keeping State Between Commands

Command assistants are instantiated fresh per request. To preserve state across multiple command invocations (within one service lifetime), store it in the **service assistant**:

```javascript
// In a command assistant:
HelloCommandAssistant.prototype.run = function(future) {
    // Access the service-level assistant for shared state
    var assistant = this.controller.service.assistant;
    assistant.sharedState = { lastCalled: Date.now() };

    future.result = { returnValue: true };
};

// In the service assistant (MyServiceAssistant.js):
MyServiceAssistant.prototype.setup = function() {
    this.sharedState = {};
};
```

> **Note:** This state only persists while the service process is alive (typically 30 seconds after the last command). For true persistence across service restarts, use db8.

---

## Getting Caller Identity

```javascript
// In a command assistant's run():

// Get the calling app's ID (split removes the window identifier suffix)
var callerAppId = this.controller.message.applicationID().split(" ")[0];

// Get the calling service's ID (if called by another service)
var callerServiceId = this.controller.message.senderServiceName();
```

---

## Async Service Setup

If your service assistant needs to perform async operations (e.g., read from db8) before processing any commands, return a Future from `setup()`:

```javascript
MyServiceAssistant.prototype.setup = function() {
    // Return a future — commands will not be dispatched until it resolves
    var future = DB.find({
        query: { from: "com.example.myapp.prefs:1" }
    });
    future.then(this, function(f) {
        this.prefs = f.result.results[0] || {};
        f.result = true;  // signal setup is complete
    });
    return future;
};
```

---

## Node.js Environment

Services run in **Node.js v0.2.x** (the version shipped with webOS varies a little per release). These are a very old versions — be aware:

- ES5 only — no `const`, `let`, arrow functions, Promises, etc.
- The standard Node.js modules for v0.2.x are available (`fs`, `http`, `path`, `net`, `crypto`, etc.)
- **JavaScript-only** npm modules can be bundled in the service directory
- **Native Node.js extensions** (`.node` binary add-ons) are **not allowed**
- NPM is not available on device — bundle dependencies manually

### Initializing `require`

```javascript
// At the top of any file that needs Node's require():
if (typeof require === "undefined") {
    require = IMPORTS.require;
}

// Then use it normally:
var fs = require("fs");
var http = require("http");
var path = require("path");
```

### Loading bundled modules

```javascript
// Load a module bundled in the service directory:
var myLib = require("./lib/mymodule");
```

---

## Filesystem Access

Services run in a **jail** — not the full filesystem. Accessible paths include:

- `/media/internal/` — user storage (USB mass storage area)
- The service's own install directory
- Various system directories (see `/etc/jail_triton.conf` on device for full list)

Not accessible: most of `/usr`, `/etc`, other apps' directories.

---

## Service Lifecycle and Timeouts

```
App calls service method
        ↓
Service process starts (if not running)
        ↓
Command assistant.run() executes
        ↓
future.result set → response sent to caller
        ↓
activityTimeout countdown starts (default: 30s)
        ↓
If no new commands arrive → service process exits
        ↓
Next call restarts the process fresh
```

**Do not** set `activityTimeout` to a large value to keep the service alive — this wastes power and can mask bugs since the service will get killed anyway. Instead:

- Use **subscriptions** (open subscription = service stays alive)
- Use the **Activity Manager** for triggered background work

### Forcing a service exit during development

```bash
# From a device shell (novaterm/ssh):
luna-send -n 1 palm://com.example.myapp.service/_quit '{}'

# Or find and kill manually:
ps aux | grep myapp
kill <pid>
```

When you reinstall a service, if the old process is still running it won't pick up the new code. Always quit the old process first.

---

## Activity Manager Integration

For services that need to run on a schedule or in response to system events (not just app requests), use the Activity Manager rather than long timeouts:

```javascript
// From a service command assistant, create an activity:
var future = new Future();
var activitySpec = {
    "name": "com.example.myapp.service/syncActivity",
    "description": "Periodic sync",
    "type": {
        "foreground": false,
        "background": true,
        "persist": true,         // survive reboots
        "explicit": true         // must be manually started/stopped
    },
    "schedule": {
        "interval": "5m"         // every 5 minutes
    },
    "callback": {
        "method": "palm://com.example.myapp.service/sync"
    }
};

this.controller.service.assistant.activityRequest =
    new Mojo.Service.Request("palm://com.palm.activitymanager", {
        method: "create",
        parameters: {
            activity: activitySpec,
            start: true,
            replace: true
        },
        onSuccess: function(r) { console.log("Activity created:", r.activityId); },
        onFailure: function(r) { console.error("Activity create failed:", r.errorText); }
    });
```

See also: the Activity Manager patterns in `synergy.md` for working examples from the imessage and webcal connectors.

---

## Foundations Library in Services

Services declare Foundations in `sources.json` (shown above). Key imports:

```javascript
// At the top of your service assistant or command file:
var foundations = IMPORTS.foundations;
var Future = foundations.control.Future;

// Or import specific parts:
var DB = IMPORTS.foundations.data.db;         // db8 wrapper
var PalmCall = IMPORTS.foundations.comms.PalmCall;  // Luna bus calls
```

See `synergy.md` for detailed Future chaining patterns — the same patterns apply in services.

---

## Debugging Services

```bash
# View service logs in real time (via novaterm/ssh on device):
tail -f /var/log/messages | grep "myapp"

# Or with luna-send to call your service directly:
luna-send -n 1 palm://com.example.myapp.service/hello '{"name":"test"}'

# Check if service is running:
ps aux | grep myapp.service
```

`console.log()` in service code goes to `/var/log/messages`. There's a length limit on individual log messages — if a log line is silently truncated, break it up or log a subset.

---

## Packaging a Service with an App

The app can be a stub — just enough to satisfy the "must have an app" requirement. You can hide the app from the Launcher:

```json
{
    "id": "com.example.myapp",
    "title": "My Service",
    "main": "index.html",
    "noWindow": true,
    "version": "1.0.0",
    "type": "web",
    "vendor": "Example Corp",
    "vendorurl": "example.com",
    "icon": "icon.png"
}
```

A `noWindow: true` app doesn't show a card — useful for pure service packages.

---

## Complete Hello World Example

**Directory layout:**
```
HelloWorld/
├── helloworld.package/
│   └── packageinfo.json
├── helloworld.app/
│   ├── appinfo.json
│   └── index.html
└── helloworld.service/
    ├── services.json
    ├── sources.json
    └── HelloCommandAssistant.js
```

**`helloworld.service/services.json`:**
```json
{
    "id": "com.palmdts.helloworld.service",
    "description": "Hello World Demo Service",
    "activityTimeout": 30,
    "services": [{
        "name": "com.palmdts.helloworld.service",
        "description": "hello world example",
        "commands": [{
            "name": "hello",
            "assistant": "HelloCommandAssistant",
            "public": true
        }]
    }]
}
```

**`helloworld.service/sources.json`:**
```json
[
    { "library": { "name": "foundations", "version": "1.0" } },
    { "source": "HelloCommandAssistant.js" }
]
```

**`helloworld.service/HelloCommandAssistant.js`:**
```javascript
var HelloCommandAssistant = function() {};

HelloCommandAssistant.prototype.run = function(future) {
    var name = this.controller.args.name || "World";
    console.log("Hello " + name);
    future.result = { returnValue: true, reply: "Hello " + name + "!" };
};
```

**Build and install:**
```bash
palm-package helloworld.package helloworld.app helloworld.service
palm-install com.palmdts.helloworld_1.0.0_all.ipk

# Test from command line:
luna-send -n 1 palm://com.palmdts.helloworld.service/hello '{"name":"webOS"}'
# → {"returnValue":true,"reply":"Hello webOS!"}
```

---

## See Also

- `webos://knowledge/services` — quick reference for *calling* built-in Luna services from app code (the client side)
- `webos://knowledge/synergy` — specialised Node.js services that integrate with Contacts, Messaging, and Calendar
