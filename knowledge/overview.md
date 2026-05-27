# webOS Platform Overview

## What is webOS

Palm/HP webOS is a Linux-based mobile operating system originally released by Palm in 2009 (as "webOS 1.0" on the Palm Pre) and continued by HP through version 3.0.5 on the TouchPad (2011). It is distinct from LG's later "webOS" TV platform — when working in this codebase, "webOS" always means the original Palm/HP platform.

The platform is now maintained and archived by the webOS Archive project at https://www.webosarchive.org, which preserves the SDK, documentation, and app ecosystem.

## Key Characteristics

- Apps are written in **JavaScript + HTML + CSS** — no native code required for most apps
- The OS is **Linux-based**; the underlying system is accessible and hackable
- Inter-process communication uses the **Luna service bus** (also called "LS2")
- Backend logic runs as **Node.js services** directly on the device
- The UI layer runs in a **WebKit browser engine** embedded in the OS

## webOS Versions

| Version | Device(s) | Framework | Notes |
|---------|-----------|-----------|-------|
| 1.0–1.4.5 | Pre, Pixi, Pre Plus, Pixi Plus | **Mojo** | Most common legacy target |
| 2.0–2.2.4 | Pre 2, Pre 3, Veer | Mojo + early Enyo | Transitional |
| 3.0–3.0.5 | TouchPad | **Enyo 1** | Tablet form factor |

> Note: Enyo 2 was open-sourced by HP after webOS was discontinued and runs on modern browsers, but was not shipped on original webOS hardware. Most original webOS app development targets Mojo (phones) or Enyo 1 (TouchPad).

## Application Types

1. **Packaged apps** — JavaScript apps installed as `.ipk` packages, the primary app format
2. **PDK apps** — Native (C/C++) apps using the Plug-in Development Kit; rare, mostly games
3. **Services** — Node.js processes that run in the background and expose Luna service APIs

## The Luna Service Bus

The Luna bus is the IPC backbone of webOS. Everything communicates through it:
- Apps call system services (GPS, camera, contacts, etc.) via Luna
- Apps can expose their own services via Luna
- Node.js backend services register on the bus and respond to requests

Luna calls follow this pattern:
```javascript
this.controller.serviceRequest('palm://com.palm.service.name/', {
  method: 'methodName',
  parameters: { key: 'value' },
  onSuccess: function(response) { ... },
  onFailure: function(error) { ... }
});
```

## Development Environment

The SDK is available (updated for modern machines) from the webOS Archive:
https://www.webosarchive.org

Key SDK components:
- `palm-package` — packages an app directory into an `.ipk`
- `palm-install` — installs an `.ipk` to a connected device or emulator
- `palm-launch` — launches an installed app
- `palm-emulator` — launches the device emulator
- `novacom` — general-purpose device communication tool (see sdk-tools.md)

## File Resources

- SDK documentation: https://sdk.webosarchive.org
- App archive: https://www.webosarchive.org
- GitHub organization: https://github.com/webosarchive

---

## Knowledge Topic Index

| Topic | Resource |
|-------|----------|
| App structure, appinfo.json, packaging | `webos://knowledge/app-structure` |
| Mojo framework (phones) | `webos://knowledge/mojo` |
| Enyo 1 framework (TouchPad) | `webos://knowledge/enyo` |
| Enyo 2 / cross-platform / LuneOS | `webos://knowledge/enyo2` |
| Native C/C++ PDK apps | `webos://knowledge/pdk` |
| SDK tools (palm-package, novacom…) | `webos://knowledge/sdk-tools` |
| Calling Luna services from apps | `webos://knowledge/services` |
| Writing Node.js Luna services | `webos://knowledge/js-services` |
| Synergy account/sync integration | `webos://knowledge/synergy` |
| Just Type, noWindow, sounds, keys | `webos://knowledge/system-features` |
| Touchstone dock / Exhibition mode | `webos://knowledge/exhibition` |
| Background alarms and timers | `webos://knowledge/alarms` |
| Touch2Share (tap-to-share) | `webos://knowledge/touch2share` |
| URL redirect handlers | `webos://knowledge/url-handlers` |
| postinst/prerm install scripts | `webos://knowledge/postinst-packaging` |
| Preware/AUSMT system patches | `webos://knowledge/patches` |
| App self-update (App Museum II) | `webos://knowledge/updater` |
| Qt 5 / modern glibc PDK runtime | `webos://knowledge/nizovn-packages` |
| TLS limitations and proxy workarounds | `webos://knowledge/tls-and-networking` |
| Multi-platform PWA/Cordova builds | `webos://knowledge/pwa-portability` |
| Common gotchas | `webos://knowledge/gotchas` |
