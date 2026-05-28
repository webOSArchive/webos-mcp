# Activity Manager

The Activity Manager (`com.palm.activitymanager`) is the traffic cop for everything running on the device. Any non-trivial background work — a sync, a scheduled poll, a triggered network task — should be managed as an Activity so the OS can prioritize, schedule, batch, and kill processes correctly without killing user-visible work.

> **Key insight for services:** A service that stays running while waiting for an event wastes memory. The correct pattern is to create an Activity with a trigger or schedule, then *exit*. The Activity Manager will relaunch your service when the condition fires.

---

## Core Concepts

**Activity** — A unit of work with a lifecycle the OS tracks. Every non-trivial service operation should be associated with one.

**Parent** — The creator of an Activity. If the parent exits without completing or releasing the Activity, the Activity is canceled (unless it's persistent or explicit).

**Adopter** — A subscriber that is willing to take over as parent if the original parent exits. Services use `adopt` to signal this. If a service receives an `orphan` event, it is now the parent and must call `complete` when done.

**Subscriber** — Any caller that is monitoring an Activity via `monitor`. Receives lifecycle events but cannot become the parent.

---

## Lifecycle Methods

| Method | When to use |
|--------|-------------|
| `create` | Create and optionally start a new Activity |
| `adopt` | Adopt an Activity from an incoming request — signals willingness to become parent |
| `monitor` | Watch an Activity without taking ownership |
| `complete` | End the Activity; optionally restart it with new schedule/trigger/callback |
| `stop` | End with time allowed for cleanup |
| `cancel` | End immediately, minimal cleanup |
| `release` | Relinquish parenthood, allow adopters to take over |

---

## Incoming Request Pattern

When a service receives an inbound call (from an app or from the Activity Manager itself as a scheduled callback), it must adopt or monitor before doing work:

```javascript
// Service method handler:
function handleRequest(message) {
    var activityId = message.payload.$activity && message.payload.$activity.activityId;

    // Adopt signals willingness to keep Activity alive if the caller exits
    palm.call("palm://com.palm.activitymanager/adopt", {
        activityId: activityId,
        wait: true,
        subscribe: true,
        detailedEvents: false
    }, function(e) {
        if (!e.returnValue) {
            // Caller already exited — do not process the request
            return;
        }
        // Safe to proceed
        doWork(message, activityId);
    });
}

function doWork(message, activityId) {
    // ... do the work ...

    // When done, complete the Activity
    palm.call("palm://com.palm.activitymanager/complete", {
        activityId: activityId
    });
}
```

**Critical:** Always wait for `adopt` (or `monitor`) to succeed before proceeding. If it fails, the caller has already quit — do not process the request.

---

## Scheduled Activity Pattern

For periodic background work (e.g., a sync that runs every hour):

```javascript
// Create a repeating scheduled Activity with a callback
this.controller.serviceRequest("palm://com.palm.activitymanager/", {
    method: "create",
    parameters: {
        activity: {
            name: "com.example.myapp.sync",
            description: "Hourly sync",
            type: {
                foreground: false,   // background
                persist: true,       // survives reboot
                explicit: true       // must be explicitly completed
            },
            schedule: {
                interval: "1h"       // smart interval — batched with others
            },
            callback: {
                method: "palm://com.example.myapp.service/sync"
            }
        },
        start: true,
        replace: true   // replace any existing Activity with this name
    }
});
```

When the interval fires, the Activity Manager calls your service's `sync` method with a `$activity` property in the payload. Your service should:

1. Call `adopt` on the incoming `activityId`
2. Do the sync work
3. Call `complete` with `restart: true` and an updated `schedule` to reschedule

```javascript
// In your sync handler:
palm.call("palm://com.palm.activitymanager/complete", {
    activityId: activityId,
    restart: true,
    schedule: { interval: "1h" }
});
```

**Do not** call `complete` followed by `create` to reschedule — a crash between those two calls loses the Activity. Use `complete` with `restart: true` instead.

---

## Triggered Activity Pattern

An Activity can wait on an external event (a db8 change, a network status change) without the service staying alive:

```javascript
this.controller.serviceRequest("palm://com.palm.activitymanager/", {
    method: "create",
    parameters: {
        activity: {
            name: "com.example.myapp.network-watch",
            description: "Wait for network to come up",
            type: { foreground: false, persist: true, explicit: true },
            trigger: {
                method: "palm://com.palm.connectionmanager/getstatus",
                params: { subscribe: true },
                // Fire when isInternetConnectionAvailable becomes true
                where: {
                    prop: "isInternetConnectionAvailable",
                    op: "=",
                    val: true
                }
            },
            callback: {
                method: "palm://com.example.myapp.service/onNetworkUp"
            }
        },
        start: true
    }
});
// Service can now exit. Activity Manager waits on its behalf.
```

---

## Activity Type Flags

| Flag | Meaning |
|------|---------|
| `foreground: true` | Run immediately when prerequisites met (default) |
| `foreground: false` | Background — runs when resources allow |
| `persist: true` | State stored in db8, survives reboot |
| `explicit: true` | Can only be terminated by parent via `stop`/`cancel`/`complete` |
| `power: true` | Keep device awake while Activity runs |
| `powerDebounce: true` | Stay awake briefly after Activity ends (waiting for follow-up) |

---

## Requirements

Activities can declare prerequisites that must be met before they run:

```javascript
requirements: {
    internet: true,          // internet connectivity required
    telephony: true,         // telephony stack must be up
    charging: false          // do NOT require charging
}
```

If requirements are not met when the Activity is ready to run, the Activity Manager waits. If requirements change while an Activity is running, subscribers receive an `update` event.

---

## Checklists

**Incoming requests:**
- Adopt (or monitor) before doing work — if adopt fails, the caller has gone, abort
- Watch for `cancel` events; stop processing immediately if received
- Call `complete` when done with persistent/explicit Activities

**Scheduled/triggered Activities:**
- Exit the service when there's no work; use Activity Manager to relaunch
- Use `complete` with `restart: true` to reschedule, not `complete` + `create`
- Use smart (`interval`) scheduling rather than precise — saves battery
- Verify trigger parameters are correct; a bad trigger fires infinitely

---

## See Also

- `webos://knowledge/js-services` — Writing the Node.js service that handles Activity callbacks
- `webos://knowledge/alarms` — Simpler alternative for timer-based wake-ups that don't need the full Activity lifecycle
