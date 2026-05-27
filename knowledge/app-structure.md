# webOS App Structure

## Directory Layout

A typical Mojo app:

```
com.example.myapp/
├── appinfo.json          ← required: app metadata
├── index.html            ← entry point (usually minimal boilerplate)
├── app/
│   ├── assistants/       ← scene assistants (one per scene)
│   │   └── stage-assistant.js
│   ├── views/            ← HTML templates (one per scene)
│   │   └── stage/
│   │       └── stage-scene.html
│   └── models/           ← optional: data/business logic
├── images/               ← app images
├── stylesheets/
│   └── myapp.css
└── sources.json          ← declares JS files to load
```

A typical Enyo app (TouchPad):

```
com.example.myapp/
├── appinfo.json
├── index.html
├── app.js                ← root Enyo kind, app entry point
├── source/               ← component kinds
│   └── MyView.js
├── images/
└── stylesheets/
```

## appinfo.json

Every webOS app requires this file. It is the app manifest.

```json
{
  "id": "com.example.myapp",
  "version": "1.0.0",
  "vendor": "My Company",
  "type": "web",
  "main": "index.html",
  "title": "My App",
  "icon": "images/icon.png",
  "miniicon": "images/miniicon.png"
}
```

Key fields:
- `id` — reverse-domain app ID, must be unique on the device. This is the primary identifier used by all SDK tools.
- `version` — semver string
- `type` — almost always `"web"` for JS apps; `"pdk"` for native
- `vendor` — display name for the vendor/developer
- `main` — entry point HTML file
- `icon` — 64×64 PNG shown in the launcher
- `miniicon` — 48×48 PNG used in notifications and cards

Optional fields:
```json
{
  "noWindow": true,          // headless app (service launcher)
  "universalSearch": [...],  // adds app to universal search
  "urlPatterns": [...]       // URL scheme handlers
}
```

## sources.json (Mojo)

Declares all JavaScript files that should be loaded for the app. Order matters — dependencies first.

```json
[
  {
    "source": "app/assistants/stage-assistant.js"
  },
  {
    "source": "app/assistants/main-assistant.js"
  },
  {
    "source": "app/models/my-model.js"
  }
]
```

> All JS files must be listed here or they won't be loaded. This is a common gotcha — adding a new file and forgetting to add it to sources.json causes silent failures.

## index.html (Mojo)

Typically minimal boilerplate — Mojo injects the framework:

```html
<html>
  <head>
    <title>My App</title>
  </head>
  <body>
    <!-- Mojo framework loads scenes into here -->
  </body>
</html>
```

## index.html (Enyo)

```html
<html>
<head>
  <title>My App</title>
  <script src="/usr/palm/frameworks/enyo/0.10/framework/enyo.js" type="text/javascript"></script>
  <script src="app.js" type="text/javascript"></script>
</head>
<body>
  <script type="text/javascript">
    new MyApp().renderInto(document.body);
  </script>
</body>
</html>
```

## IPK Packaging

Apps are distributed as `.ipk` files (Debian package format). The SDK's `palm-package` tool creates them from an app directory.

```bash
palm-package com.example.myapp/
# produces: com.example.myapp_1.0.0_all.ipk
```

The `.ipk` is a renamed `.ar` archive containing:
- `control.tar.gz` — package metadata
- `data.tar.gz` — the actual app files, installed to `/media/cryptofs/apps/usr/palm/applications/<app-id>/`

---

## See Also

- `webos://knowledge/postinst-packaging` — advanced install scripts (postinst/prerm) for apps that need root setup at install time
- `webos://knowledge/patches` — Preware/AUSMT patches to system files, distributed as `.ipk`
- `webos://knowledge/updater` — community self-update pattern via App Museum II
- `webos://knowledge/services` — calling built-in Luna services from your app
