# webOS Synergy Internals

How the Synergy account/sync framework works under the hood: the accounts service, account templates, the account lifecycle and its callbacks, the mojoservice runtime, the Sync library's state machine, and how data reaches the stock apps. `webos://knowledge/synergy` covers *writing* a third-party Synergy service; this file explains the machinery that service plugs into. Everything here was read from code. Where something could not be found, it says so.

**Source key** (paths are repo-relative or rootfs-relative so they can be checked):

| Tag | What it is |
|---|---|
| `app-services/...` | Open webOS / webOS-ports `app-services` repo (the accounts service is logically identical to the one in 3.0.5, apart from the LuneOS additions noted below) |
| `[305] ...` | Stock TouchPad webOS 3.0.5 rootfs, path under `/usr/palm/` or `/etc/palm/` |
| `[LuneOS] ...` | A LuneOS rootfs image, path under `/` |
| `imlibpurpleservice@8812bdf`, `mojomail/...` | C++ transports (8812bdf = the unmodified 3.0.5 import) |

---

## Components and Ownership

| Component | Bus name / location | Owns |
|---|---|---|
| Accounts service | `com.palm.service.accounts` (JS, `app-services/com.palm.service.accounts/`) | Template registry (in RAM), `com.palm.account:1` records, credentials (through keymanager), `com.palm.account.syncstate:1` cleanup, firing the transport callbacks |
| Account templates | `/usr/palm/public/accounts/<dir>/*.json` (ROM), `/media/cryptofs/apps/usr/palm/accounts/<dir>/*.json` (installed apps) | Declaring account types, capabilities, callback addresses, permissions |
| Accounts UI | 3.0.5: `com.palm.app.accounts` (Enyo) built on the Enyo library `$enyo-lib/accounts` (`[305] frameworks/enyo/0.10/framework/lib/accounts/`). Mojo apps use the `accounts.ui` framework | Template picker, credential form, calling the validators, capability toggles, remove |
| Keymanager | `com.palm.keymanager` | Encrypted key store. The accounts service keeps one `ASCIIBLOB` key per account |
| Transports | e.g. `com.palm.service.calendar.google` (JS), `com.palm.imap` / `com.palm.imlibpurple` (C++) | Remote I/O, the transport (sync-state) record, and the content records in their own sub-kinds |
| mojoservice frameworks | `/usr/palm/frameworks/{mojoservice, mojoservice.transport, mojoservice.transport.sync, foundations}` | JS service runtime, client/command queue, generic two-way sync engine |
| ActivityManager | `com.palm.activitymanager` | Periodic syncs, db8-watch triggers, keeping services alive |
| Chat threader | `com.palm.messaging.chatthreader` | Linking `com.palm.message:1` records to `com.palm.chatthread:1` |
| Contacts linker | `com.palm.service.contacts.linker` | Merging `com.palm.contact:1` sub-kind records into `com.palm.person:1` |

### Accounts service API (`app-services/com.palm.service.accounts/services.json`)

| Method | Public | Permission check | Notes |
|---|---|---|---|
| `listAccountTemplates {capability?}` | yes | none | `capability` may be a string or an array |
| `listAccounts {templateId? \| capability?}` | no | none | Always adds `beingDeleted=false`. Returns accounts annotated with their template. Accounts whose template is missing are skipped |
| `listAccountsPublic` | yes | hard-coded whitelist (`publicwhitelist.js`: QuickOffice apps, capability `documents`) | |
| `getAccountInfo {accountId}` | yes | `readPermissions` | Returns `{result: <annotated account>}` |
| `createAccount` | yes | `writePermissions` | `commandTimeout: 20` |
| `modifyAccount {accountId, object}` | yes | `writePermissions` | `commandTimeout: 3600` |
| `deleteAccount {accountId}` | yes | `writePermissions` | `commandTimeout: 20`. The real work runs asynchronously in `notifyAccountDeleted` |
| `readCredentials {accountId, name}` | no | `readPermissions` | Returns `{credentials: <value stored under name>}` |
| `readCredentialsPublic {accountId, name}` | yes | hard-coded whitelist (`publicwhitelist.js`, QuickOffice only) | Same as `readCredentials`, for whitelisted public-bus callers |
| `writeCredentials {accountId, name, credentials}` | no | `writePermissions` | Fires `onCredentialsChanged` without waiting for it |
| `hasCredentials {accountId}` | no | none | `{value: bool}` from keymanager `keyInfo` |
| `appsChanged` | no | — | Reloads the templates |
| `restoreCompleted` / `accountsChanged` | no | — | Post-restore: calls `onCapabilitiesChanged` + `onEnabled(true)` for every account (`backup/com.palm.service.accounts` maps `restoreFinished` to `accountsChanged`) |
| `setPrefs {deviceName}` | no | none | Merges `deviceName` into the `com.palm.palmprofile` account |
| `notifyAccountCreated`, `notifyAccountDeleted`, `stayRunning` | no | — | Internal. `commandTimeout: 3600` |
| `createLocalAccount` | yes | — | Open webOS/LuneOS only (not in 3.0.5). Creates the `com.palm.palmprofile` account when first-use was skipped |

> **On webOS CE 3.1.0:** the accounts service is the community Open webOS/LuneOS build (1.1.0.1), so `createLocalAccount` is present, though nothing on CE calls it. When first use is skipped, `com.palm.service.palmprofile` creates the profile account ("webOS User"); a manual call to this method would name it "LuneOS".

**Permission check** (`utils.js` `hasPermission`): the caller is `message.applicationID() || senderServiceName()`, with the `" <pid>"` suffix stripped. `com.palm.app.accounts` and `com.palm.service.accounts` always pass. Otherwise the caller must match an entry in the template's `readPermissions` / `writePermissions`. Entries are globs, where `*` and `?` are converted to a regex. A failed check throws `"Permission denied! <caller> is not specified in template <id> <list>"`.

### Keymanager storage of account credentials

`models/credentials-model_keymanager.js` stores **one key per account**: `keyname = accountId`, `type: "ASCIIBLOB"`, `nohide: true`. `keydata` is a JSON object keyed by credential *name*. `createAccount` writes every top-level key of `credentials` separately, so `credentials: {common: {password: "x"}}` becomes `keydata = {"common": {"password": "x"}}`. Transports read it back with `readCredentials {accountId, name: "common"}`. IMAP does exactly this (`mojomail/imap/src/commands/ImapAccountFinder.cpp`). Google calendar uses `name: "calendar"` (`[305] services/com.palm.service.calendar.google/javascript/assistants/serviceassistant.js`). All keymanager calls go through a single serialised queue (`enqueueCall`).

In the LuneOS keymanager reimplementation, keys are namespaced by the caller's appId (`keymanager/service/javascript/utils/Common.js` `getAppId`). A service's own `store`/`fetchKey` keys therefore never collide with the accounts service's per-account keys. Whether the original proprietary keymanager also did this was not verified.

---

## Account Templates

### Discovery (`app-services/com.palm.service.accounts/accounts.js`)

1. For each root in `TEMPLATE_ROOTS = ["/usr/palm/public/accounts", "/media/cryptofs/apps/usr/palm/accounts"]`, list the subdirectories. In each subdirectory, take every `*.json` regular file. This is **one level only**: `resources/` is not scanned as templates.
2. Each file is loaded through `Globalization.ResourceBundleFactory(dir).getLocalizedResource(file)`, so a locale-specific copy under the template's `resources/<locale>/` can replace it.
3. The file may hold a bare template object or an array of templates (both accepted, `schemas/template-file.json`). Each template is validated against `schemas/template.json`.
4. `allowed_locales` / `disallowed_locales` filter by the current locale. A duplicate `templateId` is ignored with a warning. The list is sorted by `loc_name`.
5. Relative paths in the top-level `icon` and in each capability's `icon` are made absolute against the template directory. Every key is prefixed, including `splitter`.
6. The sorted list of template IDs is compared with a tempdb record `{_kind:"com.palm.signaling:1", appId:"com.palm.accounts.templates", templates:"<ids>"}`. If it differs, the record is rewritten. UIs watch this record (`Accounts.getTemplates` subscribes to it in `lib/accounts/source/get-templates.js`) and re-call `listAccountTemplates`.

Templates are parsed **once**, in the service assistant's `setup()`. They are re-read on `appsChanged`, which 3.0.5 sends from System UI when an app is installed or removed (`[305] /usr/lib/luna/system/luna-systemui/data/AppManagerService.js`). On a locale change the service calls its own `__quit` to reload. Only the *list of IDs* is signalled to UIs, so editing the content of an existing template is never pushed to them.

### Template fields

Fields come from `schemas/template.json` and from the code that consumes them. "Consumer" is where the field is read.

| Field | Level | Consumer / effect |
|---|---|---|
| `templateId` | top | Required. The key used everywhere; stored on the account record |
| `loc_name` | top, cap | Display name. A capability-level `loc_name` overrides it in some lists |
| `loc_shortName` | cap | Messaging transport picker. The Messaging app falls back to the first 5 characters of `loc_name` (`ipk com.palm.app.messaging: data/accountService.js`) |
| `loc_usernameLabel`, `loc_passwordLabel` | top | Labels on the credential form (`lib/accounts/source/credentials.js`) |
| `icon.loc_32x32`, `icon.loc_48x48`, `icon.splitter` | top, cap | Lists and title bar. When an app filters by capability, the capability icons replace the account icons (`promoteCapabilityIcons`) |
| `validator` | top, cap | Either a string bus address or `{address, customUI:{appId, name}}`. **A template with no `validator`, or with `hidden: true`, is left out of "Add account"** (`lib/accounts/source/get-accounts.js`, `util.js`) |
| `validator.customUI` | top | Instead of the user/password form, the UI loads `<appId>/<name>` cross-app (`Accounts.crossAppUI`, mode `create`/`modify`). That page returns `{returnValue, credentials, config, username?, alias?}` itself |
| `hidden` | top | Not offered in "Add account" |
| `invisible` | top | Accounts with this flag are dropped from `Accounts.getAccounts` results. Accounts whose template is missing are marked `invisible` too |
| `disableRemove` | top | Read only by the Mojo `accounts.ui` framework. Not found in the Enyo library |
| `readPermissions`, `writePermissions` | top | Caller globs checked by the accounts service (see above) |
| `onCapabilitiesChanged` | **top only** | Called with the full provider/enabled list. The service never reads it from a capability provider |
| `onCredentialsChanged` | top and cap | Both are called |
| `allowed_locales`, `disallowed_locales` | top | Locale filter at load time |
| `config` | top, cap | Template-level config is not used by the accounts service. The Enyo UI merges a capability's `config` (or the validator's) into the validator's `config` param and passes it to `createAccount`, e.g. Google mail: `{server:"imap.gmail.com", port:993, encryption:"ssl", smtpConfig:{...}}` |
| `capabilityProviders[]` | top | Required array. Each entry needs `id` and `capability` |
| `capabilitySubtype` | cap | `"IM"` / `"SMS"` under `MESSAGING` (Messaging app `cleanCapability`) |
| `implementation` | cap | Documented as the bus address of the implementation (schema). The accounts service does not call it |
| `onCreate`, `onEnabled`, `onDelete`, `sync` | cap | Lifecycle callbacks (next section). `sync` is not called by the accounts service |
| `alwaysOn` | cap | Cannot be disabled: `modifyAccount` rejects it with `400_BAD_REQUEST`, and the UI greys out the toggle |
| `dbkinds` (also `db_kinds`, `subKind`) | cap | Tells apps **which sub-kind to write into**. Messaging writes outgoing IMs to `dbkinds.immessage` and commands to `dbkinds.imcommand`. Calendar uses `dbkinds.calendarevent \|\| db_kinds.calendarevent \|\| subKind` for new events (`ipk com.palm.app.calendar: app/shared/CalendarsManager.js`). Contacts maps `dbkinds.contact` to its provider |
| `readOnlyData` | cap | Contacts UI does not offer the account as a target for new contacts (`lib/contactsui/Logic/AccountListEnyo.js`) |
| `serviceName` | cap | IM service key such as `type_gtalk`. Must match `serviceName` on the messages and buddies |
| `chatWithNonBuddies`, `invites`, `groupChat`, `supportsInvisibleStatus` | cap | Messaging app features |
| `settingsUI`, `wanAllowed`, `wifiAllowed`, `pauseCode`, `waitCode`, `keyHoldMappings`, `launchCode` | cap | PHONE providers (Phone app) |
| `refetchPhoto` | cap | Contacts photo refetch (contacts frameworks) |
| `query` | cap | REMOTECONTACTS (EAS GAL `queryGal`) |
| `prpl`, `loc_explainUsernameLabel` | top | LuneOS IM templates only (`[LuneOS] /usr/palm/public/accounts/org.webosports.messaging.matrix/`) |

**`customUI` / `hidden` / `invisible` in practice** (`[305] public/accounts/`): EAS and Skype use `validator.customUI`. `com.palm.telephony` sets `hidden`, `invisible` and `disableRemove`.

---

## The Account Record (`com.palm.account:1`)

Kind file: `app-services/com.palm.service.accounts/db/kinds/.../com.palm.account`. It has `"sync": true` and two indexes: `uniq_tmpl` (`beingDeleted, templateId, username`) and `cap` (`capabilityProviders.capability, beingDeleted`).

```json
{
  "_kind": "com.palm.account:1",
  "templateId": "com.palm.google",
  "username": "user@example.com",
  "alias": "Work",
  "beingDeleted": false,
  "capabilityProviders": [
    {"_id": "2a1", "id": "com.palm.google.contacts", "capability": "CONTACTS"},
    {"_id": "2a2", "id": "com.palm.google.calendar", "capability": "CALENDAR"}
  ]
}
```

- The record holds only **enabled** providers. Template fields are merged in at read time ("annotate"). Template values override record values at both levels.
- db8 gives every object inside an array its own `_id` (`db8/src/db/MojDb.cpp` `assignIds`). Client code uses that `_id` as the **"is enabled" marker**: the Enyo annotate lists *all* template providers, and only the enabled ones carry `_id` (`lib/accounts/source/modify.js`: `c.enabled = !!c._id`). The service's `notifyAccountCreated` / `notifyAccountDeleted` / `writeCredentials` also filter on `cp._id`.
- `config` is **not** stored on the account. It reaches the transport only once, as the `config` param of `onCreate`. A transport must persist anything it needs. IMAP does this by creating its `com.palm.imap.account` record in `AccountCreator`.
- Other fields: `_sync` (optional, from createAccount), `retries` (delete retry counter), `deviceName` (profile account only).
- Read access: 3.0.5 grants `com.palm.*` plus the QuickOffice apps. Open webOS/LuneOS also grant `com.webos.*` and `org.webosports.*` (`db/permissions/.../com.palm.account`).

> **On webOS CE 3.1.0:** `com.webos.*` and `org.webosports.*` callers can also read `com.palm.account:1`.

---

## Account Lifecycle

### Add account

```
User     Accounts UI (enyo lib)        validator(s)          accounts service             transport(s)
 | pick template  |                          |                        |                           |
 |--------------->| customUI? -> load cross-app page instead of the form |                           |
 | user+password  |                          |                        |                           |
 |--------------->| {username,password,templateId,config,accountId}    |                           |
 |                |------------------------->|  (template validator + every capability validator, in parallel)
 |                |<-- {returnValue, credentials:{name:{..}}, config?, username?, alias?} / errorCode
 |                | duplicate check (getAccounts by templateId)       |                           |
 | toggle caps,   |                          |                        |                           |
 | "Create"       |-- createAccount {templateId, username, alias, credentials, config,          |
 |                |                  capabilityProviders:[{id}...]} ->|                           |
 |                |                          |      writePermissions check                      |
 |                |                          |      DB.find dup -> DUPLICATE_ACCOUNT            |
 |                |                          |      DB.put com.palm.account:1                   |
 |                |                          |      KeyStore.put(accountId, name, value)        |
 |                |<------------------------------ {result: account}                            |
 |                |                          |      async notifyAccountCreated {accountId, config}
 |                |                          |      wait 1 s                                    |
 |                |                          |      onCreate {accountId, config} ------------->| each ENABLED provider
 |                |                          |      <------------------------- {returnValue:true}  (all must succeed)
 |                |                          |      onEnabled {accountId, capabilityProviderId, enabled:true} -> each enabled provider
 |                |                          |      <------------------------- {returnValue:true}  (all must succeed)
 |                |                          |      template.onCapabilitiesChanged             |
 |                |                          |        {accountId, capabilityProviders:[{id, enabled}]} (every template provider)
```

Details (`handlers/create.js`, `handlers/notify-created.js`, `lib/accounts/source/credentials.js`):

- **Validator params**: the Enyo UI sends `{username, password, templateId, config, accountId}`. For a capability-level validator, `templateId` actually holds the **capability provider id** (`createValidatorParams(..., v.id, ...)`). `config` is the template/capability `config`, merged.
- **Validator reply**: `returnValue:true` plus `credentials` (merged across validators), and optionally `config`, `username` and `alias`, which override what the user typed. On failure, `errorCode` is mapped to a message (`lib/accounts/source/errors.js`: `401_UNAUTHORIZED`, `408_TIMEOUT`, `NO_CONNECTIVITY`, `SSL_CERT_*`, `DUPLICATE_ACCOUNT`, `SINGLE_ACCOUNT_ONLY`, ...). Any failing validator fails the whole sign-in.
- **`createAccount` params**: `templateId`, `capabilityProviders` (array, required), and `username` (required) are always needed. Pass either `password` **or** `credentials`, never both. Optional: `alias`, `config`, `_sync`. With `password`, the *service* runs the validators itself (`checkPassword`, mapReduce) and takes `credentials`/`config` from their replies. The Enyo UI passes `credentials`, so no validator runs on this path.
- `createAccount` replies before any transport is told. Callback failures never reach the UI.
- The success test for `onCreate`/`onEnabled` is `r.returnValue || r === true`. The counter only advances on success: **if any `onCreate` fails, `notifyAccountCreated` never moves on, so no `onEnabled` is sent** and the command eventually hits its 3600 s timeout.
- `onCreate` is only sent to providers enabled at creation time. A capability switched on later receives `onEnabled` only.

### Enable / disable a capability, change alias (`modifyAccount`)

Params: `{accountId, object:{capabilityProviders?:[{id}], alias?, username?, credentials?}, suppressNotifications?}`. Order (`handlers/modify.js`):

1. If `object.credentials` is set: delete the account's rows in `com.palm.account.syncstate:1`, delete the old key, then store the new credentials.
2. Reject removal of an `alwaysOn` provider (`400_BAD_REQUEST`). `DB.merge` username, alias and the new provider list. `object.config` is **not** saved.
3. If the enabled set changed: call `template.onCapabilitiesChanged {accountId, capabilityProviders:[{id, enabled}]}`.
4. If credentials changed (and not `suppressNotifications`): call `onCredentialsChanged {accountId}` on the template and on every provider not being newly enabled. These calls are awaited.
5. Call `onEnabled {accountId, capabilityProviderId, enabled}` for each added and each removed provider. These are awaited.
6. If any awaited call failed: flip the failed provider ids back in the stored list and return `errorCode: "TRANSPORT_FAILURE"`.

Removing a capability from inside a PIM app is a `modifyAccount` that drops that provider. If none would be left, the UI calls `deleteAccount` instead (`lib/accounts/source/remove-account.js`).

### Credentials change

There are two paths:

- `modifyAccount` with `object.credentials`: step 4 above, awaited. The Enyo "change login" view and the cross-app `customUI` (mode `modify`) use this path.
- `writeCredentials {accountId, name, credentials}`: stores one named entry, then fires `onCredentialsChanged {accountId}` on the template and on every enabled provider, without waiting. Transports use this to persist rotated tokens.

### Delete

```
deleteAccount {accountId}                 (handlers/delete.js)
  writePermissions check; error if already _del / beingDeleted
  DB.merge beingDeleted:true            -> account disappears from every list (all queries filter it)
  wait 1.5 s
  tempdb put syncstate {accountId, syncState:"DELETE", capabilityProvider:"com.palm.service.accounts"}
  reply {}  + async notifyAccountDeleted {accountId}
notifyAccountDeleted                      (handlers/notify-deleted.js)
  wait 2 s
  onEnabled {accountId, capabilityProviderId, enabled:false}  -> each ENABLED provider
  onDelete  {accountId}                                        -> EVERY template provider with onDelete
  keymanager remove (accountId key)
  tempdb del syncstate where accountId
  DB.del account record
```

- **The accounts service never deletes content.** Contacts, events, mail and messages are removed by the transports. Disabling is where the Sync library does it (`disableAccount` below), and imlibpurple wipes in `onEnabled(false)` as well. `onDelete` in the Sync library only removes the transport record.
- The `onEnabled(false)`/`onDelete` loops use the same "all must succeed" counter. If one fails, the key, the syncstate and the account record are **not** removed. `stayRunning` (started for 3500 s by `setup()`) runs `resumeAccountDeletes` when it ends: every `beingDeleted` account with `retries < 5` gets `retries+1` and a new `notifyAccountDeleted`. `restoreCompleted` deletes `beingDeleted` records outright.
- LuneOS adds `keepData` to the delete flow. `deleteAccount {keepData}` forwards it, together with `alias` and `templateId`, to `onDelete` (commit `24d2cde`/`ef97300`).

> **On webOS CE 3.1.0:** `deleteAccount {keepData}` is honoured, and every `onDelete` receives `{accountId, keepData, alias, templateId}`. The system Remove Account dialog sets it from a "keep data" checkbox. `onEnabled(false)`, which runs first, does not carry `keepData`, so a transport that wipes there must handle the keep case itself.

### Callback summary

| Callback | Sent by | Params | Expected reply |
|---|---|---|---|
| validator | Accounts UI (or `createAccount` given `password`) | `{username, password, templateId, config, accountId?}` | `{returnValue:true, credentials, config?, username?, alias?}` or `errorCode` |
| `onCreate` | `notifyAccountCreated` | `{accountId, config}` | `returnValue:true` |
| `onEnabled` | create / modify / delete / restore | `{accountId, capabilityProviderId, enabled}` | `returnValue:true` |
| `onCapabilitiesChanged` (top) | create / modify / restore | `{accountId, capabilityProviders:[{id, enabled}]}` | awaited on modify |
| `onCredentialsChanged` (top + cap) | modify (awaited) / writeCredentials (not awaited) | `{accountId}` | `returnValue:true` |
| `onDelete` | `notifyAccountDeleted` | `{accountId}` (+ `keepData, alias, templateId` on LuneOS) | `returnValue:true` |

---

## Capabilities and Their Consumers

| Capability | Provided by (3.0.5 templates) | Consumer found in code |
|---|---|---|
| `CONTACTS` | google, facebook, yahoo, linkedin, eas, sim, skype, palmprofile | Contacts app (`capability:"CONTACTS"`). The contacts linker watches `com.palm.contact:1` and builds `com.palm.person:1` (`app-services/com.palm.service.contacts.linker/activities/...`) |
| `CALENDAR` | google, facebook, yahoo, eas, palmprofile | Calendar app |
| `MAIL` | imap, pop, othermail, google, yahoo, eas, mobileme | Email app |
| `MESSAGING` (+`capabilitySubtype` `IM`/`SMS`) | aol, google, yahoo, skype, palmprofile (SMS) | Messaging app (`getAccounts({capability:"MESSAGING"})`) |
| `PHONE` | telephony, skype, palmprofile | Phone app |
| `PHOTO.UPLOAD` | facebook, photobucket, snapfish (implementation `com.palm.service.photos`) | Photos app (`["PHOTO.UPLOAD","LOCAL.FILESTORAGE"]`) |
| `VIDEO.UPLOAD` | none in 3.0.5 templates | Photos app references it |
| `DOCUMENTS` | google, boxnet, dropbox, mobileme | QuickOffice through `listAccountsPublic` |
| `TASKS` | eas, palmprofile | The Enyo modify view hides TASKS rows ("until there is a tasks app"). A 3.0.5 app consumer was not found |
| `MEMOS` | palmprofile | Consumer not found in available sources |
| `REMOTECONTACTS` | eas (`query: queryGal`) | Only in Email app unit-test specs. A runtime consumer was not found |
| `LOCAL.FILESTORAGE` | palmprofile | Photos app |

> **On webOS CE 3.1.0:** the google, yahoo, aol and skype templates and their transports (including `com.palm.service.calendar.google`, cited on this page) are removed from the image, so those providers are absent from Add Account and those source paths don't exist on a CE device. Read them from a stock 3.0.5 rootfs. The capability consumers are unchanged.

The Mojo `accounts.ui` framework also has display names for `VOICE`, `SMS` and `IM` (`[305] frameworks/accounts.ui/submission/41/javascript/capabilities.json`).

---

## The mojoservice Runtime

### Launch, bus, idle exit

- D-Bus/LS2 activation runs `run-js-service -n /usr/palm/services/<name>` (`.service` files). That script runs `node .../jsservicelauncher/bootstrap-node.js`, which loads `sources.json` and then creates `new mojoservice.AppController(args)` (`[305] services/jsservicelauncher/bootstrap-node.js`).
- `sources.json` entries are `{"override":...}` (these must come first), `{"library":{name,version}}` (exposed as `IMPORTS[name]`), and `{"source":file}`. `IMPORTS.mojoservice` is always loaded.
- `services.json` is validated against `mojoservice/schema/services-schema.json`. Each command registers on the **private** bus. Commands with `public:true` also register on the public bus. A service whose name starts with `com.palm.` (LuneOS adds `com.webos.` and `org.webosports.`), or that sets `privatebus:true`, *sends* on the private bus. Other services send on the public bus (`controller_service.js`).
- Every service also gets `__info` and `__quit`.
- **Idle exit**: `activityTimeout` is the time with no live command activities before `shutdown(true)`. **The default in code is 5 s** (`controller_app.js _defaultActivityTimeout: 5`). The bundled `doc/services-json.md` says 60 s, which is wrong. `commandTimeout` defaults to 60 s and can be set on the app, service, command, or the assistant's `commandTimeout` property, in increasing precedence. On timeout the command's future gets exception `504 "commandTimeout in <svc>/<cmd>"`, and `assistant.timeoutReceived(msg)` is called first if it exists.
- `run-js-service -k` / `--disable-timeouts` turns off both timeouts (debugging).

### Command lifecycle (`controller_command.js`)

```
new CommandController
  parse payload -> this.args
  args.$activity?  sender == com.palm.activitymanager -> Activity.adopt(id), reply {returnValue:true} at once
                   otherwise                         -> Activity.monitor(id)
  else                                               -> create + start a new foreground Activity
  assistant = new <command.assistant>();  assistant.setup(message)
run(): wait for adopt -> argsSchema check -> start commandTimeout timer
       service.commandRunner.runCommand(cc)   (default: future.now(assistant.run))
       future resolves -> returnSchema check -> respond
cleanup(): assistant.complete(activity) if defined, else activity.complete();  assistant.cleanup()
```

- A service assistant's `setup()` may return a Future. No command is dispatched until it resolves.
- Replies: a normal result gets `returnValue:true` added. An exception becomes `returnValue:false`, with `errorCode -9999` if none was given.
- `assistant.yield(activity)` is called on the ActivityManager `yield` event (SyncCommand uses it to stop after the down-sync).
- `allowedAppIds` is documented but **not enforced** by mojoservice (no check in `controller_command.js`).

### Jail

On 3.0.5, `run-js-service` jails third-party services (`thirdparty_jail=individual`) with `/usr/bin/jailer -t triton-inst -i <service> -p <path>`. `com.palm.*` services are not jailed (`palm_jail=off`). The jail is assembled from `/etc/jail_triton-inst.conf` under `/var/palm/jail`: read-only mounts of `/usr/palm/frameworks`, `/usr/palm/public` ("for accounts data"), `/etc/palm`; read-write `/media/internal`, `/var/file-cache`, `/tmp`. The jailer source is not available (the `jailer-legacy` reconstruction stubs `mountappdir`), so how the app directory gets into the jail was not verified. **LuneOS ships `jail=off`** (`[LuneOS] /usr/bin/run-js-service`).

### Foundations bits used by Synergy

`Foundations.Control.Future` / `mapReduce`, `Foundations.Comms.PalmCall` / `AjaxCall`, `Foundations.Data.DB` and `TempDB` (`get, put, find(query, watch, count), del(idsOrQuery, purge), merge(objectsOrQuery, props), reserveIds, putKind, delKind`), `Foundations.Control.Activity` (fluent `setTrigger/setScheduleInterval/setRequirements/setCallback/setExplicit/setPersist/setReplace/setUserInitiated/setMetadata`, then `start()`, which calls activitymanager `create` with `start:true`; `complete(restart)`), and `Foundations.Control.FSM`. See `webos://knowledge/js-services` for Futures.

---

## The Transport and Sync Libraries

### mojoservice.transport: clients and the command queue

`Transport.ServiceAssistantBuilder({clientId: "accountId", client: <ClientClass>, setup?})` builds the service assistant (`[305] frameworks/mojoservice.transport/submission/39/javascript/services/serviceassistantbuilder.js`):

- `runCommand` picks a **client per `args[clientId]`** (per account). If the client does not exist yet, or has no `credentials` and the command does not set `requiresAuthentication:false`, it builds a new one and calls `client.setup(service, id, commandConfig, args)`.
- If setup throws a `Transport.TransportError`, the account's syncstate is cleared and set to `ERROR` with that error code.
- The command is pushed into the client's queue. The `Client` is an FSM (`client.js`): `runCommand` offers the command to the current state's handler named after the command (or `__any`), and queues it otherwise.
- If the client has `getCapabilityProviderId()`, a `SyncStatusManager(accountId, capabilityProviderId, serviceName)` is attached.

Error classes (`errors.js`): `AuthenticationError 401_UNAUTHORIZED`, `BadRequestError`, `DuplicateError`, `NoConnectivityError`, `ServerError`, `TimeoutError 408_TIMEOUT`, `UnavailableError`, `NoCredentialsError CREDENTIALS_NOT_FOUND`, `CommandTimeoutError`, `TimestampRefusedError`.

### SyncStatusManager → `com.palm.account.syncstate:1` (tempdb)

Each row is `{accountId, capabilityProvider, collectionId?, busAddress, syncState, errorCode?, errorText?, metadata?}`. `syncState` is one of `IDLE | PUSH | INITIAL_SYNC | INCREMENTAL_SYNC | DELETE | ERROR` (`syncstatusmanager.js`). Any caller may write (`tempdb/permissions/.../com.palm.account.syncstate`). The accounts service deletes an account's rows on credential change and on delete.

### mojoservice.transport.sync: the generic two-way sync engine

Exports used by real services: `Sync.AuthSyncClient`, `Sync.SyncHandler(kinds)`, `Sync.SyncCommand`, and ready-made command assistants: `Sync.CreateAccountCommand` (for onCreate), `Sync.EnabledAccountCommand` (onEnabled), `Sync.DeleteAccountCommand` (onDelete), `Sync.CredentialsChangedCommand`, plus a refetch-photo command. The stock Google calendar service wires them like this (`[305] services/com.palm.service.calendar.google/javascript/`):

```javascript
var Kinds = {
  objects: {
    calendar:      {name:"calendar",      id:"com.palm.calendar.google:1",      metadata_id:"com.palm.calendar.transport.google:1"},
    calendarevent: {name:"calendarevent", id:"com.palm.calendarevent.google:1", metadata_id:"com.palm.calendarevent.transport.google:1"}
  },
  account: {id:"com.palm.account:1", metadata_id:"com.palm.account.calendar.google:1"}  // transport record kind
};
Kinds.syncOrder = ["calendar", "calendarevent"];

var ServiceAssistant = Transport.ServiceAssistantBuilder({
  clientId: "accountId",
  client: Class.create(Sync.AuthSyncClient, {
    getCapabilityProviderId: function () { return "com.palm.google.calendar"; },
    getSyncInterval:         function () { return new Future("20m"); },
    requiresInternet:        function () { return true; },
    setup: function (service, accountId, launchConfig, launchArgs) {
      // ... readCredentials {accountId, name:"calendar"} ...
      this.$super(setup)(service, accountId, undefined,
                         Transport.HandlerFactoryBuilder(Sync.SyncHandler(Kinds)));
    }
  })
});
var OnCreateAssistant  = Sync.CreateAccountCommand;
var OnEnabledAssistant = Sync.EnabledAccountCommand;
var OnDeleteAssistant  = Sync.DeleteAccountCommand;
var SyncAssistant      = Class.create(Sync.SyncCommand, { /* getRemoteChanges, ... */ });
```

**The transport record** (`kinds.account.metadata_id`) holds `{accountId, modnum, syncKey, extras, initialSync}` (`handlers/synchandler.js`):

| Command | What it does to the transport record and the data |
|---|---|
| `CreateAccountCommand` | `put {accountId, modnum:0, syncKey:{}, extras:{}, initialSync:true}` |
| `EnabledAccountCommand` (enabled) | Starts the persistent activity **`Periodic Sync:<service>:<accountId>`** (interval from `getSyncInterval`, default `24h`; requirements `{internetConfidence:"fair"}` if `requiresInternet`, which defaults to true). Then `enableAccount` (creates the transport record if missing, sets `modnum` to the current db `_rev`). If `modnum` was 0, starts `Initial Sync:<service>:<accountId>`. Both call back `palm://<service>/sync {accountId}`. `commandTimeout 3600` |
| `EnabledAccountCommand` (disabled) | Returns `BUSY` if a sync is running. Otherwise cancels `Periodic Sync:` and `SyncOnEdit:`, then `disableAccount`: **merges `{_del:true, preventSync:true}` into every object of every `syncOrder` kind for the account** and resets the transport record (`modnum 0, syncKey {}, extras {}`) |
| `DeleteAccountCommand` | syncstate `DELETE` → deletes the transport record only → clears the syncstate |
| `CredentialsChangedCommand` | `enableAccount`, reload the transport record, start `Sync on credentials changed:<service>:<accountId>` (calls `sync`), clear syncstate |

**The callback command name `sync` is hard-coded** in `EnabledAccountCommand` and `CredentialsChangedCommand`, so the SyncCommand must be registered as `sync` in `services.json`.

### `AuthSyncClient` states (`clients/authsyncclient.js`)

`__start → restart` (load the transport record) `→ unauthorized`. In `unauthorized`, if the client has `getAuthenticateCommandDescription()`, an `authenticate` command runs first (`inAuthorize`); otherwise the client goes straight to `authorized`. In `authorized`, one command runs at a time (`waitForComplete`). After `onCreate`/`onEnabled` the client returns to `restart`, so the transport record is re-read. A command that ends in an exception also returns to `restart`.

### A sync cycle

```
ActivityManager        <service> (mojoservice)                 SyncCommand FSM                     remote        db8
 | "Periodic Sync:<svc>:<acct>" fires
 |-- palm://<svc>/sync {accountId, $activity} -->|
 |<-- {returnValue:true} (adopted) ---------------|
 |                     | client(accountId).setup -> AuthSyncClient -> authorized -> run SyncCommand
 |                     | run(): getAccountInfo -> provider enabled?  no -> disableAccount + cancel activities, stop
 |                     |        _syncInProgress[acct]? -> "sync already in progress", stop
 |                     |        trigger.returnValue === false -> error reply
 |                     |  __start: clear syncstate; set INITIAL_SYNC | INCREMENTAL_SYNC
 |   for kind in getSyncOrder():
 |                     |  getTransformer("remote2local"/"local2remote")   (no remote2local -> skip kind)
 |                     |  getRemoteChanges(state "first"|"more", kind) ------------->|  -> {more, entries}
 |                     |  getRemoteId(entry) -> handler.getObjectsByRid ---------------------------> find accountId+remoteId
 |                     |  isDeleted ? delete : transformer(local, remote) changed ? save
 |                     |  preSaveModify -> putObjects (reserveIds, del, put) ------------------------> db8
 |                     |  loop while more
 |                     |  [local2remote] checkpointDownSync: save syncKey on transport record
 |                     |     getLocalChanges: find accountId + _rev > modnum (incDel); skip own writes,
 |                     |       server deletes and preventSync; modnum = max _rev
 |                     |     getRemoteMatches(rids) / getNewRemoteObject -> local2remote transform
 |                     |     putRemoteObjects([one change]) ------------------------------>|  -> [remoteId]
 |                     |     putTransportObjects (store remoteId) -> postPutRemoteModify ----------> db8
 |                     |  nextType
 |                     |  updateAccount: {initialSync:false, syncKey}
 |                     |  success: upsynced something? rerun (max 2x) ; clear syncstate; reply {}
 |                     |  error:   clear syncstate; TransportError -> syncstate ERROR {errorCode,errorText}
 |<-- complete(restart: activity is the periodic one) --|
 |   + "SyncOnEdit:<svc>:<acct>" trigger db/watch {from: kind, accountId, _rev > modnum} (only if local2remote)
 |   + "SyncRetry:<svc>:<acct>" if error message contains "httpRequest error"
 |       (getMaxSyncRetries() default 3, getSyncRetryInterval() default "5m", count kept in activity metadata)
```

Methods a `SyncCommand` subclass provides (`commands/synccommand.js`; every default throws): `getSyncOrder()`, `getSyncObjects()`, `getTransformer(direction, kindName)` (returns `function(to, from)`, which returns something truthy if `to` changed; returning no `local2remote` makes the sync read-only), `getRemoteId(obj, kindName)`, `isDeleted(obj, kindName)`, `getRemoteChanges(state, kindName)` (returns a Future of `{more, entries}`), `getRemoteMatches(remoteIds, kindName)`, `putRemoteObjects(objects, kindName)` (returns a Future of a remoteId array; `objects[i].operation` is `save`/`delete`), `getNewRemoteObject(kindName)`, and `updateLocalTransportRevision(...)` (used when a `putTransportObjects` hits db8 error `-3961`, a revision mismatch). Optional: `getCapabilityProviderId`, `preSaveModify`, `postPutRemoteModify`, `getMaxSyncRetries`, `getSyncRetryInterval`. `SyncCommand.commandTimeout` is 3600 s.

How progress is tracked: **down-sync** progress is whatever the transport keeps in `this.client.transport.syncKey`, which it is free to shape. **Up-sync** progress is `modnum`, the highest local `_rev` already examined. Local records are matched by `accountId` + `remoteId` and need indexes on those fields.

---

## How Data Reaches the Stock Apps

Each stock app owns a parent kind. A transport defines a **sub-kind** with `"extends": ["<parent>"]`. A db8 write to the sub-kind also updates the parent's indexes (`db8/src/db/MojDbKind.cpp`, `updateIndexes` across `m_supers`), so an app that queries the parent kind sees every account's records without knowing the sub-kinds. The apps use the template's `dbkinds` only to decide where to **write**.

| Parent kind | Owner (kind file) | Notes |
|---|---|---|
| `com.palm.contact:1` | `com.palm.app.contacts` | The linker merges contacts into `com.palm.person:1` (owner `com.palm.service.contacts.linker`) |
| `com.palm.calendar:1`, `com.palm.calendarevent:1` | `com.palm.app.calendar` (`core-apps/com.palm.app.calendar/configuration/db/kinds/`) | |
| `com.palm.email:1`, `com.palm.folder:1`, `com.palm.mail.account:1` | `com.palm.app.email` | IMAP/POP sub-kinds `com.palm.imap.email:1` etc. (`[305] /etc/palm/db_kinds/`) |
| `com.palm.task:1` | `com.palm.app.tasks` | |
| `com.palm.message:1` | `com.palm.app.messaging`, extends `com.palm.communication:1` (definition of that kind not found) | Indexes on `conversations`, `folder`, `flags.visible`, `localTimestamp`, `_rev` |
| `com.palm.immessage:1` | `com.palm.app.messaging`, extends `com.palm.message:1` | `com.palm.smsmessage:1` (owner `com.palm.smsservice`) also extends `com.palm.message:1` |
| `com.palm.chatthread:1` | `com.palm.messaging.chatthreader` | `personId`, `normalizedAddress`, `flags.visible`, `timestamp`, `unreadCount` |
| `com.palm.imcommand:1`, `com.palm.imloginstate:1` | `com.palm.app.messaging` | |
| `com.palm.imbuddystatus:1` (**tempdb**) | `com.palm.app.messaging` | Presence, not persisted |

### Chat threading (`[305] services/com.palm.messaging.chatthreader/`)

The chat threader is a persistent ActivityManager activity, `chatThreader.nullConversation`, with a trigger on `palm://com.palm.db/watch` for `from com.palm.message:1 where conversations = null, flags.visible = true, _rev > <rev>`. It calls `newMessages {revision}`. For each address on the message (`Messaging.Message.getAddressesForThreading`) it does a contacts reverse lookup: `Person.findByPhone` for `com.palm.smsmessage`/`mmsmessage`, `Person.findByIM(addr, serviceName)` otherwise, and none for group chats. Then `Conversations.findOrCreate(person, message, address)` and finally it writes `message.conversations = [threadId]`. `complete()` re-arms the activity with `restart:true` and the new high-water `_rev`. Other watches handle deleted messages, read-flag changes, buddy availability (tempdb watch on `com.palm.imbuddystatus:1`) and group chats.

### IM transport model (`imlibpurpleservice@8812bdf`)

| Record | Who writes it | Who reacts |
|---|---|---|
| `imloginstate` sub-kind `{accountId, serviceName, username, state, availability}` | Transport `onEnabled(true)` creates it (`state:"offline"`, `availability:0` = online, so the account signs in automatically). The Messaging UI changes `availability` | Transport activity *"Libpurple loginstate"*: db watch `_rev > 0` → `loginStateChanged`. `state` is one of `offline / logging-on / retrieving-buddies / online / logging-off`. `availability` is one of `0 online, 1 mobile, 2 idle/busy, 3 invisible, 4 offline, 5 pending, 6 no presence` (`inc/PalmImCommon.h`) |
| `immessage` sub-kind with `folder:"outbox", status:"pending"` | **Messaging app** (`ComposeView.sendMessageHelper` puts it into `dbkinds.immessage`) | Transport activity *"IM Service pending messages watch"* (db watch → `palm://com.palm.imlibpurple/sendIM`), which sends it and updates `status` |
| `imcommand` sub-kind `{command, handler:"transport", status:"pending", ...}` | Messaging app (`getImCommandKind` → `dbkinds.imcommand`, default `com.palm.imcommand:1`) | Transport watch → `sendCommand` |
| incoming `immessage` (`folder:"inbox"`) | Transport | Chat threader (above) |
| `imbuddystatus` sub-kind (tempdb) | Transport | Chat threader, Messaging buddy list |

`onEnabled(false)` in imlibpurple deletes the loginstate, messages, commands, contacts and buddy status for that account (`src/OnEnabledHandler.cpp`). **Nothing in the stock flow calls a template-level `sendIM`.** In the 3.0.5 sources, `sendIM` is only the activity callback name inside imlibpurple.

### C++ transports use the same contract

A C++ transport is just another bus service whose method names appear in the template. 3.0.5 `com.palm.imap` registers `validateAccount`, `accountCreated`, `accountEnabled`, `accountDeleted`, `accountUpdated`, `credentialsChanged`, `syncAccount`, `syncFolder`, ... (`mojomail/imap/src/ImapBusDispatcher.cpp`), and the Google template maps `onCreate → palm://com.palm.imap/accountCreated` and so on. The flow is the same as for JS services: read `accountId`/`enabled`/`config` from the payload, call `getAccountInfo` / `readCredentials {name:"common"}`, and reply `returnValue:true`. The validator returns `credentials:{common:{password}}` (`ImapValidator.cpp`). `mojomail/eas` is a LuneOS rewrite of the closed-source EAS transport (`mojomail/eas/README.md`).

---

## ActivityManager's Role

- **Keeping services alive**: every mojoservice command holds an Activity, adopted when ActivityManager launched the call, otherwise created. The process exits `activityTimeout` seconds after the last one completes.
- **Periodic sync**: `Periodic Sync:<svc>:<acct>` is persistent, has `replace:true` and a schedule interval, and is completed with `restart:true` after each run.
- **Change-driven sync**: `SyncOnEdit:<svc>:<acct>` is a `palm://com.palm.db/watch` trigger on `_rev > modnum`. The IM outbox, commands and loginstate work the same way, as does the chat threader. The stock files live in `/etc/palm/activities/<owner>/` (e.g. `imlibpurpleservice@8812bdf: files/etc/palm/activities/com.palm.imlibpurple/`).
- A triggered callback receives `args.$activity = {activityId, trigger:{fired, returnValue}, metadata?}`. `SyncCommand` refuses to run when `trigger.returnValue === false` (a broken watch).

See `webos://knowledge/activity-manager`.

---

## LuneOS Differences

| Area | webOS 3.0.5 | LuneOS (from code) |
|---|---|---|
| Framework install path | `/usr/palm/frameworks/<lib>/submission/<n>/` | `/usr/palm/frameworks/<lib>/version/1.0/` (`meta-webos-ports: recipes-webos-owo/frameworks/mojoservice-frameworks.bb`) |
| Private-bus senders | `com.palm.*` or `privatebus:true` | also `com.webos.*` and `org.webosports.*` (`[LuneOS] .../mojoservice/version/1.0/javascript/controller_service.js`) |
| JS jail | third-party services jailed | `jail=off` in `run-js-service`. Also accepts `/media/developer/*` service paths (roles in `/var/palm/ls2-dev`) |
| Bus security | `palm_bus_config.json` (`privateBusAccess`) + `/usr/share/ls2` roles | LS2 ACG files per service: `*.role.json`, `*.api.json` (method → group), `*.perm.json` (groups the service may call), `*.groups.json`, plus a D-Bus style `.service` (`app-services/com.palm.service.accounts/files/sysbus/`) |
| Accounts service outbound calls | unrestricted | `com.palm.service.accounts.perm.json` lists each callable group: `imlibpurple-service.operation`, `mojomail-imap/pop/smtp.operation`, `keymanager-service.operation`, `cdav-service.operation`, ... **A new transport's callback group must be added there** (as commit `4d6539c` did for CardDAV/CalDAV) |
| `com.palm.account:1` read permission | `com.palm.*` + QuickOffice | also `com.webos.*` and `org.webosports.*` |
| Delete | — | `keepData` (+ `alias`, `templateId`) forwarded to `onDelete` |
| Profile account | created by first use | `createLocalAccount` creates `com.palm.palmprofile` with username `"LuneOS"` when first use was skipped (upstart `createLocalAccount.conf`, sentinel `/var/luna/preferences/ran-firstuse`) |
| App ids | `com.palm.app.messaging` etc. | `org.webosports.app.messaging` etc. These ids must appear in template `readPermissions`/`writePermissions` |
| IM templates | `onEnabled` only | also `onCreate`/`onDelete` and `prpl` (`messaging-accounts`, `[LuneOS] /usr/palm/public/accounts/`) |
| Keymanager | proprietary | JS reimplementation, keys namespaced per caller appId |

> **On webOS CE 3.1.0:** the `com.palm.account:1` read-permission and Delete (`keepData`) rows behave like the LuneOS column, and `createLocalAccount` exists but isn't wired to first use. Every other row is unchanged from 3.0.5.

---

## Gotchas

- **`onCapabilitiesChanged` belongs at the template's top level.** The accounts service reads `template.onCapabilitiesChanged`/`annotated.onCapabilitiesChanged` and never a provider's. Placing it inside `capabilityProviders[]` means it is never called. `onCredentialsChanged` works in both places.
- **No `validator` means no "Add account" entry.** The Enyo library filters out templates without a validator, as well as `hidden` ones.
- **One failing `onCreate` blocks every `onEnabled`**, and one failing `onEnabled(false)`/`onDelete` leaves the account half-deleted until the 5-try retry loop in `stayRunning`. Always reply `returnValue:true` unless the account really is unusable.
- **`config` is delivered once**, to `onCreate`. It is not on the account record, and `modifyAccount` ignores `object.config`.
- **`onCreate` only reaches providers enabled at creation.** Handle a missing per-account state in `onEnabled(true)`, as `SyncHandler.enableAccount` does.
- **The Sync library's sync command must be called `sync`.** The activities it creates call back `palm://<service>/sync`.
- **Content is wiped on *disable*, not on delete.** `disableAccount` soft-deletes every `syncOrder` kind (`_del:true, preventSync:true`). `onDelete` only removes the transport record.
- **Enable/disable is detected through the `_id` db8 adds to array elements.** Code that builds `capabilityProviders` by hand (without a db8 round-trip) has no `_id`, and the client libraries treat it as disabled.
- **Templates are cached.** Only adding or removing a template (`appsChanged`) or a locale change makes the service re-read them. Edits to an existing template's content need the accounts service restarted.
- **`activityTimeout` defaults to 5 s, not 60.** A service that starts background work outside a command must hold its own Activity or it will be killed.
- **The modify loop shares one params object** across all added (or all removed) providers (`mapAddRemoveToBusCalls`), so when several capabilities are toggled in one call, every `onEnabled` receives the last `capabilityProviderId`. Key on your service's own provider id rather than trusting that field.
- **Outgoing IMs are not pushed to you.** The Messaging app writes a pending outbox record into your `dbkinds.immessage` sub-kind. Your service must watch for it.
- **`allowedAppIds` in `services.json` is decorative.** mojoservice never checks it.

---

## Not Found in Available Sources

- Definition and owner of `com.palm.communication:1`.
- A 3.0.5 app consuming `MEMOS`, `TASKS` or `REMOTECONTACTS` accounts at runtime.
- The internals of the original (proprietary) keymanager and jailer, e.g. whether jailed service code is copied or bind-mounted.
- How the 3.0.5 installer places an app's `accounts/` directory under `/media/cryptofs/apps/usr/palm/accounts/` (only the scan side was read).

---

## See Also

- `webos://knowledge/synergy-architecture`: one-page overview of the whole Synergy system; start here
- `webos://knowledge/synergy-messaging-connectors`: libpurple-based IM connectors (Messaging + Phone apps)
- `webos://knowledge/synergy-cloud-connectors`: cloud/file connectors (DOCUMENTS / PHOTO.UPLOAD)
- `webos://knowledge/synergy-music-connectors`: streaming music providers ("Music" account type)
- `webos://knowledge/synergy` — writing a third-party Synergy service (template skeleton, keymanager, debugging)
- `webos://knowledge/js-services` — Futures, `services.json`, service structure
- `webos://knowledge/db8` — kinds, `extends`, indexes, watches
- `webos://knowledge/activity-manager` — activities, triggers, `complete`/`restart`
- `webos://knowledge/ls2-roles` — LuneOS role/ACG files
