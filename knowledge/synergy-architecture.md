# webOS Synergy Architecture Overview

Start here. Synergy is the account framework that lets one device account feed the stock apps: a Google account fills Contacts, Calendar and Email, and an IM account shows up in Messaging. The apps never talk to a remote service themselves. They read a shared local database, and per-account **transports** keep that database in step with the network. This page draws the whole system on one sheet, shows where each of our connector families (messaging/IM, cloud, music) plugs into it, and points at the detailed pages.

| Page | Read it for |
|---|---|
| `webos://knowledge/synergy-architecture` | this overview |
| `webos://knowledge/synergy-internals` | the framework in depth: accounts service API, every template field, lifecycle callbacks, mojoservice, Sync library |
| `webos://knowledge/synergy` | writing a classic JS Synergy service (template skeleton, keymanager, Futures, debugging) |
| `webos://knowledge/synergy-messaging-connectors` | IM connectors: libpurple + `imlibpurpleservice` |
| `webos://knowledge/synergy-cloud-connectors` | cloud/file connectors: DOCUMENTS + PHOTO.UPLOAD, `_cloudcore` |
| `webos://knowledge/synergy-music-connectors` | streaming music providers as "Music" account types |

---

## The Big Picture

```
 ┌──────────────────────────────── STOCK APPS (UI) ─────────────────────────────────┐
 │ Contacts   Calendar   Email   Messaging   Phone   Photos   QuickOffice   Music+  │
 └────┬──────────┬────────┬────────┬───────────┬───────┬──────────┬───────────┬─────┘
      │ query PARENT kinds         │ write      │ Call- │ call service methods │ HTTP
      │ (see every account at once)│ outbox /   │ Syner-│ directly (no db8     │ :8730
      ▼                            │ imcommand  │ gizer │ content)             │
 ┌──────────────────────── db8 (MojoDB) ──────────────┐ │       │          │           │
 │ com.palm.contact:1   com.palm.calendarevent:1      │ │       │          │           │
 │ com.palm.email:1     com.palm.immessage:1  ◄───────┘ │       │          │           │
 │ com.palm.chatthread:1  imloginstate  imcommand       │       │          │           │
 │ tempdb: com.palm.imbuddystatus:1                     │       │          │           │
 │   ▲ each transport writes its own SUB-KIND,          │       │          │           │
 │   │ "extends" the parent, so the app sees it         │       │          │           │
 └───┼──────────────────────▲───────────────────────────┘       │          │           │
     │ put/merge/del         │ db watch triggers                 │          │           │
 ┌───┴───────────────────────┴──┐                                 ▼          ▼           ▼
 │ TRANSPORTS (one per acct type)│◄── ActivityManager ──┐  ┌─────────────────────┐ ┌───────────┐
 │  JS mojoservice + Sync lib    │   periodic sync,     │  │ cloud connectors     │ │ Go daemon │
 │  C++: com.palm.imap,          │   db-watch triggers, │  │ com.palm.service.<x> │ │ (not on   │
 │       com.palm.imlibpurple    │   keep-alive         │  │ listFolder, upload…  │ │  the bus) │
 └───▲───────────────────────────┘                      │  └──────────▲───────────┘ └─────▲─────┘
     │ onCreate / onEnabled / onDelete / sync …          │             │                   │
 ┌───┴────────────────────────────────────────────────────┴────────────┴───────────────────┘
 │ com.palm.service.accounts      ── templates (/usr/palm/public/accounts, installed apps)
 │   com.palm.account:1 records   ── credentials ─► com.palm.keymanager (one key per account)
 └───▲────────────────────────────
     │ createAccount / modifyAccount / deleteAccount
 ┌───┴──────────────────────────────────────────────┐
 │ Settings → Accounts  (validator / customUI app)   │
 └──────────────────────────────────────────────────┘
```

Three things to notice:

1. **The accounts service is a registry and a dispatcher, not a sync engine.** It stores account records and credentials and calls the transport's callbacks at the right moments. It never moves content (`synergy-internals`, "Components and Ownership").
2. **db8 is the meeting point for content.** A stock app queries the **parent** kind. Each transport writes into its own **sub-kind** with `"extends"`, and db8 updates the parent's indexes too (`db8/src/db/MojDbKind.cpp`), so the app sees every account without knowing any of them.
3. **Not every capability goes through db8.** Messaging does, fully. DOCUMENTS and PHOTO.UPLOAD are **method calls**: QuickOffice and the Photos aggregator call the connector's service directly. Music goes over **localhost HTTP** to a daemon that is not on the bus at all.

---

## The Three Contracts a Connector Signs

Every connector, of any family, plugs into some subset of these.

### 1. The account template (identity + callbacks)

A JSON file in `/usr/palm/public/accounts/<dir>/` (or an installed app's `accounts/` folder) that the accounts service scans at start and on `appsChanged`. It declares:

| Part | What it does |
|---|---|
| `templateId`, `loc_name`, icons | the entry in Add Account |
| `validator` (an address, or `customUI: {appId, name}`) | checks the credentials. Returns `{credentials, config, username, …}` |
| `capabilityProviders[]` | one per capability (`MESSAGING`, `CONTACTS`, `DOCUMENTS`, …). Each can carry `implementation`, `onEnabled`, `sync`, `dbkinds`, and capability-specific fields |
| top-level `onCreate` / `onDelete` / `onCapabilitiesChanged` / `onCredentialsChanged` | lifecycle callbacks (`onCapabilitiesChanged` is **only** read at the top level) |
| `readPermissions` / `writePermissions` | which app/service ids may read or change the account. Globs allowed. On LuneOS the `org.webosports.*` app ids must be listed too |

### 2. The data contract (db8 sub-kinds)

The template's `dbkinds` tells the **app** where to write (for example, where to put a pending outgoing message). The transport owns the sub-kinds and their indexes. The parent kinds are owned by the stock apps or system services (table in `synergy-internals`, "How Data Reaches the Stock Apps"). The chat threader and the contacts linker are watchers that post-process those records into `com.palm.chatthread:1` and `com.palm.person:1`.

### 3. The trigger contract (ActivityManager)

Transports are not daemons in the stock design. They are started on demand by:
- a **periodic** activity (`Periodic Sync:<svc>:<acct>`, completed with `restart:true` each run),
- a **db watch** activity: a change in db8 fires a callback. This is how outgoing IM messages, IM commands and login-state changes reach the transport, and how the chat threader runs,
- a direct **lifecycle call** from the accounts service.

A mojoservice process exits `activityTimeout` seconds after its last activity completes. The default in code is **5 s**, not the 60 s the bundled docs claim (`synergy-internals`, "The mojoservice Runtime").

---

## Lifecycle in One Picture

```
 user ─ Add Account ─► validator / customUI ─► {credentials, config, username?, alias?}
                                                   │
                           accounts.createAccount ◄┘
                             ├─ db8: put com.palm.account:1
                             ├─ keymanager: store credentials (key = accountId)
                             ├─ reply to the UI  (transports not told yet)
                             └─ async notifyAccountCreated:
                                   onCreate {accountId, config}      → each enabled provider
                                   onEnabled {…, enabled:true}       → each enabled provider
                                   template.onCapabilitiesChanged    → full provider list
                                        └─ transport sets up activities, logs in / first sync

 toggle a capability ─► modifyAccount ─► onCapabilitiesChanged + onEnabled(true|false)
                                         (a failed onEnabled flips that provider back:
                                          TRANSPORT_FAILURE)
 change password     ─► modifyAccount {credentials} → onCredentialsChanged (awaited)
                        writeCredentials            → onCredentialsChanged (not awaited)
 remove account      ─► deleteAccount ─► beingDeleted:true (hidden at once)
                                         → onEnabled(false) per enabled provider
                                         → onDelete per provider → keymanager key removed
                                         → account record deleted   (LuneOS: + keepData flag)
```

Two behaviours that surprise people:
- **Create-time callbacks cannot fail the sign-in.** `createAccount` has already replied. If an `onCreate` fails, the notify step just stops: no `onEnabled` is sent and the command waits out its 3600 s timeout.
- **The accounts service never deletes content.** Transports do. In the Sync library that happens on **disable** (`onEnabled(false)` soft-deletes every `syncOrder` kind); `onDelete` only removes the transport record.

The full sequence diagram, the exact payloads and the delete retry rules are in `synergy-internals`, "Account Lifecycle".

---

## Three Shapes of Transport

| Shape | Examples | How it runs | Writes content to |
|---|---|---|---|
| **JS mojoservice + Sync library** | stock Google calendar/contacts, CardDAV/CalDAV, the classic third-party services in `webos://knowledge/synergy` | `run-js-service` launches node with the Foundations + `mojoservice.transport.sync` frameworks. `SyncCommand` walks `getSyncOrder()`: down-sync with `getRemoteChanges` → `remote2local` transform → db8 put; up-sync with local `_rev > modnum` → `local2remote` transform → `putRemoteObjects` | its db8 sub-kinds |
| **Native C++ bus service** | `com.palm.imap`/`pop`/`smtp` (mojomail), `com.palm.imlibpurple` | a normal LS2 service whose method names appear in the template (`onCreate → palm://com.palm.imap/accountCreated`). Same payloads, same `readCredentials {name:"common"}` | its db8 sub-kinds |
| **Method provider / external daemon** | revival cloud connectors; music daemon | cloud: a mojoservice exposing `listFolder`/`downloadFile`/`uploadFile`/`listAlbums`/…, called on demand by the consuming app. Music: a Go HTTP server; the template has **no** callbacks | nothing (cloud: files to local paths; Photos caches downloads itself) / nothing |

---

## Where Our Connector Families Plug In

```
                  MESSAGING / IM               CLOUD / FILES                 MUSIC
                  ──────────────               ─────────────                 ─────
 template cap.    MESSAGING (+ PHONE for       DOCUMENTS, PHOTO.UPLOAD       "Music" / STREAMING
                  calls, CONTACTS read-only)                                 (custom, no callbacks)
 sign-in UI       customUI setup app per       com.palm.app.cloud-auth       org.webosports.app.musicauth
                  network (QR / auth chat /    (OAuth in Atlas) or own       (OAuth in Atlas, forms)
                  credentials)                 form app (kDrive/MEGA/S3)
 runtime          ONE resident C++ process:    one mojoservice per provider  ONE Go daemon,
                  imlibpurpletransport +       on the shared _cloudcore      spotify-webos-service,
                  libpurple + one prpl/network runtime (config.js+adapter.js) 127.0.0.1:8730, upstart
 bus name         com.palm.imlibpurple         com.palm.service.<x>          none (claims an id via
                  (+ com.palm.<net>.call)                                    luna-send -a)
 data path        db8 .libpurple sub-kinds →   method calls from             HTTP from the app;
                  Messaging app, chatthreader  QuickOffice / Photos          audio via gst → PulseAudio
 triggers         3 db-watch activities:       none: called on demand        none
                  loginstate, outbox, imcommand
 modern TLS in    the prpls (own stack or      /usr/bin/curl (OpenSSL        the Go daemon / curl
                  ssl-openssl.so)              1.1.1w), shelled out from JS
 credentials      accounts store (non-empty    accounts store, name          Spotify: accounts store;
                  sentinel when the network    "common"                      others: files under
                  has no password)                                           /media/cryptofs/spotify-webos/
```

### Messaging / IM

The revival reuses Palm's own **C++ IM transport**, `imlibpurpleservice`, instead of writing a JS service per network. One process hosts libpurple 2.14 and loads one protocol plugin per network (Teams, Telegram, Signal, Discord, WhatsApp, Facebook E2EE, Google Chat). Every network shares the same `.libpurple` db8 sub-kinds, and an account is told apart only by its `serviceName` (`type_telegram`, …). The transport is kept **resident** (upstart + `IM_RESIDENT=1`) instead of being hub-launched, because its own idle shutdown fought the respawn.

```
 network ⇄ prpl ⇄ libpurple ⇄ LibpurpleAdapter ⇄ db8 immessage.libpurple ⇄ Messaging app
                                   ▲                    │ outbox row, status "pending"
                                   └── /sendIM ◄── db watch activity
```

Features the stock design never had (replies, reactions, receipts, voice notes, video, documents) travel as libpurple **signals** and conversation data keys named `webos-*`. The transport maps them onto extra `immessage` fields that the patched Messaging app renders. Calls register a second bus name per network, `com.palm.<net>.call`, from **inside** the transport process, and speak the stock Phone app's CallSynergizer contract. Details: `webos://knowledge/synergy-messaging-connectors`.

### Cloud / files

The stock DOCUMENTS connectors only *validated* credentials. QuickOffice did the file I/O through a vendor proxy that no longer exists. The revival moves the I/O into the connector service and patches the consumers to call it:

```
 QuickOffice ── listFolder / downloadFile / uploadFile ──► com.palm.service.<x>
 Photos svc  ── listAlbums / listPhotos / upload / deletePhoto ──►   │ _cloudcore
                                                                     ▼
                                                     execFile /usr/bin/curl ─► provider API
```

Discovery is **account-derived**, so a new connector needs no consumer edits. QuickOffice picks any DOCUMENTS account whose `implementation` starts with `palm://com.palm.service.`. Photos maps `templateId com.palm.<x>` → service `com.palm.service.<x>`, which is why the naming rule is strict. A connector on `_cloudcore` is just `config.js` + `adapter.js`. Details: `webos://knowledge/synergy-cloud-connectors`.

### Music

Music providers use only the **front half** of Synergy: a template, the Add Account entry, a customUI validator and the account record. There is no `implementation`, no callbacks and no `dbkinds`. The Music app lists accounts with `{capability:"Music"}`, and an audio router sends each track by path prefix to HTML5 audio (local files), to librespot (`spotify:`) or to a stream player (other providers). Both remote engines play through the daemon's own gst-0.10 pipeline into PulseAudio with `media.role=music`. Because there is no `onDelete`, removing the account does not remove the daemon's credential files. Details: `webos://knowledge/synergy-music-connectors`.

---

## The Cross-Cutting Problem: Modern TLS

Everything above was designed for 2011 endpoints. On the TouchPad, node 0.4.12 links OpenSSL 0.9.8k and the stock WebKit is ~2009, so **neither the JS layer nor the stock webview can complete a TLS 1.2/1.3 handshake**. Each family moves TLS somewhere else:

| Layer | Who does TLS |
|---|---|
| Sign-in pages (all families) | **Atlas** (WPE browser): inline in the customUI on legacy webOS, a `window.open()` WAM window on LuneOS |
| Cloud API and file calls | system **`/usr/bin/curl`** 7.88.1 / OpenSSL 1.1.1w, from the companion OpenSSL-11 update, plus a current CA bundle |
| IM | the **prpls** themselves, with libpurple's `ssl-openssl.so` and a self-provisioned newer libssl/libcrypto |
| Music | the **Go daemon** (and curl for stream URLs) |

The alternative, used outside these projects, is a hosted broker (`webos://knowledge/oauth`). The revival connectors instead require the OpenSSL-11 update and Atlas on the device. See `webos://knowledge/tls-and-networking`.

---

## Platforms

| | HP TouchPad, webOS 3.0.5 | LuneOS |
|---|---|---|
| Status of our connectors | the verified target for messaging, cloud and music | secondary target: code compiles and checks against LuneOS headers/ABI, ACL ids and `requiredPermissions` are declared, OAuth uses a WAM window; no documented end-to-end device run |
| Bus security | `palm_bus_config.json` + `/usr/share/ls2` roles | LS2 ACG files per service (`role`, `api`, `perm`, `groups`). **The accounts service's `perm.json` must list a new transport's callback group**, or its callbacks are refused |
| JS jail | third-party services jailed | `jail=off` |
| App ids | `com.palm.app.*` | `org.webosports.app.*` (must be in template permissions) |
| Accounts extras | — | `keepData` on delete, `createLocalAccount`, `prpl` field in IM templates |

Full table: `synergy-internals`, "LuneOS Differences".

---

## Reading Order

1. **Writing a new Synergy service from scratch?** → `synergy` (how-to), then `synergy-internals` (lifecycle and Sync library) when something behaves unexpectedly.
2. **Adding a chat network?** → `synergy-messaging-connectors` §14 checklist.
3. **Adding a cloud provider?** → `synergy-cloud-connectors` §8 checklist (on `_cloudcore`, two files).
4. **Adding a music provider?** → `synergy-music-connectors`, "Adding a Provider: Checklist".
5. **Debugging data that doesn't show up in an app?** → check that the record's kind extends the parent the app queries, the index prefix order (`webos://knowledge/db8`), and the db-watch activity (`webos://knowledge/activity-manager`).

## See Also

- `webos://knowledge/synergy-internals`: the framework in depth
- `webos://knowledge/synergy`: writing a classic JS Synergy service
- `webos://knowledge/synergy-messaging-connectors`, `synergy-cloud-connectors`, `synergy-music-connectors`: the connector families
- `webos://knowledge/db8`, `activity-manager`, `js-services`, `ls2-roles`, `tls-and-networking`, `oauth`
