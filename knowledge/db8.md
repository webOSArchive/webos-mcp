# db8 Database

db8 (`com.palm.db`) is webOS's on-device JSON database, backed by a high-performance embedded store. Apps use it for structured data that needs querying, change notifications, cross-app sharing, or cloud sync. It is significantly more capable than `localStorage` but also more complex to set up correctly.

> **Synergy integration:** If you are writing a Synergy connector that extends the system Contacts, Messaging, or Calendar kinds, see `synergy.md` — it covers the db8 permission and kind extension patterns specific to that use case.

> **Where db8 actually lives on disk:** `/var/db/` is mounted from an *encrypted* dm-crypt volume (`store-cryptodb`), unlocked at boot by `mountcrypt` using a key derived from the device's NDUID. If mountcrypt fails (corrupt key blob, NDUID overridden too early in boot, etc.) the system silently falls back to writing to the unencrypted `/var` partition, where BDB transactions abort and no kind registrations or rows ever durably commit — every find then returns `kind not registered`. If you ever see system-wide "kind not registered" errors right after boot, check `mount | grep /var/db` first. See `system-internals.md` for the full diagnosis.

---

## Core Concepts

**Kind** — A schema definition. You must register a kind before storing data of that type. Think of it as a table definition. Kinds have a versioned ID (`com.example.myapp.item:1`), an owner, optional JSON schema validation, and index definitions.

**Data object** — A JSON object stored under a kind. db8 automatically assigns `_id`, `_rev`, and `_kind` properties.

**Index** — Determines what queries you can run. **Queries can only filter on indexed fields.** Design your indexes before you design your queries.

---

## Setting Up a Kind

```javascript
// Mojo
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "putKind",
    parameters: {
        id: "com.example.myapp.item:1",
        owner: "com.example.myapp",
        indexes: [
            { name: "by_name",     props: [{ name: "name" }] },
            { name: "by_category", props: [{ name: "category" }, { name: "name" }] }
        ]
    },
    onSuccess: function() { /* kind is ready */ },
    onFailure: function(e) { Mojo.Log.error("putKind failed: " + JSON.stringify(e)); }
});

// Enyo
{ kind: "PalmService", name: "putKindSvc",
  service: "palm://com.palm.db/", method: "putKind",
  onSuccess: "kindReady", onFailure: "kindFailed" }
this.$.putKindSvc.call({ id: "com.example.myapp.item:1", owner: "com.example.myapp",
    indexes: [{ name: "by_name", props: [{ name: "name" }] }] });
```

The kind ID version number (`:1`) must be incremented when the kind changes in a backward-incompatible way.

---

## Storing Objects

```javascript
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "put",
    parameters: {
        objects: [
            { _kind: "com.example.myapp.item:1", name: "Widget", category: "tools", price: 9.99 },
            { _kind: "com.example.myapp.item:1", name: "Gadget", category: "tools", price: 14.99 }
        ]
    },
    onSuccess: function(e) {
        // e.results is an array of { id, rev } for each stored object
    }
});
```

---

## Querying

```javascript
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "find",
    parameters: {
        query: {
            from:    "com.example.myapp.item:1",
            where:   [{ prop: "category", op: "=", val: "tools" }],
            orderBy: "name",
            desc:    false,
            limit:   50   // max 500
        }
    },
    onSuccess: function(e) { /* e.results is the object array */ }
});
```

### Query operators

| Operator | Meaning |
|----------|---------|
| `=` | Equals |
| `<`, `<=`, `>`, `>=` | Comparison |
| `!=` | Not equal |
| `%` | Prefix (starts with) — like SQL `LIKE 'val%'` |
| `?` | Full-text search |

**Important constraints:**
- All `where` clauses are implicitly AND'd — OR is not supported
- You can only filter on indexed fields
- Multi-property indexes are ordered: a `[category, name]` index supports filtering on `category` alone or `category + name`, but not `name` alone

### Pagination

db8 returns up to 500 objects per query. For more, use the `page` key returned in results:

```javascript
// First page
{ from: "com.example.myapp.item:1", limit: 100 }
// Subsequent pages — pass the "next" key from the previous result
{ from: "com.example.myapp.item:1", limit: 100, page: e.next }
```

---

## Special Object Properties

| Property | Assigned by | Meaning |
|----------|------------|---------|
| `_id` | db8 | Globally unique object identifier |
| `_rev` | db8 | Revision counter — incremented on every write |
| `_kind` | App (required) | Kind identifier string |

Do not create properties that start with `_` — db8 reserves that namespace.

---

## Change Notifications (Watch)

Subscribe to be notified when a query's result set changes:

```javascript
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "watch",
    parameters: {
        query: { from: "com.example.myapp.item:1",
                 where: [{ prop: "category", op: "=", val: "tools" }] }
    },
    onSuccess: function(e) {
        if (e.fired) {
            // Results changed — re-query to get updated data
            refreshList();
        }
        // Initial response (fired === false) means watch is active
    }
});
```

The watch fires once when the result set changes, then goes inactive. Re-issue the watch after each notification to keep listening.

### Revision Sets

For fine-grained notifications (only when a specific property changes), use revision sets. A revision set creates a synthetic property (e.g., `phoneRev`) that updates only when one of the watched properties changes, enabling efficient `where phoneRev > X` queries:

```javascript
// In putKind:
{
    indexes: [
        { name: "by_phone_rev", props: [{ name: "phoneRev" }] }
    ],
    revSets: [
        { name: "phoneRev", props: [{ name: "phoneNumber" }] }
    ]
}
// Watch: fires only when phoneNumber changes
{ from: "com.example.myapp.item:1", where: [{ prop: "phoneRev", op: ">", val: lastRevSeen }] }
```

---

## Schema Validation

Add a `schema` property to `putKind` to have db8 validate objects on `put`. Invalid objects are rejected with an error:

```javascript
{
    id: "com.example.myapp.item:1",
    owner: "com.example.myapp",
    schema: {
        type: "object",
        properties: {
            _kind:    { type: "string" },
            name:     { type: "string" },
            price:    { type: "number" },
            inStock:  { type: "boolean" }
        }
    },
    indexes: [{ name: "by_name", props: [{ name: "name" }] }]
}
```

---

## Optimistic Concurrency

db8 does not support transactions across multiple calls. For atomic updates, use the `_rev` field:

1. `get` the object, note its `_rev`
2. Modify the object
3. `merge` with a `where` clause that checks `_id` and `_rev`
4. If it fails (another writer changed the object), retry from step 1

---

## Sharing Data with Other Apps

By default only the kind owner can read/write its data. Grant access explicitly:

```javascript
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "putPermissions",
    parameters: {
        permissions: [{
            type: "db.kind",
            object: "com.example.myapp.item:1",
            caller: "com.palm.launcher",   // app to grant access to
            operations: { read: "allow" }
        }]
    }
});
```

This is required if you want Just Type to search your db8 data — see `just-type.md`.

---

## Deleting Objects

```javascript
// Delete by ID
{ method: "del", parameters: { ids: ["++HG_CzxbvBR_CAe", "++HG_Other_Id"] } }

// Delete by query
{ method: "del", parameters: { query: { from: "com.example.myapp.item:1",
                                         where: [{ prop: "archived", op: "=", val: true }] } } }
```

Deleted objects are not fully removed until an administrative purge. Until then they are marked deleted and excluded from queries unless `incDel: true` is set.

---

## See Also

- `webos://knowledge/synergy` — db8 kind extension and permissions for Synergy connectors
- `webos://knowledge/just-type` — Granting Just Type permission to search your db8 data
- `webos://knowledge/activity-manager` — Using db8 watch as an Activity trigger
- `webos://knowledge/ls2-roles` — Why `db: permission denied` happens (caller service-name identity)
- `webos://knowledge/system-internals` — Encrypted `/var/db`, mountcrypt, and the silent-failure mode
