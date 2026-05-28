# webOS Knowledge Base Index

This directory contains curated reference files for Palm/HP webOS development (webOS 1.x–3.x on Pre/Pixi/TouchPad). The MCP server exposes each file as a resource at `webos://knowledge/<topic>`. A concatenated version of all files is available at `webos://knowledge/all`.

| File | Description |
|------|-------------|
| [alarms.md](alarms.md) | Background timers and alarms using the power management service (`com.palm.power`) |
| [app-structure.md](app-structure.md) | Directory layout and required files for a Mojo app package |
| [enyo.md](enyo.md) | Enyo 1 — the component-based UI framework shipped on the webOS TouchPad |
| [enyo2.md](enyo2.md) | Enyo 2.x — the open-sourced successor used for LuneOS, webOS TV, and cross-platform apps |
| [exhibition.md](exhibition.md) | Exhibition mode: full-screen always-on display when docked on a Touchstone charger |
| [gotchas.md](gotchas.md) | Hard-won gotchas — non-obvious issues that bite developers repeatedly |
| [js-services.md](js-services.md) | Writing Node.js background services that run on-device and register on the Luna bus |
| [mojo.md](mojo.md) | Mojo framework — the scene/assistant UI pattern for webOS 1.x and 2.x phone apps |
| [nizovn-packages.md](nizovn-packages.md) | Community-ported Qt 5 and modern libraries enabling newer C++ software on original hardware |
| [overview.md](overview.md) | Platform overview: history, versions, device families, and key architectural concepts |
| [patches.md](patches.md) | webOS patches via AUSMT/Preware — modifying system files on-device |
| [pdk.md](pdk.md) | PDK (Plug-in Development Kit) — native C/C++ apps compiled for ARM Linux |
| [postinst-packaging.md](postinst-packaging.md) | Advanced `.ipk` packaging with `postinst`/`prerm` scripts that run as root |
| [pwa-portability.md](pwa-portability.md) | Distributing Enyo 2 apps as PWAs or Cordova packages for non-webOS targets |
| [sdk-tools.md](sdk-tools.md) | Command-line SDK tools for packaging, installing, and communicating with devices |
| [services.md](services.md) | Luna bus services reference — calling built-in system services from Mojo or Enyo apps |
| [synergy.md](synergy.md) | Synergy framework — extending Contacts, Messaging, and Calendar with third-party accounts |
| [system-features.md](system-features.md) | System feature overview: Exhibition mode, URL handlers, and other platform capabilities |
| [tls-and-networking.md](tls-and-networking.md) | TLS and networking workarounds for the 2009-era TLS stack's incompatibility with the modern web |
| [touch2share.md](touch2share.md) | Touch2Share — tapping two devices together to share a URL via the Seamless Transitions service |
| [updater.md](updater.md) | App self-update pattern for apps distributed through the webOS Archive community |
| [url-handlers.md](url-handlers.md) | Registering apps as URL scheme and pattern handlers |
| [web-fetching.md](web-fetching.md) | Fetching data and files from the web: XHR, enyo.WebService, Mojo.Service.Request, and Download Manager — with caveats |

---

## See Also

- `https://sdk.webosarchive.org` — The partially restored original SDK and PDK documentation for webOS devices from Palm/HP