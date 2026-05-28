# Just Type (Universal Search) Integration

Just Type activates when the user starts typing in Card view or the Launcher, without first tapping a text field. Apps can register for three distinct integration points, all configured in `appinfo.json`.

> **User opt-in required:** Even after correct configuration, the user must explicitly enable each app in the Just Type preferences (Settings → Just Type) for each category. This cannot be bypassed programmatically.

---

## The Three Integration Points

| Category | `appinfo.json` key | What it does |
|----------|--------------------|--------------|
| Quick Actions | `action` | App appears in the "Actions" row; launches with a specific task |
| Search Using | `search` | App appears in "Search Using"; launched with the typed text to search externally (web/cloud) |
| Content (Launch) | `dbsearch` | Just Type searches your db8 data and launches the app with the matching record |

---

## `appinfo.json` Configuration

```json
{
    "universalSearch": {
        "action": {
            "displayName": "Add New Item",
            "url": "com.example.myapp",
            "launchParam": "addItem"
        },
        "search": {
            "displayName": "Search My App",
            "url": "com.example.myapp",
            "launchParam": "query"
        },
        "dbsearch": {
            "displayName": "My App",
            "url": "com.example.myapp",
            "launchParam": "itemId",
            "launchParamDbField": "_id",
            "displayFields": ["name", "category"],
            "dbQuery": {
                "from": "com.example.myapp.item:1",
                "where": [{ "prop": "name", "op": "%", "val": "" }],
                "orderBy": "name",
                "limit": 20
            }
        }
    }
}
```

- `launchParam` — the property name passed to your app on launch. For `action` and `search`, it's set to the typed text. For `dbsearch`, it identifies which field (`launchParamDbField`) from the matched record is passed.
- `dbQuery.where[].val` — leave as `""`. Just Type replaces this with the user-entered text at query time.
- The `%` operator (prefix match) works well for name searches. `?` enables full-text search.
- `displayFields` — the db8 fields shown to the user in the Just Type results list.

### Keywords

Add a `keywords` array to `appinfo.json` to make your app appear in Just Type results when those words are typed:

```json
"keywords": ["inventory", "catalog", "items"]
```

---

## Granting db8 Permission for `dbsearch`

If you use `dbsearch`, you must grant `com.palm.launcher` read access to your kind. Do this on app startup (after the kind exists):

```javascript
// Enyo
this.$.putDBPermissions.call({
    permissions: [{
        type: "db.kind",
        object: "com.example.myapp.item:1",
        caller: "com.palm.launcher",
        operations: { read: "allow" }
    }]
});

// Mojo
this.controller.serviceRequest("palm://com.palm.db/", {
    method: "putPermissions",
    parameters: {
        permissions: [{
            type: "db.kind",
            object: "com.example.myapp.item:1",
            caller: "com.palm.launcher",
            operations: { read: "allow" }
        }]
    }
});
```

---

## Handling Launch Parameters

### Enyo

```javascript
// In index.html, after creating the app kind:
if (window.PalmSystem && enyo.windowParams) {
    appInstance.setLaunchParams(enyo.windowParams);
}

// In your main kind:
published: { launchParams: null },

launchParamsChanged: function() {
    if (!this.launchParams) return;

    if (this.launchParams.itemId) {
        // dbsearch: user selected a record — load it
        this.loadItem(this.launchParams.itemId);
    } else if (this.launchParams.addItem) {
        // action: Quick Action — show create form
        this.showNewItemForm();
    } else if (this.launchParams.query) {
        // search: Search Using — run search with the typed text
        this.runSearch(this.launchParams.query);
    }
}
```

### Mojo

Handle in `AppAssistant.prototype.handleLaunch`:

```javascript
AppAssistant.prototype.handleLaunch = function(launchParams) {
    if (launchParams.itemId) {
        // dbsearch launch
    } else if (launchParams.addItem) {
        // Quick Action
    } else if (launchParams.query) {
        // Search Using
    }
};
```

Note: `launchParam` values are HTML-encoded (spaces become `%20`). Use `decodeURIComponent()` before display.

---

## Using `#{searchTerms}` in `search.launchParam`

For `search`, `launchParam` can be an object containing `#{searchTerms}` as a placeholder:

```json
"search": {
    "displayName": "Find in My App",
    "url": "com.example.myapp",
    "launchParam": {
        "scene": "results",
        "q": "#{searchTerms}"
    }
}
```

Just Type replaces `#{searchTerms}` with the typed text. Your app receives the whole object as `launchParams`.

---

## See Also

- `webos://knowledge/db8` — db8 kind setup, querying, and permissions
- `webos://knowledge/app-structure` — `appinfo.json` format and required fields
