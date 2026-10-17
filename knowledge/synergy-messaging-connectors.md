# Messaging / IM Synergy Connectors (libpurple + imlibpurpleservice)

How the *webos-synergy-revival* project brings modern chat networks (Teams, Telegram, Signal,
Discord, WhatsApp, Facebook Messenger with E2EE, Google Chat) back into the **stock webOS
Messaging app** (and, for calls, the **stock Phone app**) on the HP TouchPad. The connectors
don't use the JavaScript Synergy service pattern described in `webos://knowledge/synergy`
(`sendIM` assistant, a node service per account type). They reuse Palm's own **native C++ IM
transport**, `imlibpurpleservice`, which hosts **libpurple** (the Pidgin engine) and loads one
**protocol plugin (prpl)** per network. Every network shares one bridge process, one set of
db8 kinds and one Luna service name, `com.palm.imlibpurple`.

Read `webos://knowledge/synergy` first for the generic account-template, `immessage`/`chatthread`
and `onEnabled`/`onDelete` concepts. This page covers what differs for the libpurple route and
the webOS-specific extensions the project adds on top.

**Sources** (paths in this page are repo-relative):
- `webos-synergy-revival` holds the per-connector account templates, setup apps, vendored prpl
  sources, calling code, packaging, device fixes and tests (`messaging/`, `packaging/`,
  `device-setup/`, `tests/`).
- `imlibpurpleservice`, branch `herrie/synergy-revival` (upstream `webOS-ports/imlibpurpleservice`
  plus the revival commits), holds the transport source: `src/`, `inc/`, `files/`. The monorepo's
  `messaging/imlibpurpleservice/` has only the build scripts (its `README.md` says so).
- Messaging app changes live in the separate **core-apps** repo, not here (`README.md`, "License /
  attribution"). The field usage quoted below comes from its `herrie/milestone2-servers-tab` branch
  (`com.palm.app.messaging/app/conversations/ConversationList.js`, `ConversationItem.js`).
  Threading lives in `com.palm.messaging.chatthreader`.

**Platform.** The verified target is the **HP TouchPad, webOS 3.0.5** (`nova-cust-image-topaz`,
ARMv7, 1 GB RAM). LuneOS is a secondary target that is still in progress:
- `messaging/check-plugins-dual-target.sh`, `check-plugins-luneos-abi.sh` and
  `imlibpurpleservice/check-dual-target.sh` check that the code compiles against LuneOS headers
  and that plugin symbols resolve against LuneOS libraries.
- `messaging/common/webos-ls2-compat.h` maps the legacy split-bus `LSPalmService` API onto
  luna-service2 3.x.
- The templates and ACLs also grant `org.webosports.app.messaging`.
- The LuneOS Enyo2 Messaging app (`org.webosports.messaging`, branch `herrie/rewrite`) reads the
  same `deliveryStatus`/`reactions`/`quotedMessageId`/`filePath` fields.

No end-to-end LuneOS device run of the connectors is documented in the repo.

---

## 1. Architecture at a glance

```
Settings > Accounts > Add <Network>
   └─ customUI setup app  com.palm.app.<svc>  (Enyo 0.10 iframe, validator.html)
        └─ CrossAppResult.sendResult({username, credentials, config, templateId})
             └─ com.palm.service.accounts/createAccount
                  └─ MESSAGING capability onEnabled ─▶ palm://com.palm.imlibpurple/onEnabled
                       └─ OnEnabledHandler: put com.palm.imloginstate.libpurple:1 {state:"offline", availability:ONLINE}
                            └─ activity "Libpurple loginstate" (db watch) ─▶ /loginStateChanged
                                 └─ IMLoginState ─▶ readCredentials ─▶ LibpurpleAdapter::login()
                                      └─ purple_account_new(prpl-<id>) + purple_account_set_enabled
                                           └─ prpl connects (TLS: own stack or ssl-openssl.so)

imlibpurpletransport (one resident process, /usr/bin)
   ├─ libpurple 2.14.13 (/usr/lib/libpurple.so.0) + ssl-openssl.so
   ├─ /usr/lib/purple-2/*.so  ← one prpl per network (bind-mounted from /media/cryptofs)
   ├─ db8:     immessage / imcommand / imloginstate / contact (.libpurple), imserver, imchannel
   ├─ tempdb:  com.palm.imbuddystatus.libpurple:1
   └─ LS2 names: com.palm.imlibpurple + com.palm.{telegram,signal,whatsapp,teams}.call
```

### Bridge db8 kinds (`imlibpurpleservice/inc/IMDefines.h`, `files/etc/palm/db/kinds/`)

| Kind | Store | Purpose |
|---|---|---|
| `com.palm.imloginstate.libpurple:1` | db8 | one row per enabled account: `accountId, serviceName, username, capabilityId, state, availability, config` |
| `com.palm.immessage.libpurple:1` (extends `com.palm.immessage:1`) | db8 | every message, in and out. Indexes: `outgoingMsg` (folder,status,localTimestamp), `serviceAndUsername`, `serviceMessageId` (serviceName,username,serviceMessageId) |
| `com.palm.imcommand.libpurple:1` | db8 | non-message commands for the transport (buddy ops, `sendReaction`, `sendPollVote`) |
| `com.palm.contact.libpurple:1` | db8 | buddies exported as contacts (CONTACTS capability, read-only) |
| `com.palm.imbuddystatus.libpurple:1` | **tempdb** | presence: `username, accountId, availability, status, group`, displayName/personId |
| `com.palm.imserver:1` / `com.palm.imchannel:1` | db8 (owner `com.palm.app.messaging`) | guild/network → channel tree for the Servers tab |
| `com.palm.imretaineddata` | db8 | marker written when an account is removed with "keep data" (`IMServiceHandler::onDelete`) |

> **On webOS CE 3.1.0:** "keep data" works end to end. Settings → Accounts → Remove has a checkbox that reaches `onDelete`, and the Accounts app's "Delete Account Data" page lists these markers and calls `purgeRetainedData`. On stock 3.0.5 the accounts service never forwards `keepData`.

Because one bridge handles every protocol, **there are no per-connector db8 kinds**. A connector
is told apart only by `serviceName` (`type_telegram`, `type_whatsapp`, …) (`packaging/README.md`,
"What's in generic").

### Service-name to prpl-id mapping

`LibpurpleAdapter.cpp` `getPrplProtocolIdFromServiceName()` derives `"prpl-" + <suffix of type_>`
for most services, with these overrides:

| `serviceName` | prpl id | Plugin `.so` on device |
|---|---|---|
| `type_teams` | `prpl-eionrobb-msteams-personal` (falls back to `prpl-teams-personal`) | `libteams.so` |
| `type_telegram` | `prpl-telegram` (tdlib-purple `config.cpp.in`) | `libtelegram-tdlib.so` |
| `type_signal` | `prpl-hehoe-presage` | `libpresage.so` |
| `type_whatsapp` | `prpl-hehoe-whatsmeow` | `libwhatsmeow.so` |
| `type_gometa` (Facebook E2EE) | `prpl-gometa`, registered as a **second prpl from the same `libwhatsmeow.so`** (`glue/gometa_init.c` `gometa_register_second_prpl`) | `libwhatsmeow.so` |
| `type_discord` | `prpl-discord` | `libdiscord.so` |
| `type_googlechat` | `prpl-googlechat` | `libgooglechat.so` |

The inverse, `getServiceNameFromPrplProtocolId()`, **must mirror** every override. If it doesn't,
an auto-logged-in account registers under the wrong key, its connect timer never disarms, and the
transport force-disconnects a healthy session (comment above that function).

---

## 2. Account template (one real example, trimmed)

Templates live in `messaging/<svc>/account/com.palm.<svc>/com.palm.<svc>.json` and install to
`/usr/palm/public/accounts/<templateId>/`. This is the Telegram one, with the permission lists
shortened:

```json
[{
  "templateId": "com.palm.telegram",
  "loc_name": "Telegram",
  "icon": {"loc_32x32": "images/telegram-32x32.png", "loc_48x48": "images/telegram-48x48.png"},
  "validator": {"customUI": {"appId": "com.palm.app.telegram", "name": "validator.html"}},
  "loc_usernameLabel": "PHONE NUMBER",
  "readPermissions":  ["com.palm.imlibpurple", "com.palm.app.messaging", "org.webosports.app.messaging",
                       "com.palm.service.contacts.linker", "com.palm.app.telegram", "..."],
  "writePermissions": ["com.palm.app.messaging", "org.webosports.app.messaging", "com.palm.app.telegram", "..."],
  "capabilityProviders": [
    { "capability": "MESSAGING", "capabilitySubtype": "IM", "id": "com.palm.telegram.im",
      "alwaysOn": true, "loc_shortName": "Telegram",
      "icon": {"loc_32x32": "...", "loc_48x48": "...", "splitter": "images/telegram-32x32.png"},
      "implementation": "palm://com.palm.imlibpurple/",
      "onEnabled": "palm://com.palm.imlibpurple/onEnabled",
      "onDelete":  "palm://com.palm.imlibpurple/onDelete",
      "serviceName": "type_telegram",
      "dbkinds": {"immessage": "com.palm.immessage.libpurple:1",
                  "imcommand": "com.palm.imcommand.libpurple:1"},
      "invites": {"supportsCustomMessage": false},
      "groupChat": {"supported": true, "topicsSupported": true, "invitesSupportMessages": false},
      "chatWithNonBuddies": true,
      "reactions": {"supported": true,
                    "map": {"&#128518;": "&#128513;", "&#128558;": "&#128561;"}},
      "authContacts": ["Telegram"] },
    { "capability": "CONTACTS", "id": "com.palm.telegram.contacts", "alwaysOn": true,
      "implementation": "palm://com.palm.imlibpurple/", "sync": "palm://com.palm.imlibpurple/sync",
      "readOnlyData": true, "db_kinds": {"contact": "com.palm.contact.libpurple:1"} },
    { "capability": "PHONE", "id": "com.palm.telegram.call", "loc_shortName": "Telegram",
      "alwaysOn": true, "implementation": "palm://com.palm.telegram.call/",
      "serviceName": "type_telegram", "wanAllowed": true, "wifiAllowed": true,
      "pausePrompt": false, "pauseCode": [], "waitCode": [], "keyHoldMappings": [],
      "videoFormat": "both" }
  ]
}]
```

Notes taken from the templates as they are in the repo:
- **Every** messaging template uses a `validator.customUI` app. The stock 2011
  `imaccountvalidator` keeps a hard-coded template whitelist and rejects new ids with error 22
  ("Invalid templateId in payload") (`discord/apps/.../validator.js` header).
- `reactions.map` is optional. Keys and values are **HTML numeric entities**. It remaps a picker
  emoji to one the network accepts (Telegram's curated set), and mapping to `""` hides the emoji
  (Teams: `{"&#128591;": ""}`, because 🙏 has no consumer-Teams reaction). The Messaging app
  reads the map through `accountService.getReactions` (core-apps `ConversationList.js`).
- The PHONE provider exists only for Telegram, Signal, Teams and WhatsApp. WhatsApp adds
  `"launchCode": "*#"` (meaning not documented in-repo).
- The CONTACTS provider's `sync` maps to the transport's `sync` method (`IMServiceHandler.cpp`
  method table). All seven templates have one.

| Connector | templateId | serviceName | Setup app(s) | Username label |
|---|---|---|---|---|
| Teams | `com.palm.teams` | `type_teams` | `com.palm.app.teams` | EMAIL ADDRESS |
| Telegram | `com.palm.telegram` | `type_telegram` | `com.palm.app.telegram` | PHONE NUMBER |
| Signal | `com.palm.signal` | `type_signal` | `com.palm.app.signal` | PHONE NUMBER |
| Discord | `com.palm.discord` | `type_discord` | `com.palm.app.discord`, `com.palm.app.discordqr` | USERNAME |
| WhatsApp | `com.palm.whatsapp` | `type_whatsapp` | `com.palm.app.whatsapp` | PHONE NUMBER |
| Facebook (E2EE) | `com.palm.gometa` | `type_gometa` | `com.palm.app.gometa` | EMAIL ADDRESS |
| Google Chat | `com.palm.googlechat` | `type_googlechat` | `com.palm.app.googlechat` | EMAIL ADDRESS |

(`messaging/README.md` calls the Facebook template `com.palm.facebook (gometa)`, but the file and
`packaging/messaging/stage.sh` use **`com.palm.gometa`**.)

---

## 3. Transport service: methods, activities, process

**LS2 methods** of `com.palm.imlibpurple` (`IMServiceHandler::s_methods`):
`loginForTesting, onEnabled, onCreate, onDelete, purgeRetainedData, sync, loginStateChanged,
sendIM, sendCommand, startQRLogin, getAuthChallenge, submitAuthInput, openChannel`.

**Activities** (`files/etc/palm/activities/com.palm.imlibpurple/`). Each is a `palm://com.palm.db/watch`
trigger whose callback calls back into the transport:

| Activity file | Watch query | Callback |
|---|---|---|
| `com.palm.imloginstate.libpurple` | `imloginstate.libpurple` where `_rev > 0` | `/loginStateChanged` |
| `com.palm.immessage.libpurple` | `immessage.libpurple` where `status="pending"` AND `folder="outbox"` | `/sendIM` |
| `com.palm.imcommand.libpurple` | `imcommand.libpurple` where `handler="transport"` AND `status="pending"` | `/sendCommand` |

All three require `internet: true`.

**Login state values** (`inc/PalmImCommon.h`): `offline`, `logging-on`, `retrieving-buddies`,
`online`, `logging-off`. `onEnabled(true)` creates the loginstate row with `state:"offline"`,
`availability: ONLINE` ("default to online so we automatically login at first",
`OnEnabledHandler.cpp`). `onEnabled(false)` deletes the loginstate, immessage, imcommand, contact
and buddystatus rows. The chatthreader removes empty threads.

On the TouchPad, `IMLoginState` reads the password via `readCredentials`. An **empty password is
rejected** before login. That is why every setup app stores a non-empty sentinel when the network
has no password: `"logincode"` (Telegram), `"signal-link-pending"`, `"whatsapp-link-pending"`,
`"cookie-auth"` (Google Chat), and a `"devicecode"` sentinel for the Teams fallback
(each app's `source/validator.js`). The legacy 3.0.5 db8 has no `com.palm.config.libpurple:1`
kind, so the build sets `-DIMLIBPURPLE_LEGACY_DB8` to skip that lookup (`build.sh`,
`OnEnabledHandler.cpp`).

**Process model (device).** The transport is kept **resident** instead of hub-launched on demand
(`files/var/README-device-launch.md`):

```
upstart /etc/event.d/imtransport   (start on ls-hubd_private-ready, respawn)
  └─ /var/imdaemon.sh   export IM_RESIDENT=1; rm -f /dev/shm/sem.PmLogLib
       └─ /var/imwrap.sh  -c '{"log":{"appender":{"type":"stdout"},...}}' PalmPre Palm-Pre/1.5
            · mkdir-lock /var/run/imlibpurpletransport.lock  (singleton guard)
            · bind-mount /media/cryptofs/synergy-purple-plugins -> /usr/lib/purple-2
                         /media/cryptofs/synergy-runtime        -> /usr/lib/synergy-runtime
            · self-provision /media/cryptofs/sslfix from Atlas wpe-252 libssl/libcrypto
            · LD_PRELOAD libstdc++ + synergy-glibc librt + libasound
            · LD_LIBRARY_PATH sslfix : /media/cryptofs/synergy-glibc/lib : synergy-runtime : Atlas wpe-252/lib : /usr/lib : /lib
            └─ exec /usr/bin/imlibpurpletransport ... >> /media/cryptofs/imstdout.log  (rotated at 30 MB)
```

`IM_RESIDENT=1` stops `IMServiceHandler::OkToShutdown` from idling out. Without it the
transport's self-shutdown and the respawn fight each other in a ~30 s churn loop. The transport
is linked against a newer glibc than stock, so it needs the `synergy-glibc` loader
(`ld-linux.so.3`) provisioned under `/media/cryptofs/synergy-glibc`. `imwrap.sh` logs FATAL if
it's missing.

> **On webOS CE 3.1.0:** the transport, launch chain and `imtransport` job are in the rootfs, and `ce-cryptofs-seed` copies `synergy-glibc`, `synergy-runtime` and the purple plugins into `/media/cryptofs` once per flash. The `imtransport` job waits for them in a pre-start gate. If the transport isn't running on CE, check `/var/log/imtransport-gate.log` and the `ce-cryptofs-seed` job before `imwrap.sh`.

---

## 4. Incoming message path

```
network ──▶ prpl (tdlib / whatsmeow / presage / purple-discord / libteams …)
   │  1. stash per-message metadata on the PurpleConversation (purple_conversation_set_data):
   │       "webos-msg-id"      = network id of THIS message
   │       "webos-quoted-id"   / "webos-quoted-text" / "webos-quoted-from"   (if it is a reply)
   │  2. serv_got_im / serv_got_chat_in   (attachments: body is file:// URL, <img src=file://…>,
   │                                       or <a href=file://…>)
   ▼
libpurple ─▶ conversation ui-op write_conv = incoming_message_cb  (LibpurpleAdapter.cpp)
   │  · PURPLE_MESSAGE_RECV not set:
   │      - plain local echo: ignored (the app already wrote the Outbox row)
   │      - PURPLE_MESSAGE_REMOTE_SEND (sent from your phone/other client): stored as an
   │        OUTGOING row (folder=outbox) so it shows on the sent side; 1:1 and channel
   │  · drops a pure "<img id=…>" imgstore duplicate (presage sends file:// AND imgstore)
   │  · splits tdlib group senders "id<userId>\x1f<Display Name>" → from.addr / from.name
   │  · resolves channel/server for MUC: chatType="groupchat", channelName, channelDisplayName,
   │    serverId, serverName
   │  · reads the prpl's "muted" blist bool → flags.noNotification (stored, unread, no banner)
   │  · reads + frees the webos-msg-id / webos-quoted-* stash
   ▼
IMServiceHandler::incomingIM ─▶ IncomingIMHandler
   │  · dedup: find by (serviceName, username, serviceMessageId); skip if already in db8
   ▼
db8 put com.palm.immessage.libpurple:1
   { folder:"inbox", status:"successful", from:{addr,name}, to:[{addr}], messageText,
     serviceName, username, timestamp, localTimestamp, serviceMessageId,
     quotedMessageId, quotedText, quotedFrom, chatType, channelName, … }
   ▼
com.palm.messaging.chatthreader  (activity "chatThreader.nullConversation":
   watch com.palm.message:1 where conversations=null AND flags.visible=true)
   · 1:1 → chatthread by normalized address; links personId via Person.findByIM,
     falling back to findPersonViaBuddy (imbuddystatus exact username)
   · groupchat → imserver/imchannel records + one chatthread per channel
   ▼
Messaging app (com.palm.app.messaging) renders the thread: inline quote card, reaction
badges, receipt ticks, inline image/audio/video/doc chips
```

Messages that change an **existing** row go through signals instead (§5): reactions, receipts,
edits, deletes and the outbox-id attach.

---

## 5. Outgoing path

```
Messaging app compose
   │ text / reply / attachment / voice note
   ▼
db8 put com.palm.immessage.libpurple:1
   { folder:"outbox", status:"pending", to:[{addr}], messageText,
     quotedMessageId?   (reply: the original's serviceMessageId)
     filePath?          (absolute local path, e.g. /media/internal/.im-attachments/voicenote_<ts>.wav) }
   ▼
activity "IM Service pending messages watch" ─▶ palm://com.palm.imlibpurple/sendIM
   ▼
OutgoingIMHandler: find outbox+pending ordered by localTimestamp ─▶ SendOneMessageHandler (one at a time)
   ├─ filePath set → LibpurpleAdapter::sendFile
   │     · *.wav → wav_to_opus_voicenote() → *.ogg (libopus VOIP, 24 kb/s, gain 6.0)
   │     · channel target → serv_chat_send_file (needs prpl chat_send_file)
   │     · 1:1            → serv_send_file      (needs prpl send_file)
   │     · failed/cancelled xfer → row downgraded to "failed" (xfer_send_cancel_cb)
   └─ text → LibpurpleAdapter::sendMessage
         · WhatsApp: +E.164 address → device JID (getPurpleUsername)
         · reply: purple_conversation_set_data(conv, "webos-reply-to", quotedMessageId)
         · blist chat (channel) → serv_chat_send, else serv_send_im
         · account still authenticating → routed to the pending account so the prpl can
           capture the reply as a login/2FA code
   ▼
prpl sends; once the network assigns an id it emits "webos-im-outbox-id"
   ▼
OutboxIdHandler merges serviceMessageId onto the Outbox row (so reactions/receipts can find it)
```

**Commands** (reactions, poll votes, buddy ops) go to the **imcommand** kind. The kind name is
derived from the message `_kind` (`immessage` → `imcommand`):

```json
{ "_kind": "com.palm.imcommand.libpurple:1", "command": "sendReaction",
  "handler": "transport", "status": "pending",
  "fromUsername": "<me>", "targetUsername": "<peer or channelName>",
  "serviceName": "type_whatsapp",
  "params": { "targetServiceMessageId": "<id>", "emoji": "&#128077;",
              "remove": false, "targetSender": "<original sender addr>" } }
```

`sendPollVote` uses `params: {pollMessageId, optionNames ("\x1f"-joined, "" clears), senderJid}`.
For group messages the app sets `targetUsername` to the **channelName**, not a person. Otherwise
Discord answers "Unknown Message" (core-apps `ConversationList.js`). Other `command` values
handled by `SendOneCommandHandler`: `blockBuddy`, `deleteBuddy`, `sendBuddyInvite`,
`receivedBuddyInvite`.

---

## 6. webOS extensions: signals and conversation data keys

The transport registers all signals **once, right after `purple_core_init`**
(`registerWebosReactionSignals()`), before any account connects. whatsmeow reconnects from a
saved session instantly. When registration happened per-account (~40 s later), every
WhatsApp/Facebook reaction was silently dropped (comment in `LibpurpleAdapter.cpp`). All signals
hang off `purple_conversations_get_handle()`.

### Libpurple signals

| Signal | Direction | Payload (after `PurpleAccount*`) | Transport handler → db8 effect | Emitted / handled by |
|---|---|---|---|---|
| `webos-im-reaction` | prpl → transport | `targetServiceMessageId, emoji, sender` (`emoji` empty = removed; `sender` empty in 1:1 = peer) | `ReactionHandler`: find the target row by the `serviceMessageId` index, merge/replace this sender's entry in `reactions[]` as `{emoji, sender}` | Discord, Signal, WhatsApp, Facebook E2EE |
| `webos-im-reaction-set` | prpl → transport | `targetServiceMessageId, serialized, NULL`, where `serialized` = `"count<SP>emoji"` records separated by `\n` (empty clears) | **replaces** `reactions[]` with `{emoji, count}` entries | Telegram, Teams |
| `webos-im-outbox-id` | prpl → transport | `serviceMessageId, sentText` | `OutboxIdHandler`: picks the newest Outbox row with no `serviceMessageId` (preferring a `messageText` match) and merges the id | Telegram, Discord, Signal, WhatsApp/FB, Teams |
| `webos-im-receipt` | prpl → transport | `serviceMessageId, status` (`"delivered"`/`"read"`) | `ReceiptHandler` by-id: upgrade `deliveryStatus` on that Outbox row | Signal, WhatsApp, Facebook E2EE |
| `webos-im-receipt-hwm` | prpl → transport | `scope, watermark, status` | `ReceiptHandler` watermark: upgrade every recent Outbox row at/under the watermark. Scopes: `msgid:<prefix>` (Telegram `"<chatId>:<msgId>"`), `id:<peerAddr>` (Teams), `ts:<peerAddr>` (Facebook, ms timestamp) | Telegram, Facebook |
| `webos-im-edit` | prpl → transport | `serviceMessageId, newText` (HTML-escaped) | `EditHandler`: merge new `messageText` onto the original row | WhatsApp/FB combined plugin |
| `webos-im-delete` | prpl → transport | `serviceMessageId` | `DeleteHandler`: set `messageText` to "This message was deleted." | WhatsApp/FB combined plugin |
| `webos-im-send-reaction` | transport → prpl | `targetServiceMessageId, emoji (UTF-8), peer, removeFlag ("1"/"0")` | emitted by `LibpurpleAdapter::sendReaction` (from the `sendReaction` imcommand) | handled by Telegram, Discord, Signal, Teams, WhatsApp, Facebook |
| `webos-im-send-poll-vote` | transport → prpl | `peer, pollMessageId, optionNamesJoined` | emitted by `sendPollVote` | WhatsApp only |

`deliveryStatus` upgrades are **monotonic**: `read` outranks `delivered`, and a row is never
downgraded (`inc/ReceiptHandler.h`).

### Conversation data keys (`purple_conversation_set_data`)

| Key | Set by | Read by | Maps to db8 field |
|---|---|---|---|
| `webos-msg-id` | prpl, right before `serv_got_im` | `incoming_message_cb` (then freed) | `serviceMessageId` |
| `webos-quoted-id` | prpl (incoming reply) | `incoming_message_cb` | `quotedMessageId` |
| `webos-quoted-text` | prpl | `incoming_message_cb` | `quotedText` |
| `webos-quoted-from` | prpl | `incoming_message_cb` | `quotedFrom` |
| `webos-reply-to` | transport `sendMessage` (from `quotedMessageId` on the Outbox row) | prpl send path, which then clears it | network's native reply: Telegram `reply_to`, Discord `message_reference`, WhatsApp `ContextInfo`, Teams inline `<blockquote …>`, Facebook `QuotedMessage`/`ReplyMetaData`, Signal presage quote (`README.md`) |

### Account string settings (out-of-band side channel)

| Key (`purple_account_set_string`) | Purpose |
|---|---|
| `webos-reaction-target-sender` | original sender of the reacted-to message, set just before the synchronous `webos-im-send-reaction` emit, so whatsmeow can build the reaction (FromMe/Participant) even after a restart emptied its cache |
| `webos-pollvote-sender` | same, for poll votes |
| `attachment-path-template` | `/media/internal/.im-attachments/<svc>/$hash$extension` (WhatsApp, Signal, FB) |
| `handle-images` = `xfer` | WhatsApp/FB: emit only the `file://` URL, no inline imgstore copy |
| `webosAccountId` | webOS accountId stamp, mirrored to `<purple_user_dir>/webos-account-ids/` because libpurple's `accounts.xml` save is debounced and was lost on restart |

### Related db8 fields on `immessage`

`serviceMessageId`, `quotedMessageId`, `quotedText`, `quotedFrom`, `reactions` (array),
`deliveryStatus` (`delivered`|`read`), `filePath` (outgoing attachment), `chatType`
(`"groupchat"`), `channelName`, `channelDisplayName`, `serverId`, `serverName`,
`flags.noNotification` (muted chat). db8 is schemaless, so these needed no kind change. The
**`serviceMessageId` index** did, and an index added to an already-registered kind only takes
effect after an explicit `putKind` as the owner (`files/var/provision-im-db.sh`). Otherwise every
reaction lookup fails with `-3965 "no index for query"` (`README-device-launch.md`).

Emoji travel through db8 and the app as `&#NNNNN;` entities, because raw astral characters get
mangled. The transport decodes them to UTF-8 before emitting `webos-im-send-reaction`
(`sendReaction`).

---

## 7. Attachments

| Aspect | Detail (source) |
|---|---|
| Incoming storage | `/media/internal/.im-attachments/{whatsapp,signal,facebook,teams}/<hash><ext>`. Telegram (TDLib) caches media in `/media/cryptofs/.purple-tdlib-files/<username>` with its DB in `/media/cryptofs/.purple-tdlib-db/<username>` (`td-client.cpp`) |
| Incoming body | the prpl writes a `file://` URL, `<img src="file://…">` (tdlib `receiving.cpp`) or `<a href="file://…">name [mime]</a>` as the message text. The Messaging app renders images inline, audio in an in-bubble player, mp4 with a poster thumbnail (tap opens stock `com.palm.app.videoplayer`), and documents as typed icon chips |
| Outgoing pick | core-apps `FilePicker` with `fileType: ["image","video","document"]`; the picked absolute path goes on the Outbox row as `filePath` |
| Voice note record | `MediaCaptureV3` 8 kHz mono WAV at `/media/internal/.im-attachments/voicenote_<ts>.wav` (core-apps `ConversationList.js`) |
| Voice note transcode | transport `OpusEncoder.cpp`: WAV → Ogg/Opus (libopus `OPUS_APPLICATION_VOIP`, 24 kb/s, `OPUS_SIGNAL_VOICE`, own Ogg muxing). It ignores the WAV's broken data-length header and avoids gst (the gst-0.10 opusenc backport hangs at non-48 kHz) |
| Native voice-note send | WhatsApp `send_file_audio` PTT; Telegram `inputMessageVoiceNote`; Discord flag `1<<13` + `duration_secs` + base64 `waveform`; FB E2EE armadillo `AudioTransport` (OPUS+PTT). Signal and plaintext FB send the Opus file as a plain audio attachment (`README.md`) |
| Teams audio | outgoing: `teams_voicenote_to_m4a()` builds AAC/M4A from the kept WAV via `/usr/bin/faac` then `/usr/bin/ffmpeg`, because Opus shows "Can't play message" on Teams Android. Incoming: `teams_audio_to_wav()` turns m4a into WAV because the media server "Failed to get a pipeline" for AAC/MP4 audio. Both child processes run with a **clean environment**, since the transport's LD_PRELOAD/wpe-glibc path makes stock binaries segfault (`teams_contacts.c`) |
| Video send | WhatsApp `send_file_video`; Telegram `inputMessageVideo` (sent as a *document*, Telegram turns an mp4 into a looping GIF); FB armadillo `VideoTransport` (width/height/duration parsed from the mp4); Teams inline AMSVideo uploaded to `/content/video` (`README.md`) |
| Video receive | H.264 mp4 decoded by the Snapdragon S3 (APQ8060) OMX hardware decoder. Works only with the `videoplayer-webm` autoplug shim **off** |
| Documents | WhatsApp `send_file_document`, Telegram `inputMessageDocument`, FB armadillo `DocumentMessage`, Signal |
| Failure | `xfer_send_cancel_cb` marks the Outbox row `failed`. The app offers "Send again" for `failed` and `permanent-fail` |

**Facebook E2EE media is a special path** (`facebook-e2ee/plugin/purple-combined/handle_attachment.go`).
The shared `purple_handle_attachment` bridge hands the download to the glib main loop with
`purple_timeout_add`, and that **never fires from the FB e2ee event context**. So
`handleE2EEMedia` downloads directly with whatsmeow `DownloadFB` (90 s context timeout), writes
`/media/internal/.im-attachments/facebook/<hash><ext>`, and posts `"file://<path>\n<caption>"`
through the same direct `notifyMessage`/`serv_got_im` path FB text uses. Separately, the
transport must set the `attachment-path-template` for `type_gometa`. Without it, gowhatsapp falls
back to an interactive `purple_xfer` that never completes on webOS, and no file is written (comment
in `LibpurpleAdapter::login`).

---

## 8. Buddy list, presence, contacts linkage

- **Presence**: `buddy_status_changed_cb` / `buddy_signed_on_off_cb` → `queuePresenceUpdate`. This
  keeps the **latest tick per buddy** and flushes after a 3 s debounce
  (`PRESENCE_FLUSH_DEBOUNCE_SECONDS`) as one batched find + merge + put into tempdb
  `imbuddystatus.libpurple` (`updateBuddyStatusBatch`, measured on-device as about 32× faster than
  per-buddy writes). Avatars are cached in `/var/luna/data/im-avatars`.
- **Roster to contacts**: `getFullBuddyList` → `BuddyListConsolidator` sorts buddies into
  add/merge/delete for `com.palm.contact.libpurple:1` and `imbuddystatus`. The async prpls
  (tdlib/whatsmeow/presage) load contacts in waves after login, so a resync is scheduled. An
  **incomplete roster no longer wipes** existing contacts. Telegram adds `@username` as a second
  IM entry and skips deleted/nameless users.
- **Person link**: the contacts linker merges `com.palm.contact.libpurple` into
  `com.palm.person`. The chatthreader names a 1:1 thread with `Person.findByIM`. When that
  misses, it falls back to `findPersonViaBuddy` (exact `imbuddystatus.username` + `serviceName`
  → `personId`), now merged into `com.palm.messaging.chatthreader`
  (`device-setup/chatthreader-person-link-fix/README.md`).
- **WhatsApp E.164**: the contacts side kept the leading `+` and `Messaging.Utils.normalizeAddress`
  stripped it, so threads never linked. The fix canonicalizes to `+phone` in `messaging.library`
  (core-apps). `device-setup/whatsapp-e164-normalization/migrate-ondevice.sh` rekeys old threads.
  The transport translates `+phone` back to the device JID before calling whatsmeow.
- **Repair tools**: `messaging/tools/backfill-chatthread-persons.sh` (dry run unless `--apply`) and
  `db8-health-audit.sh` (read-only audit of login states, counts, duplicate threads/channels,
  watch leaks, partition headroom).
- **Contacts search by service**: an index patch on `com.palm.person` (`ims.type` tokenized,
  index renamed so db8 rebuilds it) plus a contacts-app patch that rewrites `telegram` →
  `type_telegram` (`README-device-launch.md`, "Contacts search-by-service").

---

## 9. Sign-in methods

Libpurple's interactive prompts don't map onto the account UI, so the project uses three
mechanisms:

1. **AuthChannel / "create-after-confirm"** (`inc/AuthChannel.h`). The setup app calls
   `startQRLogin {serviceName, username}`, and the transport starts a **pending** prpl login
   purely to obtain the token or session. The prpl raises the QR through `purple_request_fields`.
   The transport installs only that ui-op (`adapter_request_fields`) and reads fields `qr_image`,
   `qr_string`/`qr_data`, `pairing_code` and `captcha_*`. The app polls `getAuthChallenge` (states
   `waiting/scanned/confirmed/expired/failed`) and renders the QR inline. On `confirmed` it calls
   `sendResult`, so the account is created already holding the credential. `submitAuthInput`
   handles cancel and refresh. QR timeout: 300 s (`QR_CONNECT_TIMEOUT_SECONDS`). Normal connect
   timeout: 45 s, after which the transport retries.
2. **Auth chat**. `request_input` is deliberately **NULL**. The prpl opens a chat with a pseudo-buddy
   named after the network and posts the prompt there. The user's reply is routed to the
   still-pending account (`sendMessage` falls back to `s_pendingAccountData`) and the prpl captures
   it: Telegram `promptAuthInputViaChat` (code, 2FA password, display name), Facebook `promptInput`
   in a "Facebook" chat (`gometa.go`).
3. **Static credentials** in the account record (`password` or `config` protocol options copied by
   `Util::createPurpleAccount`).

| Connector | Plugin (upstream) | Sign-in | Status (README matrix) | Quirks |
|---|---|---|---|---|
| **Teams** | `purple-teams` (EionRobb, fork branch `herrie/teams-personal-fixes`), built stock | Microsoft OAuth rendered inline in an Atlas WebView (`application/x-atlas-browser`); `?code=` passed as a `webauth:` credential, plugin exchanges it and persists the refresh_token; device-code fallback | IM, replies, image/audio/video, reactions ✅; **no read receipts**; calls ❌ (WIP `teams_calling.c`) | reaction send = `PUT`/`DELETE …/messages/{id}/properties?name=emotions` with a numeric-ms value; voice notes must be M4A |
| **Telegram** | `tdlib-purple` + TDLib (`tdlib-src`); replaces tgl `telegram-purple` | phone in setup app → code (and 2FA) replied in the "Telegram" chat | everything ✅ incl. voice calls both ways; no video calls | aggregated reactions (`reaction-set`) + template emoji map; watermark receipts from `updateChatReadOutbox`; archive-only chats hidden; `/archive` `/unarchive` commands |
| **Signal** | `purple-presage` (Rust presage + libsignal, **no JVM**); the JVM `purple-signal` build is retired | QR device-link via AuthChannel (URI rendered by `qrcode.js`, presage has no qrencode); username = account **UUID** | IM, replies, image, voice notes, reactions, receipts ✅; calling not re-verified | voice notes sent as plain audio; redundant imgstore copy dropped |
| **Discord** | `purple-discord` (fork branch `herrie/fixes`) + `libqrencode` | QR remote-auth via AuthChannel (with hCaptcha via `submitCaptcha`), or paste a token | IM, replies, media, reactions ✅; no receipts (no peer read state); voice is a scaffold | Servers tab: guild → channel; re-open backfill throttled per channel |
| **WhatsApp** | `purple-combined` (gowhatsapp + whatsmeow, Go c-archive) | phone → QR (`qr_image`) or 8-char `pairing_code` via AuthChannel | everything ✅ incl. voice calls (meowcaller) | E.164 addressing; edit/delete in place; polls; status/newsletters in Servers tab |
| **Facebook (E2EE)** | `purple-combined` second prpl `prpl-gometa` (mautrix-meta messagix + whatsmeow) | email + password; 2FA code typed in the "Facebook" chat (code methods only; approve-on-other-device is rejected) | IM, replies, all media, reactions, receipts ✅ | read receipt fires only when the peer **opens** the thread; media path in §7 |
| **Google Chat** | `purple-googlechat` (EionRobb) + vendored `protobuf-c` 1.4.1 | five browser cookies (`COMPASS/SSID/SID/OSID/HSID`) as protocol options in `config` | IM only, largely untested | no replies |
| Facebook (legacy) | `purple-facebook` (dequis) | email + password | **retired** | can't reach E2EE threads; the only prpl using libpurple's native `purple_ssl_*` (needs `ssl-openssl.so` + the `sslfix` OpenSSL dir) |

Status columns follow the top-level `README.md` matrix. `messaging/README.md` and some per-connector
READMEs/BUILD-LOGs are older (e.g. they still describe tgl Telegram, gowhatsapp-only WhatsApp and
JVM Signal). Trust the code and the top-level README.

---

## 10. Calling: bridging into the stock Phone app

Each calling-capable prpl registers its **own LS2 service name from inside the transport
process**: `com.palm.<net>.call`, matching the PHONE capability's `implementation`. It speaks the
stock Phone app's **CallSynergizer** contract (`telegram/plugin/tdlib-purple/call-luna.cpp`):

| Method | Meaning |
|---|---|
| `callStateQuery` (`subscribe:true`) | streams `{returnValue, allowVideoCalls, videoURI, lines:[{state, incomingVideo, outgoingVideo, incomingVideoState, calls:[{id, origin, transport, address, displayName, …}]}]}` |
| `dial {address}` / `answer {id}` | place / accept |
| `disconnect`, `hangupAll`, `hangupAllActive` | end |
| `hold, swap, merge, extract, dtmf, dtmfEnd, changeMedia` | no-ops |

Facts from the code comments:
- `address`/`displayName` must be **flat on each call object**. `CallSynergyContact.create()`
  throws if `address` is missing. `transport` must be the PHONE account's templateId, or the call
  is shown as a cellular "MOBILE" number.
- **Audio** goes through the PulseAudio `voip`/`voipsource` ALSA PCMs, which only carry
  mic/speaker while audiod has the phone scenario. On connect the plugin calls
  `palm://com.palm.audio/phone/CallStatusUpdate` (lines/calls) and `setCurrentScenario
  {"scenario":"phone_back_speaker"}`, then sends empty `lines` on hangup. The call `id` must be a
  **string**, or PmBtEngine's HFG drops the call and Bluetooth audio never sets up.
- The Phone app builds its "For Calls Use" picker from **any PHONE-capable account**
  (core-apps `com.palm.app.phone` 2.0.1 per `RELEASE-NOTES.md`).

| Network | Signaling | Media | State |
|---|---|---|---|
| Telegram | TDLib calls (`call.cpp`) | libtgvoip (`voipkit-tgvoip.cpp`), logs `/media/internal/tgvoip.log` | ✅ in/out, two-way audio; video WIP (`TELEGRAM_VIDEO_STATUS.md`) |
| WhatsApp | `meowcaller` attached to the **messaging** whatsmeow client (`call.go`), LS2 in `glue/call.c` | MLow/SRTP + ALSA bridge | ✅ in/out audio; one pairing covers chat + calls; the standalone `wacallm` mediator (branch `whatsapp-calling`) is retired |
| Signal | presage `CallMessage` → `src/c/call.c` | `signal_media.c`: libnice ICE + AES-256-GCM SRTP (keys from X25519 + HKDF, `srtp_kdf.c`) + Opus, **not DTLS** | ring/decline/missed earlier; media loopback passed; not re-verified |
| Teams | trouter push + NGC (`teams_calling.c`, `teams_call_luna.c`) | `teams_media` helper | WIP; README marks ❌ |
| Discord | standalone `calling/` C++ client (gateway v10, voice v8, DAVE/libdave, AES-256-GCM) | Opus + ALSA | **compiles and self-tests on ARM only**, never completed a live handshake; bot-token/server-channel only (`STATUS.md`) |

Calling-related config:
- The single LS2 role `files/ls2/roles/{pub,prv}/com.palm.imlibpurple.json` (keyed by `exeName`
  `/usr/bin/imlibpurpletransport`) lists **all** call names in `allowedNames`. A separate
  per-connector role file with the same `exeName` **collides** and breaks registration
  ("does not have permission to register name").
- Each `com.palm.<net>.call.service` file must `Exec=/var/imwrap.sh …`, **not** the raw binary.
  Otherwise hub activation starts a second, unwrapped transport (the "dual-instance race").
- Accounts created before PHONE existed need the provider merged into the account record
  (`telegram/calling/merge-phone-cap.sh`; the Signal recipe is in `signal/calling/ACTIVATE.md`).
  Templates are cached, so editing the file isn't enough.

---

## 11. Build

| Item | Detail |
|---|---|
| Toolchain | crosstool-ng `arm-unknown-linux-gnueabi` GCC 12.5 (`~/x-tools/arm-unknown-linux-gnueabi-gcc125`), ARMv7 cortex-a8, NEON, softfp (`telegram/BUILD-LOG.md`) |
| libpurple | **2.14.13** prebuilt staging in `messaging/libpurple/{include,lib}` with `ssl-openssl.so`. Plugin-dir/sysconfdir/datadir strings are **binary-patched** to `/usr/lib/purple-2`, `/etc`, `/usr/share` (`packaging/README.md`). The recipe that built libpurple itself isn't in this repo |
| Transport | `messaging/imlibpurpleservice/build.sh`: hand-rolled g++ build from `$IMLIB_REPO`, `-std=c++17 -fno-rtti -fpermissive -DMOJ_LINUX -DIMLIBPURPLE_LEGACY_DB8 -O2`. db8 headers **must** match the stock `libmojocore.so` ABI (initial openwebos db8 @ `8a9a902`), glib from `staging-glibc-252`, libtidy, device link stubs |
| Host testing | `build-host-asan.sh` / `run-host-asan.sh` (ASan/UBSan host build), `imlibpurpleservice/test/fuzz` (libFuzzer on text helpers) |
| Dual target | `check-dual-target.sh` compiles `-fsyntax-only` against legacy and LuneOS (db8 3.2.0, luna-service2 3.21.2) headers with both flag states. `messaging/check-plugins-luneos-abi.sh` checks every plugin import against LuneOS exports (LuneOS ships libpurple 2.14.2, so anything newer than that breaks) |
| Go plugins | `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=1 go build -buildmode=c-archive`, then C glue, then link. whatsmeow + `modernc.org/sqlite` are pure Go, so the cross-build is clean. Needs Go ≥1.25 (`whatsapp/BUILD-LOG.md`; current builder `facebook-e2ee/plugin/purple-combined/build-combined.sh`) |
| Rust | `signal/build-presage.sh` → single armv7 `libpresage.so` (presage + libsignal + SQLCipher, rustls) |
| TDLib | `telegram/build-prpl.sh` (+ `build-libtgvoip.sh`, `build-tgcalls-lite.sh`). The TL generators must run on the host |
| Per-connector | `build-<svc>.sh` / `deploy-<svc>.sh` (novacom) |

Plugin `.so` sizes are large (WhatsApp/Telegram ~29 MB each, Signal ~19.5 MB per
`packaging/lib/common.sh`). That's why plugins live on `/media/cryptofs` and are bind-mounted.

---

## 12. Packaging and deployment

`packaging/build-all.sh [names…]` → `packaging/out/*.ipk`. Each package is a `stage.sh` +
`lib/make-ipk.sh` (`ar` of `debian-binary`, `control.tar.gz`, `data.tar.gz`). Nothing is compiled
at that step.

| Package | Contents |
|---|---|
| `com.palm.synergy.generic` (0.9.3) | transport binary, launch chain (`imwrap.sh`, `imdaemon.sh`, upstart job), db8 kinds/permissions, activities, LS2 roles, libpurple engine, shared runtime libs (opus/ogg/opusfile/libstdc++/libtidy…), `synergy-glibc`, cloud `_cloudcore`, `device-setup/*` payloads. `Replaces/Conflicts: imlibpurpleservice` |
| `com.palm.synergy.{teams,telegram,signal,discord,whatsapp,facebook,googlechat}` | account template, setup app, the prpl `.so` (as `libteams.so`, `libtelegram-tdlib.so`, `libpresage.so`, `libdiscord.so`, `libwhatsmeow.so`, `libgooglechat.so`), connector-unique libs (Signal `libutil.so.1`, Google Chat `libprotobuf-c.so.1`), and `com.palm.<net>.call.service` for calling connectors |

(Older docs say `org.webosports.synergy.*`. Commit `f008730` renamed the packages to `com.palm.synergy.*`.)

Packaging rules (`packaging/messaging/postinst`, `prerm`, `lib/common.sh`):
- **Install with `ipkg` / Preware / WebOS Quick Install, not `palm-install`.** `palm-install` runs
  as non-root and skips `postinst`/`prerm`. Install `generic` first. There's deliberately no
  `Depends:` line, because Quick Install/Preware refuse side-loaded dependencies client-side.
- Root (`/dev/mapper/store-root`, 559 MB) is **read-only at extraction time**. Root-fs files
  (account template, `.service`) are staged under
  `/media/cryptofs/synergy-revival/rootfs-overwrite/<PKG_ID>/` and copied by postinst after
  `mount -o remount,rw /`. Stock files are backed up once to
  `/media/cryptofs/synergy-stock-backup/` and restored by prerm. Applied paths are recorded in
  `/media/cryptofs/synergy-revival/applied-paths.<PKG_ID>.list`.
- Offline-root installs (`ipkg -o /media/cryptofs/apps`) **double the prefix**
  (`/media/cryptofs/apps/media/cryptofs/…`). postinst merges it back *before* computing paths.
- postinst order: `stop imtransport` **before** touching any file the transport has mmap'd
  (cryptofs FUSE corrupted a live `.so` to 0 bytes), then a backgrounded
  `luna-send … applicationManager/rescan` (a synchronous call deadlocks LunaSysMgr),
  `ls-control scan-services` (ls-hubd only scans `.service` files at its own start), kill
  `accounts.js` so templates reload, `start imtransport`.

> **On webOS CE 3.1.0:** generic is part of the image and Preware lists it as installed, so don't install it. Install only the network packages (`com.palm.synergy.{teams,telegram,…}`).

**Manual deploy and test loop** (per `deploy-<svc>.sh`):

```sh
novacom run file://bin/sh -- -c "mount -o remount,rw /"
novacom put file:///usr/palm/public/accounts/com.palm.telegram/com.palm.telegram.json < com.palm.telegram.json
novacom put file:///usr/lib/purple-2/libtelegram-tdlib.so < build-arm/libtelegram-tdlib.stripped.so
# on device:
stop imtransport; rm -f /dev/shm/sem.PmLogLib; start imtransport
for p in $(pidof accounts.js); do kill $p; done     # template content is cached in RAM
```

`tests/test-connectors.sh` provisions accounts from a pipe-delimited file
(`templateId | capabilityId | username | password | expect`, see `accounts.example.tsv`). It
classifies each one as `online` / `challenge` / `error` / `timeout` from `imloginstate`.
`tests/test-postinst-*.sh` / `test-prerm-*.sh` cover the installer scripts.

---

## 13. Debugging on device

```sh
tail -f /media/cryptofs/imstdout.log          # transport stdout (imwrap.sh; info level)
status imtransport; ps -ef | grep imlibpurpletransport   # exactly ONE process tree expected
grep 'LSRegisterPalmService FAIL' /media/cryptofs/imstdout.log   # name collision / dual instance

# login state per account
luna-send -n 1 -a com.palm.configurator palm://com.palm.db/find \
 '{"query":{"from":"com.palm.imloginstate.libpurple:1"}}'
# pending outbox
luna-send -n 1 -a com.palm.configurator palm://com.palm.db/find \
 '{"query":{"from":"com.palm.immessage.libpurple:1","where":[{"prop":"folder","op":"=","val":"outbox"},{"prop":"status","op":"=","val":"pending"}]}}'
# call service alive?
luna-send -n 1 -f palm://com.palm.whatsapp.call/callStateQuery '{"subscribe":true}'
```

- For more detail, set `"levels":{"imlibpurple":"debug"}` in `/var/imdaemon.sh` and
  `export IM_PURPLE_DEBUG=1` (libpurple prpl debug is **off** by default; it produced tens of MB
  per hour).
- Per-plugin traces go to `/media/internal/*.log`, because purple_debug never reaches
  `/var/log/messages`: `tgcall.log`, `tgvoip.log`, `fbtrace.log`, `sigcall.log`,
  `teams-call.log`, `wacall_*.log`.
- `tests/test-connectors.sh` still reads `/media/internal/imstdout.log`, while `imwrap.sh` now
  writes to `/media/cryptofs/imstdout.log` (moved in imlibpurpleservice commit `8381d1d`).
- `messaging/tools/db8-health-audit.sh` runs the store-level checks from the host.

---

## 14. Adding a new IM connector: checklist

Derived from how the seven existing connectors are put together:

1. **Plugin.** Vendor the prpl source under `messaging/<svc>/plugin/<prpl>/` (binaries
   git-ignored). Cross-build against `messaging/libpurple` with the gcc125 toolchain. Check with
   `readelf -d` that every third-party `NEEDED` is in generic or ships in your package, and run
   `check-plugins-luneos-abi.sh`.
2. **Unique prpl id.** If it isn't `prpl-<suffix of type_svc>`, add **both** directions to
   `getPrplProtocolIdFromServiceName` / `getServiceNameFromPrplProtocolId`. Never ship two `.so`
   files with the same id (§16).
3. **Headless prpl behaviour.** `send_file`/`chat_send_file` must accept a non-NULL path without a
   UI prompt. Interactive auth goes through `purple_request_fields` (QR) or an auth chat, never
   `request_input`. Don't depend on `purple_timeout_add` from foreign threads (§7).
4. **webOS hooks in the prpl.** Stash `webos-msg-id` (+ `webos-quoted-*`) before `serv_got_im`.
   Emit `webos-im-outbox-id` when the server acks a send. Connect to `webos-im-send-reaction`
   (and read `webos-reply-to`). Emit `webos-im-reaction` or `-reaction-set`, and `webos-im-receipt`
   or `-receipt-hwm`, as the network allows. Set `PURPLE_MESSAGE_REMOTE_SEND` on carbons. Set the
   blist `muted` bool for muted chats.
5. **Account template** `messaging/<svc>/account/com.palm.<svc>/com.palm.<svc>.json`: MESSAGING
   (`serviceName`, `dbkinds` = the shared `.libpurple` kinds, optional `reactions.map`), CONTACTS
   (`sync`), optional PHONE. 32/48 px icons. Read/write permissions for `com.palm.imlibpurple`, both
   messaging app ids, contacts/linker and your setup app. Mirror any `resources/<locale>/` override
   (`docs/ARCHITECTURE.md`).
6. **Setup app** `com.palm.app.<svc>` (Enyo 0.10 `validator.html` + `source/validator.js`) that
   returns `{returnValue, username, credentials:{common:{password}}, config, template, templateId}`
   through `enyo.CrossAppResult`. Use a non-empty sentinel password if the network has none. Add
   the app id to the transport's LS2 inbound ACL (`files/sysbus/com.palm.imlibpurple.role.json.in`
   and `files/ls2/roles/*`) if it calls `startQRLogin`/`getAuthChallenge`.
7. **Attachments.** If the prpl auto-downloads, add its `attachment-path-template`
   (`/media/internal/.im-attachments/<svc>/$hash$extension`) to `LibpurpleAdapter::login`.
8. **Calling (optional).** Register `com.palm.<svc>.call` in-process with the CallSynergizer method
   set. Add the name to the **combined** imlibpurple role `allowedNames` and permissions. Ship a
   `.service` whose `Exec` is `/var/imwrap.sh …`.
9. **Packaging.** Add `packaging/messaging/<svc>/control.env` (`PKG_ID=com.palm.synergy.<svc>`)
   and a `case` in `packaging/messaging/stage.sh` (`stage_account`, `stage_app`, `bump_version`,
   `stage_backend_plugin_as`, `stage_root_file` for the `.service`). Put shared libraries in generic
   only.
10. **Test.** Add a line to `tests/accounts.local.tsv`, run `tests/test-connectors.sh`, then check
    db8 with `db8-health-audit.sh`.

---

## 15. Related device fixes (`device-setup/`)

| Dir | What it does for messaging |
|---|---|
| `legacy-im-disable` | moves dead AOL/AIM (`imaccountvalidator`) and the whole Yahoo IM/contacts/calendar stack, the pre-2.0 oscar/aim/icq prpls and the unused `ssl-gnutls`/`ssl-nss` to `/media/cryptofs/legacy-im-disabled-backup` (reversible) |
| `google-legacy-disable` | removes the dead `com.palm.google` template and `libjabber`/`libxmpp` (the `type_gtalk` → `prpl-jabber` consumer) |
| `skype-disable` | removes stock Skype hooks (Phone app crashed on `skypeBuddyCache`) |
| `chatthreader-person-link-fix` | one-time `repair-existing-threads.sh`; the code fix now lives in the chatthreader repo |
| `whatsapp-e164-normalization` | one-time thread rekey to `+phone` (lib fix is in core-apps) |
| `gst-opus-codec`, `gst-plugins-base-audioresample`, `gst-video-codecs` | gstreamer-0.10 Opus/VP8/VP9/Matroska backports |
| `videoplayer-webm` | WebM mime mislabel (harmless). The **autoplug shim stays off** (`MP_SHIM=1` to force) |
| `bt-a2dp-fix`, `bt-hfg-call-patch` | Bluetooth call audio for IM calls |
| `db8-maintenance` | db8 clean-up script |

> **On webOS CE 3.1.0:** these are applied when the image is built. The dead AOL/Yahoo/Google-legacy/Skype stacks and old prpls are deleted outright, so there is no `*-disabled-backup` directory to restore from, and the codec, Bluetooth HFG/A2DP, db8-clean and Thai-font fixes are present from first boot.

---

## Gotchas

- **Signal / presage crash-loop.** `libpresage` used to SIGABRT the whole transport on login
  ("Couldn't find prpl" panic), taking every account offline. `README.md` says a transport-level
  try/catch around account creation now contains it (no such try/catch is visible in the
  vendored `messaging/imlibpurpleservice` source, so treat the containment as unverified). Separately, two `.so` files registering the
  same prpl id leave it unregistered, so `Util::getProtocolInfo` throws an uncaught MojoException
  and the **whole transport crash-loops** (`telegram/deploy-telegram.sh` purges stale
  `libtelegram*.so` for this reason).
- **`purple_timeout_add` doesn't fire from the FB e2ee event context.** FB media uses the direct
  `notifyMessage` path (§7).
- **The `videoplayer-webm` autoplug shim breaks H.264.** The "won't play / not-negotiated" mp4
  symptom was the shim, not a decoder limit. No IM network sends WebM, so it stays off. Heavy
  back-to-back playback can still crash WebAppMgr on video-overlay teardown.
- **Teams has no read receipts.** The consumer service only ever sends *our own*
  `consumptionhorizon`. Getting peer reads would need polling the thread members (deferred).
  Discord likewise has no peer read state.
- **FB read receipts look late.** A `type="read"` receipt arrives only when the peer opens the
  conversation. A reaction or notification preview doesn't count.
- **Register signals early.** Per-account registration lost every whatsmeow reaction (§6).
- **`sendReaction`/`sendPollVote` complete synchronously.** `SendOneCommandHandler` must call
  `messageFinished()` for them, or the command queue never re-arms and only one command per
  transport lifetime is processed.
- **The reaction index needs `putKind`.** Shipping a new kind file doesn't add an index to a
  registered kind (`-3965`). Run `provision-im-db.sh`. A reflash reverts it.
- **Small partitions.** `/var` is about 62 MB, so libpurple conversation logging is disabled
  (`log_ims/log_chats/log_system = FALSE`) and TDLib's DB/files go to `/media/cryptofs`. Root is
  559 MB, so plugins are bind-mounted from cryptofs (cryptofs can't hold symlinks). Don't put
  sqlite on vfat `/media/internal` (no reliable locking).
- **PmLog semaphore hang.** A transport killed mid-init leaves `/dev/shm/sem.PmLogLib` locked. The
  next one blocks forever with zero output. `imdaemon.sh`/`imwrap.sh` delete it on every launch.
- **Dual instance.** Owning the bus name does *not* stop ls-hubd from activating its own copy. Use
  the `imwrap.sh` mkdir lock and route every `.call.service` through `imwrap.sh`. Don't "neuter"
  the activation services either: it breaks sends and calls (`imlibpurpleservice/README.md`).
- **One LS2 role per `exeName`.** Extend the combined imlibpurple role. Never add a per-connector
  role for the same binary. ls-hubd reads roles at boot.
- **Templates are cached.** Kill `accounts.js` (and restart LunaSysMgr) after editing a template.
  For existing accounts, merge new capability providers into the account record.
- **Child processes from the transport** (faac, ffmpeg, gst-launch) must run with a clean
  environment, or the wpe-glibc `LD_PRELOAD` segfaults them.
- **Outbox-id correlation is heuristic.** It uses the newest un-id'd Outbox row and prefers a text
  match. Two identical texts sent within seconds can swap ids, which is harmless.
- **Group reactions/replies target the channel.** Use `channelName` as `targetUsername`.
- **Telegram mp4 sent as a document turns into a GIF.** Use `inputMessageVideo`.
- **Opus voice notes are unplayable on Teams Android.** Send M4A. Incoming Teams AAC is
  transcoded to WAV for the stock media server.
- **The OpenSSL shadowing (`sslfix`)** only matters for libpurple's native `purple_ssl_*` (legacy
  purple-facebook). The other prpls bring their own TLS. `imwrap.sh` copies matched
  `libssl.so.3`/`libcrypto.so.3` from the Atlas app, so **Atlas must be installed**.
- **The connect timeout is retried, not parked.** A transient 45 s timeout used to leave all
  accounts at `OFFLINE`. It now retries with backoff, and a NULL-account path that crashed the
  transport was fixed (`connectTimeoutCallback`).
- **Pending libwhatsmeow ownership.** WhatsApp and Facebook packages both stage the same
  `libwhatsmeow.so` path (`packaging/messaging/stage.sh`, "small duplication"). Check for an
  ipkg file-ownership conflict when installing both.

---

## See Also

- `webos://knowledge/synergy-architecture`: one-page overview of the whole Synergy system; start here
- `webos://knowledge/synergy-internals`: how the framework works underneath (accounts service, lifecycle, Sync library)
- `webos://knowledge/synergy-cloud-connectors`: cloud/file connectors (DOCUMENTS / PHOTO.UPLOAD)
- `webos://knowledge/synergy-music-connectors`: streaming music providers ("Music" account type)
- `webos://knowledge/synergy`: generic JS Synergy services (account templates, `sendIM`,
  `immessage`/`chatthread` from JS, `onDelete`)
- `webos://knowledge/db8`: kinds, indexes, `putKind`, watches, tempdb
- `webos://knowledge/activity-manager`: db-watch-triggered activities like the three above
- `webos://knowledge/ls2-roles`: role files keyed by `exeName`, public/private bus
- `webos://knowledge/postinst-packaging`: ipkg/Preware postinst patterns, read-only root
- `webos://knowledge/tls-and-networking`: why modern TLS lives in prpls / curl, not node
