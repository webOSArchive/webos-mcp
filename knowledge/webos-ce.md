# webOS CE 3.1.0 (Community Edition)

webOS CE 3.1.0 is a community release for the **HP TouchPad** only (Wi-Fi `topaz` and 4G/AT&T `topaz4g`), released 2026-09-03. It is not a rebuilt OS. It repacks HP's webOS 3.0.5 Doctor, with community fixes baked straight into the root filesystem. Flashing it wipes the device, exactly like the HP Doctor.

Most of this knowledge base describes **stock HP webOS 3.0.5**, and nearly all of it still holds on CE. Where CE changes the answer, the page carries a short **On webOS CE 3.1.0:** callout next to the stock text. This page lists every change in one place. Nothing here affects Pre/Pixi/Veer phones or LuneOS.

**Source:** https://github.com/webOSArchive/webOS-Community-Edition (release notes, known issues, build scripts). Everything below was checked against the `3.1.0-CE-Release` tag.

---

## Detecting CE

| What you read | Stock 3.0.5 | CE 3.1.0 |
|---|---|---|
| `platformVersion` (`PalmSystem.deviceInfo`, `Mojo.Environment.DeviceInfo`, `enyo.fetchDeviceInfo`) | `3.0.5` | `3.1.0` (Major 3, Minor 1, Dot 0) |
| `/etc/palm-build-info` `PRODUCT_VERSION_STRING`, `com.palm.properties.version` | `HP webOS 3.0.5` | `webOS CE 3.1.0` |
| `com.palm.properties.buildMark` / `buildDate` | absent | e.g. `600070` / `2026-08-30` |
| Browser and media user agents | carry `3.0.5` | carry `3.1.0` |

Detect the TouchPad generation with `platformVersionMajor === 3`. Don't match the exact string `3.0.5`, and don't parse an `HP webOS ` prefix yourself. Preware feeds that cap a package at `MaxWebOSVersion` 3.0.x hide it on CE (`webos://knowledge/preware-feeds`).

---

## What CE Bakes In

These are part of the image, so a CE user never installs them. Instructions that say "install X first" are already done.

| Area | What CE ships | Notes |
|---|---|---|
| **TLS** | OpenSSL 1.1.1w for the browser, app WebKit (XHR/Ajax from Mojo and Enyo apps), the download manager and email; `/usr/bin/curl` = curl 7.88.1 / OpenSSL 1.1.1w; 190 current Mozilla roots in `/etc/ssl/certs/ca-certificates.crt`; ntpdate-sync | The webOS-internals "TLS 1.3 Updates" set, baked in. **Node.js is not upgraded** (0.4.12 / OpenSSL 0.9.8k), so JS services still shell out to `/usr/bin/curl` for modern HTTPS. The `openssl` CLI is the stock 0.9.8 tool. See `webos://knowledge/tls-and-networking` |
| **Preware** | Preware 1.9.19 with feeds preconfigured; registered as the handler for `.ipk` links in the browser | Its `org.webosinternals.ipkgservice` backend runs from first boot |
| **Utilities** | Govnah 1.3.9, App Catalog 6.1.2923, Maps 4.0.1, USB Settings, Bluetooth gamepad support, UberKernel 3.0.5-93 | USB Settings mounts drives at `/media/usb`. The PDK jail already mounts `/dev/input`. See `hardware-accessories`, `game-controllers` |
| **Power menu** | Luna Restart and Reboot (the "Advanced reset options" patch, applied at build time) | |
| **Developer mode** | On out of the box and turned back on at every boot | Turning it off lasts until the next reboot |
| **Backup** | `com.palm.app.backup` is the working community woce-backup 3.1.1 | HP's backup service is dead |
| **Launcher** | LunaCE replaces LunaSysMgr | Its extra gestures and launcher features are **off by default** (enabled only through Tweaks, which isn't installed). Apps with the keyword `wosa-settings` are placed on the Settings tab |
| **Keyboard** | Defaults to Small | Users can still change it |
| **Search** | DuckDuckGo Lite is the default engine | `universalSearch` app integration is unchanged |
| **Connectivity check** | Probe URLs repointed from dead HP hosts | Stock asks for a hotspot login on ordinary Wi-Fi |
| **Exhibition** | A simple clock is added as the first Time face | The three stock faces are still there, behind it |
| **Synergy** | The Synergy Revival shared runtime (`com.palm.synergy.generic` 0.9.3.1): the libpurple 2.14 IM transport, `_cloudcore`, the cloud sign-in app, and the QuickOffice/Photos integration patches | **No connectors.** Users add those from Preware. See `synergy-architecture` |
| **Accounts** | The community accounts service 1.1.0.1 (Open webOS/LuneOS lineage) and Accounts app 3.1.1 | Adds `keepData` on delete, `createLocalAccount`, and `com.palm.account:1` read access for `com.webos.*` and `org.webosports.*` callers; Accounts has a "Delete Account Data" page. See `synergy-internals` |
| **Core apps** | Community Contacts, Messaging, Phone, chatthreader, contacts linker, luna-systemui, messaging.library, enyo-accounts, enyo-contactsui | Messaging renders reactions, replies, receipts and attachments from IM connectors |

## What CE Removes

| Removed | Consequence |
|---|---|
| Kindle, Facebook and YouTube preloads | Apps that launch these find nothing |
| Skype (skypekit, the template, app hooks) | No Skype account or calling |
| Yahoo IM, contacts and calendar | No Yahoo account type |
| AOL/AIM (`com.palm.aol`, `imaccountvalidator`) | No AIM account type |
| Legacy Google (`com.palm.google` template, Google calendar/contacts services, jabber/xmpp prpls) | No stock Google account; read these services from a stock image if you need them as reference code |

## What CE Does Not Include

- **Atlas.** OAuth sign-in for the Synergy connectors, and modern web rendering in general, still need Atlas installed from Preware or App Catalog. CE fixes TLS, not the 2011 WebKit rendering engine.
- **Synergy connectors** (IM networks, cloud storage, music).
- **An OS update client.** The image carries a signing key (`/usr/share/ce-ota/keys/ce-ota-signing.pub`) and a verifier (`/usr/bin/ce-ota-verify`), but nothing uses them yet.

---

## What Stays Stock

Unchanged, so the rest of this knowledge base applies as written:
- Mojo and Enyo 1 core;
- the PDK runtime (SDL 1.2, PDL, GLES);
- node.js and the mojoservice frameworks;
- db8;
- ActivityManager;
- the LS2 hub and role rules;
- the partition layout;
- the kernel generation (UberKernel 3.0.5-93 is still 2.6.35, with the same limits).

Only CE's own replaced files differ. Patches diffed against stock 3.0.5 for any of the files CE replaces will not apply (`webos://knowledge/patches`).

## Device Behaviour Worth Knowing

- **First use** is the webOS Archive account flow and can be skipped. It ends **without a reboot**: LunaSysMgr respawns into the normal UI. A job that must run after setup can't count on a second boot (`webos://knowledge/system-internals`).
- **Fresh-flash window.** For about 90 seconds after first use, CE seeds the cryptofs pieces of the image. Preware shows no packages until that finishes.
- **What survives a flash.** `/media/internal` survives. The Doctor normally wipes the encrypted app store.
- **Known issues** are tracked in the CE repo's `KNOWN-ISSUES.md`.

## See Also

- `webos://knowledge/overview`: the platform and its versions
- `webos://knowledge/tls-and-networking`: what CE's TLS stack covers and what it doesn't
- `webos://knowledge/preware-feeds`: targeting CE devices from a feed
- `webos://knowledge/synergy-architecture`: Synergy on stock and CE
