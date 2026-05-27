# webOS Synergy Services

webOS Synergy is the extensible account/sync framework that backs Contacts, Messaging, and Calendar. Third-party services can add new account types that write into the native apps' data stores by extending system DB8 kinds. The SDK documentation was sparse and often wrong; what follows is distilled from two working services.

**Reference projects:**
- **webos-imessage-synergy** (`com.wosa.imessage`) — bridges iMessages from a Mac to the native Messages app
- **webos-webcal-synergy** (`org.webosarchive.webcal`) — syncs public .ics calendar feeds into the Calendar app

---

## Core Architecture

A Synergy service is a Node.js service with three mandatory parts:

1. **Account template** (`accounts/account-template.json`) — declares the service to the Accounts app: capabilities, icons, credential labels, permission lists
2. **Service endpoint** (`service/services.json`) — lists the service's Luna bus methods and which assistant handles each
3. **Assistant implementations** — functions in Node.js with `.prototype.run` (and optionally `.prototype.complete`) called by the Synergy framework

### Required Synergy Service Endpoints

```javascript
// All of these must be declared in services.json:
checkCredentials         // validate credentials; return config object
onCreate                 // account created; save credentials to keymanager
onEnabled                // sync enabled/disabled toggled; start sync here
onDelete                 // account deleted; clean up all DB8 data
onCapabilitiesChanged    // optional; called when provider list changes
onCredentialsChanged     // optional; called when user updates credentials
sync                     // your main sync logic
```

For messaging, also implement:
```javascript
sendIM                   // called by webOS when user sends a message
```

### account-template.json skeleton

```json
{
    "templateId": "com.example.myservice.account",
    "loc_name": "My Service",
    "loc_shortName": "My Service",
    "hidden": false,
    "invisible": false,
    "implementation": "palm://com.example.myservice.service/",
    "readPermissions": ["com.example.myservice.service", "com.palm.app.messaging"],
    "writePermissions": ["com.example.myservice.service", "com.palm.app.messaging"],
    "validator": "palm://com.example.myservice.service/checkCredentials",
    "loc_usernameLabel": "Your Name",
    "loc_passwordLabel": "Password",
    "icon": {"loc_32x32": "images/icon-32.png", "loc_48x48": "images/icon-48.png"},
    "capabilityProviders": [{
        "id": "com.example.myservice.account",
        "capability": "MESSAGING",
        "alwaysOn": true,
        "chatWithNonBuddies": true,
        "readOnlyData": false,
        "serviceName": "myService",
        "implementation": "palm://com.example.myservice.service/",
        "onCreate": "palm://com.example.myservice.service/onCreate",
        "onEnabled": "palm://com.example.myservice.service/onEnabled",
        "onDelete": "palm://com.example.myservice.service/onDelete",
        "onCapabilitiesChanged": "palm://com.example.myservice.service/onCapabilitiesChanged",
        "onCredentialsChanged": "palm://com.example.myservice.service/onCredentialsChanged",
        "sync": "palm://com.example.myservice.service/sync",
        "sendIM": "palm://com.example.myservice.service/sendIM",
        "dbkinds": {
            "immessage": "com.example.myservice.immessage:1",
            "chatthread": "com.example.myservice.chatthread:1"
        }
    }]
}
```

For calendar, the `capability` is `"CALENDAR"` and `dbkinds` lists your calendar/event kinds instead.

---

## Foundations Imports (prologue.js)

All Synergy Node.js services start with a `prologue.js` that imports from the Foundations library:

```javascript
if (typeof require === "undefined") {
    require = IMPORTS.require;
}
var Foundations = IMPORTS.foundations;
var DB         = Foundations.Data.DB;
var Future     = Foundations.Control.Future;
var PalmCall   = Foundations.Comms.PalmCall;
var AjaxCall   = Foundations.Comms.AjaxCall;
```

List `prologue.js` first in `sources.json`, then your service endpoints. The library names `DB`, `Future`, and `PalmCall` become globals available everywhere.

---

## DB8 Kinds for Synergy

### The sub-kind pattern

Apps cannot insert records into Palm's system kinds directly. Instead, derive a sub-kind:

```javascript
// DB8 kind definition (service/configuration/db/kinds/):
{
    "id": "com.example.myservice.immessage:1",
    "owner": "com.example.myservice.service",
    "extends": "com.palm.immessage:1",
    "indexes": [
        {"name": "accountId", "props": [{"name": "accountId"}]},
        {"name": "iMessageId", "props": [{"name": "iMessageId"}]},
        {"name": "statusFolder", "props": [{"name": "status"}, {"name": "folder"}]}
    ]
}
```

Any sub-kind records from `com.palm.chatthread:1` and `com.palm.immessage:1` are automatically rendered in the native Messages app — but only if all required fields are correctly populated.

### CRITICAL: DB8 WHERE clause ordering must match index prefix

DB8 silently returns empty results if the `where` clause property order doesn't match the index definition prefix order.

```javascript
// Given index: ["accountId", "remoteId"] (accountId declared first)
// CORRECT:
{"where": [{"prop": "accountId", "op": "=", "val": id},
           {"prop": "remoteId",  "op": "=", "val": rid}]}

// WRONG — silently returns empty:
{"where": [{"prop": "remoteId",  "op": "=", "val": rid},
           {"prop": "accountId", "op": "=", "val": id}]}
```

**Workaround:** Query on a single-prop index (like `accountId`), then filter the results in JavaScript. Safer than relying on multi-prop index ordering.

### DB8 query with Foundations DB library vs PalmCall

The Foundations `DB` library takes a bare query object (no `"query":{}` wrapper):
```javascript
// Foundations DB library (no wrapper):
var q = {"from": "com.example.myservice.immessage:1",
         "where": [{"prop": "iMessageId", "op": "=", "val": threadId}]};
DB.find(q, false, false).then(function(future) {});

// PalmCall (requires "query" wrapper):
var q = {"query": {"from": "com.example.myservice.immessage:1"}};
PalmCall.call("palm://com.palm.db/", "find", q).then(function(future) {});
```

### DB.merge: with vs without `_rev`

```javascript
// Conditional (version-checked) — fails with conflict if _rev is stale:
DB.merge([{_id: id, _rev: rev, field: value}])

// Unconditional (last-write-wins) — correct for most service writes:
DB.merge([{_id: id, field: value}])
```

Do NOT include `_rev` when merging records that another process might also update. The Sync service may update a record's `_rev` between when the companion app loaded it and when it tries to save.

### DB8's ~500 record page limit

`DB.find` with no filter returns a maximum of ~500 records per call. If total count exceeds this, old records fall off and re-appear as "new" on the next sync — causing a duplicate flood.

**Fix:** Always filter queries. Add a `where` clause on a thread/account ID rather than fetching everything.

---

## Futures (webOS async pattern)

webOS predates ES6 Promises. The Foundations Future is the async primitive.

### Chaining futures (preferred over nesting)

```javascript
var f = PalmCall.call("palm://com.palm.db/", "find", q).then(this, function(future) {
    if (future.result.returnValue !== true) {
        future.result = {returnValue: false};  // abort chain
        return;
    }
    // Return the next async call — f.then() sees its result
    return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname": "AcctUsername"});
});

f.then(this, function(future) {
    // f.result is now the keymanager response
    username = Base64.decode(f.result.keydata);
    return PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname": "AcctPassword"});
});

f.then(this, function(future) {
    password = Base64.decode(f.result.keydata);
    future.result = {returnValue: true};
});
```

### CRITICAL: All future.then() callbacks always fire

Setting `future.result` in callback N causes callback N+1 to run. There is **no way to skip a callback mid-chain**. Use a `skipReason` closure variable:

```javascript
var skipReason = null;

future.then(function() {
    if (somethingFailed) {
        skipReason = "fetchFailed";
        future.result = {returnValue: false};
        return;
    }
    // ... normal work ...
});

future.then(function() {
    if (skipReason) {
        future.result = {returnValue: false};  // propagate
        return;
    }
    // ... normal work ...
});

// Final cleanup callback — always runs:
future.then(function() {
    SyncStatus.setDone();
    future.result = {more: false, entries: entries};
});
```

### Resolving a future aborts current execution

Setting `future.result` is immediate and terminal for the current callback — don't set it until you're done processing.

---

## Credentials: Keymanager

Store account credentials in the system keymanager, not in DB8. The keymanager encrypts them:

```javascript
// In onCreate: save credentials
var B64username = Base64.encode(args.config.username);
var B64password = Base64.encode(args.config.password);
PalmCall.call("palm://com.palm.keymanager/", "store", {
    "keyname": "AcctUsername",
    "keydata": B64username,
    "type": "AES",
    "nohide": true
}).then(function(f) {
    PalmCall.call("palm://com.palm.keymanager/", "store", {
        "keyname": "AcctPassword",
        "keydata": B64password,
        "type": "AES",
        "nohide": true
    }).then(function(f2) {
        future.result = f2.result;
    });
});

// In sync: retrieve credentials
PalmCall.call("palm://com.palm.keymanager/", "fetchKey", {"keyname": "AcctUsername"})
    .then(function(f) {
        username = Base64.decode(f.result.keydata);
        // ...
    });

// In onDelete: clean up
PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctUsername"});
PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctPassword"});
```

### checkCredentials pattern

```javascript
var checkCredentialsAssistant = function(future) {};
checkCredentialsAssistant.prototype.run = function(future) {
    var args = this.controller.args;
    // Delete old credentials, then confirm new ones
    PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctUsername"}).then(function(f) {
        PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctPassword"}).then(function(f2) {
            future.result = {
                returnValue: true,
                "credentials": {"common": {"password": args.password, "username": args.username}},
                "config": {"password": args.password, "username": args.username}
            };
        });
    });
};
```

The returned `config` object is passed to `onCreate`. Use it to save the real credentials to the keymanager.

---

## ActivityManager: Scheduling Periodic Syncs

The SDK docs describe ActivityManager, but the code patterns that actually work were reverse-engineered:

```javascript
var syncActivity = {
    "start": true,
    "replace": true,
    "activity": {
        "name": "MyServicePeriodicSync",
        "description": "Periodic sync",
        "type": {
            "background": true,
            "power": true,
            "explicit": true,
            "persist": true
        },
        "requirements": {"internet": true},
        "schedule": {
            "precise": true,
            "interval": "2m"    // "2m", "30m", "1h", etc.
        },
        "callback": {
            "method": "palm://com.example.myservice.service/periodicSync",
            "params": {timedSync: true}
        }
    }
};

PalmCall.call("palm://com.palm.activitymanager/", "create", syncActivity).then(function(f) {
    future.result = {returnValue: true};
});
```

Use `"replace": true` to recreate the activity each sync cycle instead of trying to `complete()` the old one. Activities sometimes disappear before the complete callback runs.

### DB-triggered activity (outbox watch)

To fire immediately when a DB8 record changes (e.g., new outbox message):

```javascript
var outboxWatchActivity = {
    "start": true,
    "replace": true,
    "activity": {
        "name": "MyServiceOutboxWatch",
        "type": {"foreground": true, "power": true, "powerDebounce": true, "explicit": true, "persist": true},
        "requirements": {"internet": true},
        "trigger": {
            "method": "palm://com.palm.db/watch",
            "key": "fired",     // watches for fired:true in the db/watch response
            "params": {
                "query": {
                    "from": "com.example.myservice.immessage:1",
                    "where": [
                        {"prop": "status", "op": "=", "val": "pending"},
                        {"prop": "folder", "op": "=", "val": "outbox"}
                    ]
                },
                "subscribe": true
            }
        },
        "callback": {
            "method": "palm://com.example.myservice.service/processOutbox",
            "params": {}
        }
    }
};
```

Re-arm the watch in the assistant's `complete()` method:
```javascript
processOutbox.prototype.complete = function() {
    if (this.controller && this.controller.activityId) {
        PalmCall.call("palm://com.palm.activitymanager/", "complete", {
            activityId: this.controller.activityId,
            restart: true
        });
    }
};
```

---

## Writing Messages to the Messages App

### chatthread record

```javascript
var dbThread = {
    _kind: "com.example.myservice.chatthread:1",
    flags: {visible: true},
    normalizedAddress: username,
    displayName: "Contact Name",
    replyAddress: "contact-reply-id",
    replyService: "myService",
    summary: "Last message text",
    iMessageId: remoteThreadId,      // your remote thread ID
    iMessageReplyId: fullReplyPath,  // full reply routing string
    timestamp: Date.now(),
    iMessageLastReceived: isoTimestamp,  // for delta detection
};
DB.put([dbThread]).then(function(result) {
    var threadDbId = result.result.results[0].id;  // webOS _id for linking messages
});
```

### immessage record (unthreaded — auto-creates a thread)

```javascript
var dbMsg = {
    _kind: "com.example.myservice.immessage:1",
    _sync: true,
    flags: {visible: true},
    folder: "inbox",          // "inbox" for received, "outbox" for sent
    localTimestamp: Date.now(),
    messageText: "Message body",
    serviceName: "type_myService",   // must match serviceName in account template
    status: "successful",
    from: [{addr: "sender-id", name: "Sender Name"}],
    to:   [{addr: "recipient-id", name: "My Name"}],
};
```

### immessage record (threaded — links to a chatthread)

Add `conversations: [threadDbId]` to link to an existing thread:
```javascript
var dbMsg = {
    _kind: "com.example.myservice.immessage:1",
    // ... same fields ...
    conversations: [threadDbId],   // DB8 _id of the chatthread record
};
DB.put([dbMsg]);
```

If a message record is inserted **without** a `conversations` array, the Messages app auto-creates a new chatthread — but your service won't know its DB8 ID, making it hard to link subsequent messages. Always create the chatthread explicitly first.

---

## Sending Messages (sendIM)

webOS pre-creates a DB8 record with `status: "pending"` before calling `sendIM`. You must flip it to `"successful"` after sending, or `"failed"` on error. Do NOT create a new record — the original pending one stays stuck forever.

```javascript
var sendIM = function(future){};
sendIM.prototype.run = function(future) {
    var args = this.controller.args;
    var pendingMsgId = args._id || null;   // DB8 _id of the pre-created pending record

    // Send the message via your transport...
    // On success:
    if (pendingMsgId) {
        DB.merge([{_kind: "com.example.myservice.immessage:1",
                   "_id": pendingMsgId,
                   "status": "successful"}]);
    }

    // On failure:
    if (pendingMsgId) {
        var attempts = (args.sendAttempts || 0) + 1;
        DB.merge([{_kind: "com.example.myservice.immessage:1",
                   "_id": pendingMsgId,
                   "status": "failed",
                   "sendAttempts": attempts}]);
    }

    future.result = {returnValue: true};
};
```

**Note:** BusyBox `wget` on the device does NOT support `--post-data` or `--post-file`. For HTTP POST, use Node.js `http.request` directly, not `child_process.exec` + wget.

---

## HTTP in Synergy Services

For GET requests (fetching data):
```javascript
var cmd = "wget -q -O - " + url;
child_process.exec(cmd, function(error, stdout, stderr) {
    future.result = {returnValue: error == null, data: stdout};
});
```

For POST requests (sending data):
```javascript
var http = require('http');
var postOptions = {
    host: host,
    port: parseInt(port),
    path: "/endpoint",
    method: "POST",
    headers: {"Content-Type": "application/json", "Content-Length": body.length}
};
var req = http.request(postOptions, function(res) {
    var responseData = "";
    res.on("data", function(chunk) { responseData += chunk; });
    res.on("end", function() {
        future.result = {returnValue: res.statusCode < 400, data: responseData};
    });
});
req.on("error", function(e) {
    future.result = {returnValue: false, data: ""};
});
req.write(body);
req.end();
```

**Strip protocol prefix from host:** If the user configures `"http://192.168.1.1"` as a host, and you prepend `"http://"`, you get `http://http://...`. Always strip any embedded protocol from the host field before constructing the URL:
```javascript
if (host.indexOf("://") !== -1) {
    host = host.split("://")[1];
}
if (host.indexOf(":") !== -1) {
    host = host.split(":")[0];  // strip any embedded port too
}
```

---

## Calendar Synergy (CalDAV/iCal pattern)

For calendar sync, the service extends `Sync.SyncCommand` from the Foundations library (unlike messaging which uses plain service endpoints).

### Sync flow

```javascript
var SyncAssistant = Class.create(Sync.SyncCommand, {
    run: function(outerFuture) {
        var args = this.controller.args || {};

        if (!args.capability) {
            // Outer call: route to inner call with capability
            future.nest(PalmCall.call("palm://myservice/", "sync", {
                accountId: accountId,
                capability: "CALENDAR"
            }));
            // ...
        } else {
            // Inner call: framework drives getRemoteChanges per kind
            this.SyncKey = new SyncKey(this.client, this.handler);
            this.$super(run)(future);
        }
    },

    getSyncOrder: function() { return this.client.kinds.syncOrder; },
    getRemoteChanges: function(state, kindName) {
        // Called once per kind (calendar, then calendarevent)
        // Return: {returnValue, more, entries: [...]}
    }
});
```

### META calendar trick (multi-calendar display names)

CalendarsManager uses the account's `alias` field as the display name when there's only one calendar. To force it to use each calendar's own `name` instead:

Create a hidden pseudo-calendar with a stable `remoteId: "webcal-meta"`. This forces every account into the "multi-calendar" code path where individual calendar names are used. The META calendar is excluded from "All", set `visible: false`, and is never deleted (it persists until the account itself is deleted).

### ctag hash change detection

Compute a hash of the remote resource body. Only re-parse if the hash changed from the stored value. Use a streaming line-by-line hash to avoid materializing two full copies of large responses:

```javascript
var hash = crypto.createHash("md5");
var lines = data.split("\n");
for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf("DTSTAMP:") === 0) { continue; }  // skip volatile field
    hash.update(lines[i]);
}
var newHash = hash.digest("hex");
if (newHash === storedCtag) { /* no change, skip */ }
```

Stripping `DTSTAMP` is critical — it changes every download even when content hasn't changed.

### OOM on the TouchPad (SIGABRT, not SIGKILL)

The OOM killer sends **SIGABRT (signal 6)**, not SIGKILL. Fingerprint in `dmesg`: `CRASH! myservice.js(<pid>) received 6`. The service dies silently mid-sync with the log frozen at the last fetch line and no batch output.

TouchPad OOM threshold: ~25–30MB RSS. Mitigations:
- **Attendee cap:** 10 per event (strip excess ATTENDEE lines before parsing)
- **Description truncation:** 500 chars
- **Batch large feeds:** Process BATCH_SIZE (50) events per sync invocation; write remainder to temp files on `/media/internal/` (dot-prefixed, auto-cleaned)
- **Streaming hash:** Never allocate a second full copy of the raw response body
- **Explicit null-out:** Set large variables to `null` after use to give GC early collection hints

---

## Recursive Sync Loop Anti-Pattern

When new threads/records are discovered, do NOT call sync recursively in a `DB.put` callback. The puts are fire-and-forget; the recursive sync runs before they complete, doesn't see the new records, creates them again, and loops.

**Wrong:**
```javascript
DB.put([newThread]).then(function() {
    PalmCall.call("palm://myservice/", "sync", {});  // LOOP
});
```

**Right:** Let the next periodic sync pick up new records. Call your per-item sync (`syncChat`, etc.) directly with the `_id` from the put result:
```javascript
DB.put([newThread]).then(function(result) {
    var newId = result.result.results[0].id;
    PalmCall.call("palm://myservice/", "syncChat", {conversationId: newId, ...});
    // Do NOT call sync here
});
```

---

## onDelete: Cleanup Sequence

Delete in reverse dependency order. Use a chained future:

```javascript
var onDeleteAssistant = function(future){};
onDeleteAssistant.prototype.run = function(future) {
    var args = this.controller.args;
    future.result = {returnValue: true};

    // Cancel activities (fire and forget)
    PalmCall.call("palm://com.palm.activitymanager/", "cancel", {"activityName": "MyPeriodicSync"});

    // Chain: delete transport config → messages → threads → credentials
    var q = {"query": {"from": "com.example.myservice.transport:1"}};
    var f = PalmCall.call("palm://com.palm.db/", "del", q).then(function(future) {
        q = {"query": {"from": "com.example.myservice.immessage:1"}};
        return PalmCall.call("palm://com.palm.db/", "del", q);
    });
    f.then(function(future) {
        q = {"query": {"from": "com.example.myservice.chatthread:1"}};
        return PalmCall.call("palm://com.palm.db/", "del", q);
    });
    f.then(function(future) {
        return PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctUsername"});
    });
    f.then(function(future) {
        return PalmCall.call("palm://com.palm.keymanager/", "remove", {"keyname": "AcctPassword"});
    });
    f.then(function(future) {
        future.result = {returnValue: true};
    });
};
```

---

## Debugging

### The jail problem

Once a Synergy account is added, the service code is **copied into a jail** and run from there. Installing new code doesn't matter — the device keeps running the old jailed copy.

**Full update sequence:**
1. Remove the account from the Accounts app
2. Wait for cleanup to complete
3. Uninstall the app package
4. Restart Luna: `luna-send -n 1 luna://org.webosinternals.ipkgservice/restartLuna '{}'`
5. Re-install the app

**Testing without a Synergy account** (skips the jail):
```bash
luna-send -n 1 -a com.example.myservice.service \
  palm://com.example.myservice.service/sync '{}'
```

### Log watching

```bash
tail -f /var/log/messages
# or
ls-monitor
```

Use a distinctive prefix for log lines (e.g., `"!#######* "`) so they're easy to grep:
```javascript
function logNoticeably(message) {
    console.log("!#######* " + message + "\n");
}
```

### Inspecting DB8 records

Use **Impostah** (available in Preware) to browse DB8 records interactively on the device.

From the command line (as the service identity):
```bash
luna-send -n 1 -a com.example.myservice.service \
  'palm://com.palm.db/find' \
  '{"query":{"from":"com.example.myservice.immessage:1"}}'
```

**novacom luna-send truncation:** `novacom run file:///usr/bin/luna-send` silently truncates output for large result sets. Workaround:
```bash
cat > /tmp/query.sh << 'EOF'
luna-send -n 1 -a com.example.myservice.service \
  'palm://com.palm.db/find' '{"query":{"from":"com.example.myservice.immessage:1"}}' \
  > /tmp/result.json 2>&1
EOF
novacom put file:///tmp/query.sh < /tmp/query.sh
novacom run file:///bin/sh -- /tmp/query.sh
novacom run file:///bin/cat -- /tmp/result.json
```

### Triggering a manual sync

```bash
luna-send -n 1 -a com.example.myservice.service \
  palm://com.example.myservice.service/sync '{}'
```

---

## Common Bugs Fixed in Practice

### Missing `return` after early guard

Setting `future.result` to abort but not returning lets execution continue:
```javascript
// WRONG:
if (!args.conversationId) {
    future.result = {returnValue: false};
    // falls through!
}
// CORRECT:
if (!args.conversationId) {
    future.result = {returnValue: false};
    return;
}
```

### Global variable leaks

Every variable in service files needs `var`. Missing `var` on a variable that's used across callbacks creates a global and causes state bleed between invocations:
```javascript
// WRONG (leaks as global):
syncActivity = { ... };

// CORRECT:
var syncActivity = { ... };
```

### Error branch returning success

If an error branch sets `{returnValue: true}`, the future chain continues as if it succeeded:
```javascript
// WRONG:
if (error) {
    future.result = {returnValue: true};  // chain continues with bogus data
    return;
}
// CORRECT:
if (error) {
    future.result = {returnValue: false};
    return;
}
```

### Accessing `.results` before checking `returnValue`

If an earlier step fails and `results` is missing, accessing `.results.length` crashes:
```javascript
// WRONG:
var count = future.result.results.length;

// CORRECT:
if (future.result.returnValue === true && future.result.results) {
    var count = future.result.results.length;
}
```

---

## ES5 Constraint

Synergy services run on a very old Node.js. ES5 only:
- No arrow functions (`=>`)
- No `let`/`const` (use `var`)
- No template literals (use `+` concatenation)
- No destructuring
- No shorthand properties (`{foo}`)
- No `class` / `import` / `export`
- No spread (`...`)

Run `node --check service.js` before every build. A SyntaxError crashes the service silently with no log output.

---

## Services.json Example

```json
{
    "id": "com.example.myservice.service",
    "description": "My Synergy Service",
    "engine": "node",
    "activityTimeout": 60,
    "services": [{
        "name": "com.example.myservice.service",
        "description": "My Synergy Service",
        "globalized": false,
        "commands": [
            {"name": "checkCredentials",      "assistant": "checkCredentialsAssistant", "public": true},
            {"name": "onCapabilitiesChanged", "assistant": "onCapabilitiesChangedAssistant", "public": true},
            {"name": "onCredentialsChanged",  "assistant": "onCredentialsChangedAssistant", "public": true},
            {"name": "onCreate",              "assistant": "onCreateAssistant", "public": true},
            {"name": "onEnabled",             "assistant": "onEnabledAssistant", "public": true},
            {"name": "onDelete",              "assistant": "onDeleteAssistant", "public": true},
            {"name": "sync",                  "assistant": "syncAssistant", "public": true},
            {"name": "sendIM",                "assistant": "sendIM", "public": true},
            {"name": "periodicSync",          "assistant": "periodicSync", "public": true},
            {"name": "processOutbox",         "assistant": "processOutbox", "public": true}
        ]
    }]
}
```

And `sources.json`:
```json
[
    {"library": {"name": "foundations", "version": "1.0"}},
    {"source": "prologue.js"},
    {"source": "serviceEndPoints.js"}
]
```

---

## See Also

- `webos://knowledge/js-services` — full reference for writing Node.js Luna services (Synergy services are a specialised form of these)
