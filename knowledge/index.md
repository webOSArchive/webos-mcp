# webOS Knowledge Base Index

This directory contains curated reference files for Palm/HP webOS development (webOS 1.x–3.x on Pre/Pixi/TouchPad). The MCP server exposes each file as a resource at `webos://knowledge/<topic>`. A concatenated version of all files is available at `webos://knowledge/all`.

| File | Description |
|------|-------------|
| [activity-manager.md](activity-manager.md) | Activity Manager — scheduling, triggering, and lifecycle management for background service tasks |
| [alarms.md](alarms.md) | Background timers and alarms using the power management service (`com.palm.power`) |
| [app-structure.md](app-structure.md) | Directory layout and required files for a Mojo app package |
| [application-events.md](application-events.md) | Enyo `ApplicationEvents` component — rotation, activation, relaunch, back gesture, and key events |
| [application-launchers.md](application-launchers.md) | Launching system apps (browser, email, calendar, camera, maps, phone, contacts) via Application Manager |
| [db8.md](db8.md) | db8 JSON database — kinds, indexes, queries, change notifications, schema validation, and permissions |
| [enyo.md](enyo.md) | Enyo 1 — the component-based UI framework shipped on the webOS TouchPad |
| [enyo-ui-guidelines.md](enyo-ui-guidelines.md) | HP's TouchPad Design Guidelines (2011) — the Enyo 1 / tablet UX rulebook: views & panes, sliding panes, the component catalog, notifications vs. alerts, task flows, and navigation patterns |
| [enyo2.md](enyo2.md) | Enyo 2.x — the open-sourced successor used for LuneOS, webOS TV, and cross-platform apps |
| [exhibition.md](exhibition.md) | Exhibition mode: full-screen always-on display when docked on a Touchstone charger |
| [game-controllers.md](game-controllers.md) | Reading USB and Bluetooth game controllers from a PDK game — no joydev (evdev only), the app-jail `/dev/input` fix, the DS4/USB evdev code map, and reference code |
| [gotchas.md](gotchas.md) | Hard-won gotchas — non-obvious issues that bite developers repeatedly |
| [hardware-accessories.md](hardware-accessories.md) | What USB and Bluetooth accessories the TouchPad can drive (host mode, high-power, storage, keyboards, gamepads) and the WOSA Modernize feed utilities that unlock them; the hard limits (no BLE, no joydev) |
| [js-services.md](js-services.md) | Writing Node.js background services that run on-device and register on the Luna bus |
| [just-type.md](just-type.md) | Just Type (Universal Search) integration — Quick Actions, Search Using, and db8 content search |
| [localization.md](localization.md) | Localizing strings, app names, and HTML views; Enyo `g11n` date/number formatting |
| [ls2-roles.md](ls2-roles.md) | LS2 service hub role files — how `Invalid permissions` works, the lunasend impersonation pattern for recovery/migration |
| [mojo.md](mojo.md) | Mojo framework — the scene/assistant UI pattern for webOS 1.x and 2.x phone apps |
| [nizovn-packages.md](nizovn-packages.md) | Community-ported Qt 5 and modern libraries enabling newer C++ software on original hardware |
| [oauth.md](oauth.md) | OAuth on webOS via the shared broker (`oauth.wosa.link`) — sign in to modern services despite ancient TLS and browsers; the show-a-code/poll-for-tokens pattern |
| [overview.md](overview.md) | Platform overview: history, versions, device families, and key architectural concepts |
| [patches.md](patches.md) | webOS patches via AUSMT/Preware — modifying system files on-device |
| [pdk.md](pdk.md) | PDK (Plug-in Development Kit) — native C/C++ apps compiled for ARM Linux |
| [pdk-pre-touchpad-porting.md](pdk-pre-touchpad-porting.md) | Porting Pre PDK apps to TouchPad and improving |
| [postinst-packaging.md](postinst-packaging.md) | Advanced `.ipk` packaging with `postinst`/`prerm` scripts that run as root |
| [pwa-portability.md](pwa-portability.md) | Distributing Enyo 2 apps as PWAs or Cordova packages for non-webOS targets |
| [sdk-tools.md](sdk-tools.md) | Command-line SDK tools for packaging, installing, and communicating with devices |
| [services.md](services.md) | Luna bus services reference — calling built-in system services from Mojo or Enyo apps |
| [synergy.md](synergy.md) | Synergy framework — extending Contacts, Messaging, and Calendar with third-party accounts |
| [system-features.md](system-features.md) | System feature overview: Exhibition mode, URL handlers, and other platform capabilities |
| [system-internals.md](system-internals.md) | Below-the-SDK plumbing — encrypted `/var/db`, mountcrypt/NDUID dependency, boot event graph, jail `/proc`, debug-info-rich binaries, binary patching tricks |
| [tls-and-networking.md](tls-and-networking.md) | TLS and networking: native TLS 1.3 on the TouchPad via the community OpenSSL updates, plus workarounds for the stock 2009-era TLS stack on other devices |
| [touch-and-gestures.md](touch-and-gestures.md) | Touch events, standard gestures, pinch-zoom, and orientation on the TouchPad (Enyo) |
| [touch2share.md](touch2share.md) | Touch2Share — tapping two devices together to share a URL via the Seamless Transitions service |
| [ui-guidelines.md](ui-guidelines.md) | Palm's official webOS UI Design Guidelines — scene anatomy, cards vs. scenes, the full Mojo control catalog, notifications, autoSave, and delivery specs |
| [updater.md](updater.md) | App self-update pattern for apps distributed through the webOS Archive community |
| [url-handlers.md](url-handlers.md) | Registering apps as URL scheme and pattern handlers |
| [web-fetching.md](web-fetching.md) | Fetching data and files from the web: XHR, enyo.WebService, Mojo.Service.Request, and Download Manager — with caveats |
| [windows-wsl-dev.md](windows-wsl-dev.md) | Driving a Windows-attached device from a WSL toolchain — shelling out to the devkit binaries via `powershell.exe`, live log tailing, `palm-install`, and the one-novacom-session-at-a-time constraint |
| [zen-of-palm.md](zen-of-palm.md) | Palm's classic design philosophy (2003) — less-is-more, the sweet spot, the 80/20 rule, pragmatic innovation; the mindset webOS's UI guidelines grew out of |

---

## See Also

- `https://sdk.webosarchive.org` — The partially restored original SDK and PDK documentation for webOS devices from Palm/HP
