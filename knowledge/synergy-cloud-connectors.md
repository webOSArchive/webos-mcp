# Cloud & File Synergy Connectors (webos-synergy-revival)

How the `webos-synergy-revival` project brings **DOCUMENTS** (file browse / open / save-back) and **PHOTO.UPLOAD** (Photos-app source) Synergy accounts back to the HP TouchPad (webOS 3.0.5) for Dropbox, Box, OneDrive, Google Drive, pCloud, Yandex Disk, kDrive, MEGA, Koofr, HiDrive, S3-compatible storage and Flickr. All of them talk to 2026 cloud APIs from a 2011 device.

This page covers the **cloud/file family** only: the shared `_cloudcore` runtime, the account templates, the sign-in flows, the QuickOffice and Photos integration, packaging, and how to add a connector. For the general Synergy basics (templates, db8 sub-kinds, Futures, keymanager, Activity Manager) see `webos://knowledge/synergy`. For the community OAuth broker see `webos://knowledge/oauth`. For the TLS 1.3 update and the curl shell-out pattern see `webos://knowledge/tls-and-networking`.

Paths below are relative to the `webos-synergy-revival` repo root unless stated otherwise.

> **Source of truth is the code.** Several per-connector READMEs predate the move to `_cloudcore`. They describe files that are gone (`boxapi.js`, `driveapi.js`, `yandexapi.js`, per-provider `*-auth`/`*-files` apps) or an older status. `cloud/<x>/service/*/sources.json` shows what a service actually loads. See [Doc drift](#doc-drift-to-be-aware-of).

---

## 1. The Transport Reality (Why It Is Built This Way)

| Layer | What the device has | Consequence |
|---|---|---|
| Node services | `/usr/palm/nodejs/node`, **node 0.4.12**, linked to **OpenSSL 0.9.8k** (`README.md`, `cloud/mega/service/com.palm.service.mega/megacrypto.js`) | Cannot do a TLS 1.2/1.3 handshake. No modern HTTPS from node, so `Foundations.Comms.AjaxCall` is useless for cloud APIs. |
| Stock webview | WebKit ~2009 | Cannot render or reach modern OAuth login pages. |
| System curl | `/usr/bin/curl` 7.88.1 / OpenSSL 1.1.1w, from the companion **OpenSSL-11 update** | **Every** token, API and file call shells out to it. |
| CA store | `/etc/ssl/certs/ca-certificates.crt`. The stock copy is a 2011 stub with no ISRG Root X1. | A current bundle is a deployment prerequisite (`docs/ARCHITECTURE.md` §1). |
| Atlas | `org.webosports.app.atlas`, a WPE browser with modern TLS | Hosts the OAuth login pages. |

Design rules that follow from this (`README.md` "The transport reality", `docs/ARCHITECTURE.md`):

1. **JS is orchestration only. curl does all the TLS.** `_cloudcore/httpcurl.js` runs `child_process.execFile(Config.CURL, args)`. The old private bundle at `/var/dropbox-tls/` (curl plus libs, `LD_LIBRARY_PATH`) is retired. `CURL_LD_LIBRARY_PATH` is still honoured but every config sets it to `""`.
2. **OAuth login pages render in Atlas, never in the stock webview.** On legacy webOS the page is embedded inline (an `enyo.BasicWebView` whose plugin mime type is swapped to `application/x-atlas-browser`). On LuneOS, which has no NPAPI, it opens in a `window.open()` WAM window (`cloud/cloudcore/auth/com.palm.app.cloud-auth/source/oauthWindow.js`).
3. **Use public clients with PKCE where the provider allows it.** With no `client_secret`, one identical package can ship to every device. Dropbox and OneDrive are pure PKCE. Box runs PKCE and takes a secret only if one is configured. Google, pCloud, HiDrive, Yandex and Koofr need a shipped secret. kDrive, MEGA and S3 avoid OAuth altogether.
4. **Crypto that must run locally uses node core `crypto`**: SHA-256 for the PKCE S256 challenge, HMAC-SHA256 for SigV4, HMAC-SHA1 for OAuth 1.0a, and AES-ECB/HMAC-SHA512 for MEGA. Each has 0.4.12-specific workarounds ([Gotchas](#gotchas)).

> Contrast with `webos://knowledge/oauth`: the community broker exists because a stock device can neither reach the token endpoint nor render the consent page. synergy-revival instead **requires** the OpenSSL-11 update (modern curl) **and** Atlas on the device, then does OAuth on-device. Without those prerequisites it cannot work. The broker needs neither.

---

## 2. Capabilities: DOCUMENTS and PHOTO.UPLOAD

### What the stock apps expected (and why that was dead)

The stock `com.palm.dropbox` template (stock rootfs `/usr/palm/public/accounts/com.palm.dropbox/`) had a bare `validator: "palm://com.palm.service.dropbox/checkCredentials"` and a `DOCUMENTS` capability with **no** `implementation`. Its service had a single `checkCredentials` command plus `keys/…api_key`/`api_secret`. The stock connectors only **validated credentials**. QuickOffice did the real file I/O through its own proxy `g1.quickofficeconnect.com` (the proprietary "MX" API, now decommissioned) and `com.palm.downloadmanager` (OpenSSL 0.9.8) (`quickoffice-integration/README.md`, `docs/ARCHITECTURE.md` §7).

The stock Photos aggregator `com.palm.service.photos` discovers `PHOTO.UPLOAD` accounts. It maps `templateId → serviceName` in `photos-src/base/Utils.js` (stock cases only for facebook/photobucket/snapfish), calls `listAlbums`/`listPhotos` on that service, and downloads every photo to local storage itself. Stock provider services such as `com.palm.service.photos.facebook` expose `upload`, `listAlbums`, `listPhotos`, `getPhotoComments`, … (stock `services.json`).

### Service methods a revived connector implements

Lifted from `cloud/cloudcore/service/_cloudcore/commands/*.js` and the per-connector `commands/`. Every reply carries `returnValue`. Errors are exceptions shaped `{returnValue:false, errorCode, …}`.

| Method | Caller | Args | Returns | ACL |
|---|---|---|---|---|
| `getAuthorizeUrl` | auth app | `{state?}` | `{url, codeVerifier}` | `Config.AUTH_APP_IDS` (declared; command does not call `Acl.enforce`) |
| `exchangeCode` | auth app → template `validator.address` | `{code, codeVerifier, hostname?, locationid?}` | `{username, alias?, credentials:{common:{accessToken, refreshToken, expiresAt}}}` | open |
| `checkCredentials` | Accounts (`onCredentialsChanged`) | `{credentials:{common}}` | `{renewedCredentials, username, displayName}` | open |
| `listFolder` | QuickOffice, file apps | `{accountId \| credentials, folderId \| path}` | `{entries:[{id,type:'folder'\|'file',name,size,modified,path,mimeType?,googleDoc?}], renewedCredentials}` | `Config.FILE_APP_IDS` |
| `downloadFile` | QuickOffice, file apps | `{accountId \| credentials, fileId \| path \| dropboxPath, localPath, exportMime?}` | `{path, renewedCredentials}` | `FILE_APP_IDS` |
| `uploadFile` | QuickOffice, file apps | new: `{…, folderId \| path, localPath, name?, mimeType?}`; overwrite: `{…, fileId \| path \| dropboxPath, localPath, replace:true}` | `{name, id, size, renewedCredentials}` | `FILE_APP_IDS` |
| `listAlbums` | Photos aggregator | `{accountId}` | `{albums:[{aid, name, size:{images:N}}]}` | **open** (aggregator has no bus identity) |
| `listPhotos` | Photos aggregator | `{accountId, aid}` | `{photos:[{pid, src_big, src_small, caption, type:"image", fileName}]}` | open |
| `upload` | Photos aggregator (`AlbumManageAssistant.uploadPhotoToCloud`) | `{accountId, albumId, path}` | `{pid, name, size}` | open |
| `deletePhoto` | patched aggregator `removePhoto()` | `{accountId, pid}` | `{pid}` | open |
| `login` (MEGA, S3) | own auth app | MEGA `{email, password, mfa?}`; S3 `{endpoint, region, bucket, accessKeyId, secretAccessKey, pathStyle}` | same shape as `exchangeCode` | open |
| `verifyToken` (kDrive) | kdrive-auth | `{token}` | same shape, `common:{accessToken, accountId, driveId, rootFolderId}` | open |

Timeouts (`services.json`): the service default is `commandTimeout: 30`. Photo commands use 300, and the MEGA, Koofr and S3 file commands use 120–300. Every cloud `services.json` names `"assistant": "CloudService"` (Flickr uses its own).

**Locators are opaque to consumers.** `entry.path` is whatever the provider uses: a real path (Dropbox, Yandex `disk:/…`, HiDrive, Koofr, S3 prefix) or an id (Box, OneDrive, Drive, pCloud, kDrive, MEGA handle). The consumer hands it straight back as the next `folderId`/`fileId` (`listFolder_command.js` header). kDrive **stringifies numeric ids**, because QuickOffice calls `.replace()` on the locator (`cloud/kdrive/README.md`).

### A real account template (Dropbox, trimmed)

`cloud/dropbox/account/com.palm.dropbox/com.palm.dropbox.json`. The same JSON is mirrored in `resources/{de,en,en/ca,es,fr,fr/ca,it}/` because locale files override the base:

```json
{
  "templateId": "com.palm.dropbox",
  "loc_name": "Dropbox",
  "loc_usernameLabel": "EMAIL ADDRESS",
  "icon": { "loc_32x32": "images/dropbox-32x32.png", "loc_48x48": "images/dropbox-48x48.png" },
  "validator": {
    "customUI": { "appId": "com.palm.app.cloud-auth", "name": "oauth.html" },
    "address":  "palm://com.palm.service.dropbox/exchangeCode"
  },
  "onCredentialsChanged": "palm://com.palm.service.dropbox/checkCredentials",
  "readPermissions":  ["com.palm.app.cloud-auth", "com.palm.app.photos",
                       "com.palm.service.dropbox", "com.palm.service.photos", "..."],
  "writePermissions": ["com.palm.app.cloud-auth", "com.palm.app.photos",
                       "com.palm.service.dropbox", "com.palm.service.photos", "..."],
  "capabilityProviders": [
    { "capability": "DOCUMENTS", "id": "com.palm.dropbox.documents",
      "implementation": "palm://com.palm.service.dropbox/" },
    { "capability": "PHOTO.UPLOAD", "id": "com.palm.dropbox.photos",
      "implementation": "palm://com.palm.service.photos",
      "onEnabled": "palm://com.palm.service.photos/onEnabled",
      "onDelete": "palm://com.palm.service.photos/onDelete",
      "onCredentialsChanged": "palm://com.palm.service.photos/onCredentialsChanged" }
  ]
}
```

Rules encoded in that template (its `__comment*` keys and `docs/ARCHITECTURE.md` §3–4):

- **The auth app must be in read+writePermissions.** `createAccount` runs under the customUI app's identity and is permission-checked (`accounts/handlers/create.js → Utils.hasPermission`).
- **The connector service must be in read+writePermissions** so it can `readCredentials`/`writeCredentials` by `accountId`.
- **The DOCUMENTS `implementation`** must be `palm://com.palm.service.<x>/`. QuickOffice routing keys on that prefix (§6).
- **The PHOTO.UPLOAD `implementation`** points at the **aggregator** `com.palm.service.photos`, not at the connector.
- OneDrive and kDrive also list `com.quickoffice.webos`/`com.quickoffice.ar` in `readPermissions`.
- Some templates still list `com.palm.app.<x>-files` apps that this repo no longer ships. That is residue from the pre-cloudcore layout, which survives in the older copy `~/webos/touchpad-kernel/doctor305/synergy-revival/applications/`.

---

## 3. The `_cloudcore` Runtime

```
/usr/palm/services/
  _cloudcore/                      shared, byte-identical, shipped by com.palm.synergy.generic
    cloudservice.js  oauth2.js  httpcurl.js  creds.js  acl.js
    commands/  getAuthorizeUrl  exchangeCode  checkCredentials  listFolder
               uploadFile  downloadFile  uploadPhoto(=upload)  deletePhoto
  com.palm.service.dropbox/        one dir per connector, shipped by com.palm.synergy.<x>
    config.js  adapter.js  services.json  sources.json  palm_bus_config.json
    commands/  photolib.js  listAlbums_command.js  listPhotos_command.js
```

A connector's `sources.json` pulls the core in by **relative path**, so `_cloudcore/` must be a sibling of every `com.palm.service.<x>/`. Load order matters, because each file uses globals defined by earlier ones (`cloud/dropbox/service/com.palm.service.dropbox/sources.json`):

```json
[
  { "library": { "name": "foundations",     "version": "1.0" } },
  { "library": { "name": "foundations.xml", "version": "1.0" } },
  { "library": { "name": "mojoservice",     "version": "1.0" } },
  { "library": { "name": "globalization",   "version": "1.0" } },
  { "source": "./config.js" },
  { "source": "../_cloudcore/acl.js" },
  { "source": "../_cloudcore/httpcurl.js" },
  { "source": "../_cloudcore/oauth2.js" },
  { "source": "./adapter.js" },
  { "source": "../_cloudcore/creds.js" },
  { "source": "../_cloudcore/cloudservice.js" },
  { "source": "../_cloudcore/commands/getAuthorizeUrl_command.js" },
  { "source": "../_cloudcore/commands/exchangeCode_command.js" },
  { "source": "../_cloudcore/commands/checkCredentials_command.js" },
  { "source": "../_cloudcore/commands/listFolder_command.js" },
  { "source": "../_cloudcore/commands/uploadFile_command.js" },
  { "source": "../_cloudcore/commands/downloadFile_command.js" },
  { "source": "../_cloudcore/commands/uploadPhoto_command.js" },
  { "source": "../_cloudcore/commands/deletePhoto_command.js" },
  { "source": "commands/photolib.js" },
  { "source": "commands/listAlbums_command.js" },
  { "source": "commands/listPhotos_command.js" }
]
```

Variants: a connector **swaps or omits** core files instead of patching them.
- pCloud uses a local `oauth2.js` plus local `getAuthorizeUrl`/`exchangeCode`.
- kDrive drops `oauth2.js` and uses a local `verifyToken`.
- MEGA drops `oauth2.js` and adds `bignum.js`, `megacrypto.js`, `megaapi.js` and a local `login`.
- S3 adds `s3sig.js`, `s3xml.js` and a local `login`.
- Google Drive omits every photo command.

### `cloudservice.js`

This is a 20-line no-op assistant (`CloudService.prototype.setup` logs `Config.SERVICE_NAME`). `services.json` names it as the service `assistant`. All behaviour lives in the commands, `config.js` and `adapter.js`.

### `config.js`: the `Config` global

Fields read by the core (union over `cloud/*/service/*/config.js`):

| Field | Used by | Notes |
|---|---|---|
| `CURL`, `CURL_LD_LIBRARY_PATH`, `CURL_CAINFO` | httpcurl | `"/usr/bin/curl"`, `""`, `"/etc/ssl/certs/ca-certificates.crt"` everywhere |
| `CLIENT_ID`, `CLIENT_SECRET` | oauth2 | A secret starting `PLACEHOLDER` counts as **absent**, giving pure PKCE (`_hasSecret()`) |
| `REDIRECT_URI` | oauth2, cloud-auth | Pattern `http://localhost/<x>/oauth2callback` (HiDrive: `http://localhost:8888/hidrive/oauth2callback`) |
| `AUTHORIZE_URL`, `TOKEN_URL`, `SCOPE` | oauth2 | |
| `AUTHORIZE_EXTRA` | oauth2 | Appended verbatim: Dropbox `&token_access_type=offline`, Google `&access_type=offline&prompt=consent`, Yandex `&force_confirm=yes` |
| `TOKEN_SEND_SCOPE` | oauth2 | `true` only for OneDrive (Graph wants `scope` on the token/refresh calls) |
| `STATE` | getAuthorizeUrl | OAuth `state` default |
| `SERVICE_NAME`, `DISPLAY_NAME` | logs, `username` fallback | |
| `ROOT_FOLDER` | listFolder/uploadFile default | `""` Dropbox, `"0"` Box, `"root"` OneDrive/Drive/MEGA, `0` pCloud, `1` kDrive, `"disk:/"` Yandex, `"/"` Koofr, `"home"` HiDrive, `""` S3 |
| `AUTH_APP_IDS`, `FILE_APP_IDS` | command `allowedAppIds` | FILE apps are the QuickOffice ids `com.quickoffice.webos`, `com.quickoffice.ar`, plus a few legacy `*-files` ids |
| `PHOTO_ALBUM_NAME` | uploadPhoto via `Adapter.ensureAlbumFolder` | `"Pictures"` or `"Camera Uploads"` |
| Provider extras | adapter only | `API_BASE`, `CONTENT_BASE`, `UPLOAD_BASE`, `LIST_LIMIT`, `KOOFR_VERSION`, pCloud `hostForLocation()`/`sanitizeHost()`, S3 `PROVIDER_PRESETS` |

### The adapter interface (`var Adapter = {…}`)

Every core command calls these. All return a Foundations `Future`. `cb(newCreds)` is the **renewal callback**: the adapter calls it after a refresh, and the command persists the new credentials (`cloud/dropbox/service/com.palm.service.dropbox/adapter.js` header).

| Method | Required by | Contract |
|---|---|---|
| `getAccountInfo(creds, cb)` | exchangeCode, checkCredentials, login | → `{user:{emailAddress, displayName}}`. `emailAddress` becomes the account `username`. |
| `listFolder(creds, folderId, cb)` | listFolder | → `{entries:[{id, type, name, size, modified, path, …}]}`, **already normalised**. `modified` should be ISO-`Z` (QuickOffice's `File.parseUtcDate` only strips a trailing `Z`). |
| `downloadFile(creds, fileId, localDest, exportMime, cb)` | downloadFile | Streams to `localDest` → `{path}`. Only Google Drive honours `exportMime`. |
| `uploadFile(creds, folderId, localPath, name, mimeType, cb)` | uploadFile, upload | Creates a file → provider metadata with `id`, `name`, `size` |
| `uploadReplace(creds, fileId, localPath, mimeType, cb)` | uploadFile `replace:true` | Overwrites in place (QuickOffice save-back) |
| `deletePhoto(creds, pid, cb)` | deletePhoto | Optional. Without it the command returns `NOT_SUPPORTED`. |
| `ensureAlbumFolder(creds, name)` | upload with empty `albumId` | Optional. Find-or-create → folder id. |
| Photo helpers | the connector's own `listAlbums`/`listPhotos` | Free-form: `listFolderRaw` + `getTemporaryLink` (Dropbox), `listSpecialChildren` (OneDrive), `contentUrl` (Box), `getFileLink` (pCloud), `photoDownloadUrl`/`photoThumbUrl` (kDrive), `getTemporaryLink` (Yandex/HiDrive/Koofr/S3), `getPhotoLocalPath` (MEGA) |

Per-provider overwrite semantics for `uploadReplace` (`quickoffice-integration/README.md`):

| Provider | Overwrite method |
|---|---|
| Dropbox | `mode:"overwrite"` |
| Box | new version |
| OneDrive | PUT item content |
| Drive | PATCH content |
| pCloud | `checksumfile`, then same-name re-upload |
| Yandex | `overwrite=true` |
| kDrive | `conflict=version` |
| MEGA | uploads a new version into the same folder |

### `creds.js`: where tokens live

Consumers never hold tokens. They pass `accountId`, and `AccountCreds.resolve(args)`:

1. If `args.credentials.common.accessToken` is present, it uses that.
2. Otherwise it calls `palm://com.palm.service.accounts/readCredentials {accountId, name:"common"}`. It normalises the three reply shapes seen: the raw value, `{credentials:…}`, or nested `{common:…}`.
3. After a refresh, commands call `AccountCreds.save(accountId, renewed)`, which is `writeCredentials {accountId, name:"common", credentials}`.

So credentials are **not in a connector db8 kind**. They are the Accounts service's per-account credential store, written when `exchangeCode`/`login`/`verifyToken` returns `credentials:{common:{…}}`. `cloud/kdrive/README.md` reports the token "stored in keymanager under `common`", i.e. the Accounts service keeps it in keymanager. The connector never calls `com.palm.keymanager` directly, unlike the classic pattern in `webos://knowledge/synergy`. Whatever the provider needs goes into `common`:

| Connector | `credentials.common` |
|---|---|
| OAuth2 | `{accessToken, refreshToken, expiresAt}` |
| pCloud | `{accessToken, apiHost, locationid, uid}` |
| kDrive | `{accessToken, accountId, driveId, rootFolderId}` |
| MEGA | `{accessToken: <session id>, mk: <master key>, email, name?}` |
| S3 | `{accessToken: <accessKeyId>, secretAccessKey, endpoint, region, bucket, pathStyle}` |
| Koofr | OAuth tokens plus a cached `mountId` |

### `oauth2.js`: PKCE, the token endpoint and refresh

- `buildAuthorizeUrl(state)` reads 32 bytes from **`/dev/urandom` via `fs`**, not `crypto.randomBytes` (see the MEGA gotcha). It base64url-encodes them into `code_verifier`, computes `code_challenge = b64url(sha256(verifier))` with `code_challenge_method=S256`, and appends `AUTHORIZE_EXTRA` and `state`. The verifier is stored on `OAuth2._verifier`.
- `getAuthorizeUrl` **returns the verifier** to the auth app. The on-demand service is idle-killed during the long web login, so the verifier cannot live in memory. `exchangeCode` gets it back as `args.codeVerifier`. This is the **stateless verifier** pattern (`docs/ARCHITECTURE.md` §2).
- `_postToken(params)` POSTs a `--data-urlencode` form (`client_id`, plus `client_secret` if real, plus `scope` if `TOKEN_SEND_SCOPE`) to `TOKEN_URL`. A non-200 reply becomes `OAUTH_TOKEN_FAILED {status, body}`. A 200 reply → `{accessToken, refreshToken, expiresIn, tokenType}`.
- `refresh(refreshToken)` sends `grant_type=refresh_token`.
- **Refresh-on-401 lives in each adapter**, not in `oauth2.js`. Every `_req`/`rpc` does: request → `status === 401 && creds.refreshToken` → `OAuth2.refresh` → build `nc = {accessToken, refreshToken: t.refreshToken || creds.refreshToken, expiresAt}` → `cb(nc)` → retry once. The `|| creds.refreshToken` covers Google (does not rotate, usually omits it). Microsoft and Box rotate on every use, which is why persisting `renewed` matters.
- There is **no proactive expiry check**. `expiresAt` is stored but refresh only happens on a 401.

### `httpcurl.js`: the transport

`HttpCurl.request(opts)` → Future `{status, responseText}`. The fixed argv:

```
curl -s -S --tlsv1.2 --connect-timeout 15 --max-time 90 -w "\n%{http_code}" -X <METHOD>
     [--cacert <CURL_CAINFO>] [-H "Authorization: Bearer <bearer>"] [-H "K: V" ...]
     [-L]                         opts.follow   (Box /content, OneDrive /content 302s)
     [--create-dirs -o <outFile>] opts.outFile  (download: body streams to disk)
     [-F name=value | -F name=@file ...]   opts.multipart (Box/pCloud/Koofr uploads)
   | [--data-urlencode k=v ...]           opts.form      (token endpoint)
   | [--data-binary @<dataFile>]          opts.dataFile  (raw-body upload from disk)
   | [--data-binary <body>]               opts.body      (JSON RPC)
     <url>
```

- `execFile` gets `maxBuffer: 8 MiB`. Big transfers never pass through node, because curl reads with `@file` and writes with `-o`.
- The status code is the text after the **last** `\n` of stdout (from `-w`).
- An exec error with empty stdout → `CURL_FAILED {detail: stderr}`.
- The 15 s/90 s bounds exist because a stalled connection otherwise hung the command until `commandTimeout`. In QuickOffice that showed up as an endless "Loading files…" spinner.
- **No temp files of its own.** The caller picks `outFile`/`dataFile`. MEGA writes a `<dest>.mzenc` ciphertext beside the target and unlinks it after decrypting. MEGA photos are decrypted into `/media/internal/.mega-photos`.
- Security note in the file header: form fields, including `refresh_token` and `client_secret`, are visible in `ps` argv. That is accepted on a single-user device, with a TODO to move to `curl --config -`.
- Flickr ships its own copy of `httpcurl.js`, `acl.js` and `creds.js`. It predates cloudcore and is not on it.

### `acl.js`

The mojoservice framework does **not** enforce `allowedAppIds`. `Acl.enforce(assistant, future)` adds the check:

- Caller id = `message.applicationID() || message.senderServiceName()`, with the `" <pid>"` suffix stripped.
- Matched against globs (`*`, `?`).
- A denied call gets `PERMISSION_DENIED`.
- `Acl.BRINGUP` (default `false`) lets anonymous `luna-send` callers through, for testing only.

Photo methods stay open because the aggregator calls with **no bus identity** and is indistinguishable from a shell. Access control for them is the LS2 private-bus role.

### Worked example: a minimal connector on cloudcore

An illustrative "ExampleDrive" that uses only the fields and interface above, with a REST/id-based API and a Bearer token. The file names, `sources.json` order and command names are real. The endpoints are placeholders.

`cloud/exampledrive/service/com.palm.service.exampledrive/config.js`:

```javascript
var Config = {
	CURL: "/usr/bin/curl", CURL_LD_LIBRARY_PATH: "",
	CURL_CAINFO: "/etc/ssl/certs/ca-certificates.crt",
	CLIENT_ID: "<CLIENT_ID>", CLIENT_SECRET: "PLACEHOLDER_NO_SECRET",   // -> pure PKCE
	REDIRECT_URI:  "http://localhost/exampledrive/oauth2callback",
	AUTHORIZE_URL: "https://auth.example.com/oauth2/authorize",
	TOKEN_URL:     "https://auth.example.com/oauth2/token",
	API_BASE:      "https://api.example.com/v1",
	SCOPE: "files.readwrite offline", AUTHORIZE_EXTRA: "", TOKEN_SEND_SCOPE: false,
	SERVICE_NAME: "com.palm.service.exampledrive", DISPLAY_NAME: "ExampleDrive",
	STATE: "exampledrive", ROOT_FOLDER: "root", PHOTO_ALBUM_NAME: "Pictures",
	AUTH_APP_IDS: ["com.palm.app.cloud-auth"],
	FILE_APP_IDS: ["com.quickoffice.webos", "com.quickoffice.ar"]
};
```

`adapter.js`, the core of it (pattern copied from `cloud/onedrive/.../adapter.js`):

```javascript
var Future = IMPORTS.foundations.Control.Future;
var Adapter = {
	_req: function (o, creds, cb) {
		var self = this, f = new Future();
		function fire(c) { o.bearer = c.accessToken; return HttpCurl.request(o); }
		f.now(this, function () { return fire(creds); });
		f.then(this, function () {
			var r = f.result;
			if (r && r.status === 401 && creds.refreshToken) {      // refresh-on-401, once
				var rf = OAuth2.refresh(creds.refreshToken);
				rf.then(self, function () {
					var t = rf.result, nc = { accessToken: t.accessToken,
						refreshToken: t.refreshToken || creds.refreshToken,
						expiresAt: Date.now() + t.expiresIn * 1000 };
					if (cb) { cb(nc); }                                    // command persists it
					var retry = fire(nc);
					retry.then(self, function () { f.result = self._parse(retry.result, o); });
				});
				return;
			}
			f.result = self._parse(r, o);
		});
		return f;
	},
	_parse: function (r, o) {
		if (!r || r.status < 200 || r.status >= 300) {
			throw { returnValue: false, errorCode: "EXAMPLE_API_ERROR", status: r && r.status, body: r && r.responseText };
		}
		if (o.outFile) { return { path: o.outFile }; }
		return r.responseText ? JSON.parse(r.responseText) : {};
	},
	getAccountInfo: function (creds, cb) {
		var f = new Future(), call = this._req({ method: "GET", url: Config.API_BASE + "/me" }, creds, cb);
		call.then(this, function () { var u = call.result;
			f.result = { user: { emailAddress: u.email, displayName: u.name } }; });
		return f;
	},
	listFolder: function (creds, folderId, cb) {
		var f = new Future(), call = this._req({ method: "GET",
			url: Config.API_BASE + "/folders/" + encodeURIComponent(folderId) + "/children" }, creds, cb);
		call.then(this, function () {
			f.result = { entries: (call.result.items || []).map(function (e) {
				return { id: String(e.id), type: e.isFolder ? "folder" : "file", name: e.name,
					size: e.size, modified: new Date(e.mtime).toISOString(), path: String(e.id) };
			}) };
		});
		return f;
	},
	downloadFile: function (creds, fileId, localDest, exportMime, cb) {
		return this._req({ method: "GET", follow: true, outFile: localDest,
			url: Config.API_BASE + "/files/" + encodeURIComponent(fileId) + "/content" }, creds, cb);
	},
	uploadFile: function (creds, folderId, localPath, name, mimeType, cb) {
		return this._req({ method: "PUT", dataFile: localPath, url: Config.API_BASE + "/folders/" +
			encodeURIComponent(folderId) + "/files/" + encodeURIComponent(name) }, creds, cb);
	},
	uploadReplace: function (creds, fileId, localPath, mimeType, cb) {
		return this._req({ method: "PUT", dataFile: localPath,
			url: Config.API_BASE + "/files/" + encodeURIComponent(fileId) + "/content" }, creds, cb);
	}
};
```

Then:
- `services.json` lists the same commands as Dropbox's (§2), with `"assistant": "CloudService"`.
- `sources.json` follows the order above.
- The template is a copy of Dropbox's with `exampledrive` substituted. Its templateId **must** be `com.palm.exampledrive`, so that the Photos derivation yields `com.palm.service.exampledrive` (§6).
- PHOTO.UPLOAD additionally needs `commands/photolib.js`, `listAlbums_command.js` and `listPhotos_command.js`. Copy the closest provider (path-based: Dropbox/Yandex; id-based: OneDrive/Box).

---

## 4. Sign-in Flows by Auth Type

| Type | Connectors | customUI app | Validator command | Refresh |
|---|---|---|---|---|
| OAuth2 + PKCE (no secret) | Dropbox, OneDrive, Box (secret optional) | `com.palm.app.cloud-auth` | `exchangeCode` (core) | refresh-on-401. MS and Box rotate the refresh token. |
| OAuth2 + PKCE + shipped secret | Google Drive, Yandex, Koofr, HiDrive (HiDrive has no PKCE but ignores the challenge; README: "verify on device") | `cloud-auth` | `exchangeCode` (core) | refresh-on-401 |
| OAuth2 + secret, **no PKCE, no refresh**, regional host | pCloud | `cloud-auth` | local `exchangeCode` | none. Tokens last until revoked. |
| Personal API token | kDrive | `com.palm.app.kdrive-auth` | `verifyToken` | none |
| Email + password + E2E | MEGA | `com.palm.app.mega-auth` (`login.html`) | `login` | none. The session id is stored. |
| Access key + SigV4 | S3 | `com.palm.app.s3-auth` (`login.html`) | `login` | n/a |
| OAuth 1.0a (HMAC-SHA1) | Flickr | `com.palm.app.flickr-auth` | `exchangeCode` (own) | none. Tokens neither expire nor rotate. |

The generic `com.palm.app.cloud-auth` (`cloud/cloudcore/auth/com.palm.app.cloud-auth/source/cloudAuth.js`) knows **nothing provider-specific**:
- **Service URI** comes from `enyo.windowParams.template.validator.address` with `exchangeCode` stripped. On re-auth (`mode:"modify"`, no template) it comes from the account's first `capabilityProviders[].implementation`.
- **Redirect prefix** is the `redirect_uri=` parsed out of the authorize URL.
- **Header icon** is `template.icon.loc_48x48`.

### OAuth2 + PKCE sequence (cloud-auth, current code)

```
 Settings→Accounts      cloud-auth (customUI)          com.palm.service.<x>        Atlas/WAM      provider
 ─────────────────      ─────────────────────          ────────────────────        ─────────      ────────
  Add <x> ──launch──►  create(): serviceUri from
                       template.validator.address
  [Sign In] ────────►  getAuthorizeUrl {state} ──────►  OAuth2.buildAuthorizeUrl
                                                         verifier=/dev/urandom→b64url
                                                         challenge=S256(verifier)
                       ◄────────── {url, codeVerifier} ──
                       keep codeVerifier in the app (service may now be idle-killed)
                       legacy webOS: inline BasicWebView (mime x-atlas-browser),
                                     openURL "atlas-simple:"+url ──────────────►  WPE, TLS 1.3
                       LuneOS:       OAuthWindow.open(url) → window.open ──────►  WAM window
                                                                                  login + consent ──►
                                                                    ◄── 302 redirect_uri?code=…[&hostname&locationid]
                       capture: onUrlRedirected / onPageTitleChanged (legacy)
                                or poll popup location every 400 ms (LuneOS)
                       url starts with redirectPrefix → code | error
                       setTimeout(0): destroy webview, then
                       exchangeCode {code, codeVerifier, hostname?, locationid?} ─►
                                                         OAuth2.exchangeCode ─curl─► TOKEN_URL
                                                         ◄──────── {access, refresh, expires_in}
                                                         Adapter.getAccountInfo ─curl─► /me
                       ◄── {returnValue, username, alias, credentials:{common:{…}}}
                       + templateId, template
  ◄── CrossAppResult ── finish(result)
  createAccount (under cloud-auth's appId; stores credentials.common)
```

Timers: the whole flow has a 240 s deadline, and the webview gets a 3 s `onConnected` fallback. A redirect containing neither `code` nor `error` is ignored.

> `docs/ARCHITECTURE.md` §3 and `cloud/flickr/README.md` describe an **older** flow that launches a separate Atlas card and polls a `com.palm.systemservice` preference (`oauthResultKey`). cloud-auth no longer works that way. **Flickr's auth app still does** (`flickrAuth.js`: `oauthResultKey: "x_flickr_oauth_result"`, `getPreferences` polling, plus "Atlas must cold-launch").

### Token form (kDrive)

1. `kdrive-auth` shows instructions and an "Open token page in browser" button (`com.palm.applicationManager/launch`), plus one input field.
2. **Connect** calls `verifyToken {token}`.
3. `Adapter.discoverAccount` calls `GET /2/profile`, then `/2/drive`, and resolves the writable private-space root. The drive root id `1` is not writable.
4. It returns `common:{accessToken, accountId, driveId, rootFolderId}`.

OAuth was ruled out: Infomaniak's OIDC rejects the `drive` scope (`invalid_scope`).

### Email + password + E2E (MEGA)

1. `mega-auth` collects email and password. On `MEGA_MFA_REQUIRED` it shows a 2FA field and resends with `mfa`.
2. `login` runs `MegaApi.login`: a `us0` prelogin, then a v1 (AES `prepare_key` + `stringhash`) or v2 (PBKDF2-HMAC-SHA512, 100 000 iterations) password key.
3. The `us` call follows. The master key is unwrapped with AES-ECB and the RSA-encrypted session id is decrypted with the pure-JS bignum `modPow`.
4. Only `{accessToken: sid, mk, email}` is stored. The password is never stored.

Pure-JS vs native split (`cloud/mega/README.md`):

| Piece | Engine |
|---|---|
| Bulk file bytes | native ECB keystream (see the CTR gotcha) |
| Key unwrap, attributes, MAC | pure-JS AES |
| RSA | pure-JS `bignum.js` (trimmed jsbn) |
| PBKDF2 | native HMAC-SHA512 loop with binary strings, pure-JS fallback |

v2 sign-in is noticeably slow on the TouchPad (proton-drive recon cites ~23 s).

### SigV4 (S3)

1. `s3-auth` collects endpoint, region, bucket, access key, secret and a path-style toggle (default **on**).
2. `login` validates the keys with a zero-key `ListObjectsV2` before storing.
3. `s3sig.js` has two signing forms:
   - `signRequest()` (Authorization header) for list/get/put/delete. PUT uses `UNSIGNED-PAYLOAD`, so the file streams.
   - `presignUrl()` (`X-Amz-Signature`) for Photos.
4. `s3xml.js` parses the flat ListObjectsV2 and `<Error>` XML.
5. Folders are `/`-delimited prefixes.
6. There is no multipart upload.

### OAuth 1.0a (Flickr)

| Leg | Command | What happens |
|---|---|---|
| 1 | `getAuthorizeUrl` | Signed `request_token`. Returns `{url, requestToken, requestTokenSecret}`. The secret is carried across the login, the same way PKCE carries its verifier. |
| 3 | `exchangeCode {oauth_verifier, requestToken, requestTokenSecret}` | Signed `access_token`. Returns `common:{oauthToken, oauthTokenSecret, userId, username}`. |

`oauth1.js` builds the RFC 3986 base string and HMAC-SHA1 **in node** (0.9.8k supports `createHmac('sha1')`). curl only carries the already-signed URL. The consumer key and secret must ship (`Config.CONSUMER_KEY/CONSUMER_SECRET`, placeholders in the repo).

---

## 5. Per-Connector Table

Service id = `com.palm.service.<svc>`, template = `com.palm.<svc>`. Status is from `README.md` (top-level table, 0.9.3).

| Connector | svc | Auth | Caps | Runtime | Status | Quirks |
|---|---|---|---|---|---|---|
| Dropbox | `dropbox` | OAuth2 PKCE, public | DOC + PHOTO | cloudcore | ✅ device (reference impl) | RPC-style POST. Path locators. `Dropbox-API-Arg` header for content. Photos via `get_temporary_link` per file. One album `/Camera Uploads`. `deletePhoto` uses `files/delete_v2`. |
| Box | `boxnet` | OAuth2 PKCE, secret optional | DOC + PHOTO | cloudcore | ✅ device | REST, ids, root `"0"`. Refresh token **rotates**. Content 302 → `-L`. Multipart upload. Photo URL `/content?access_token=`. |
| OneDrive | `onedrive` | OAuth2 PKCE, no secret | DOC + PHOTO | cloudcore | ✅ device | Graph. `TOKEN_SEND_SCOPE:true`. Rotating refresh. PUT raw-body upload. Photos from the Camera Roll special folder via `@microsoft.graph.downloadUrl`. |
| Google Drive | `gdrive` | OAuth2 PKCE **+ secret** (Desktop client) | DOC only | cloudcore | ✅ device (personal, ≤100 users) | `access_type=offline&prompt=consent`. Refresh does not rotate. Native Docs need `exportMime` (QuickOffice doesn't pass it). Restricted `drive` scope means the unverified-app screen. Google Photos is unreachable headlessly (`recon/google-drive.md`). |
| pCloud | `pcloud` | OAuth2 + secret, **no PKCE, no refresh** | DOC + PHOTO | cloudcore + local oauth2/exchangeCode | ✅ device | US/EU region from redirect `hostname`/`locationid`, stored as `common.apiHost`. A 200 reply with nonzero `result` is an error. `getfilelink` for downloads. |
| Yandex Disk | `yandexdisk` | OAuth2 PKCE + secret | DOC + PHOTO | cloudcore | ✅ device | `Authorization: OAuth <token>`, **not** Bearer. Two-step signed-href download/upload. Album = `system_folders.photostream`, else `Pictures`. |
| kDrive | `kdrive` | Personal API token | DOC + PHOTO | cloudcore − oauth2 + `verifyToken` | ✅ device | Root id 1 is not writable, so it resolves the private space. Ids are stringified. Photo URLs carry `?access_token=`. Template `__comment` still says "DOCUMENTS-only", but it declares both. |
| MEGA | `mega` | Email + password, E2E | DOC + PHOTO | cloudcore − oauth2 + `login` | ✅ device (top README; `cloud/mega/README.md` still says 🟡) | Whole tree from one `f` call. Names and bytes decrypted locally. Photos handed over as decrypted `file://`. No inbound shares. Download meta-MAC not verified. |
| Koofr | `koofr` | OAuth2 secret + PKCE, scope `public` | DOC + PHOTO | cloudcore | ✅ device | `X-Koofr-Version: 2.1`. Mount + path model (primary mount cached). Separate `/content/api/v2` prefix. |
| HiDrive | `hidrive` | OAuth2 + secret | DOC + PHOTO | cloudcore | ✅ device | Root sentinel `home` → `/user/me` home path. `mtime` in seconds. Redirect on `localhost:8888`. Single-page listing (5000). |
| S3-compatible | `s3` | SigV4, user keys | DOC + PHOTO | cloudcore − oauth2 + `login` | 🟡 code-complete. Test vectors and mock server pass; not on device. | Path-style by default. Presigned photo URLs. No multipart. `PROVIDER_PRESETS` are informational only. |
| Flickr | `flickr` | OAuth 1.0a | PHOTO only | **standalone** (own httpcurl/acl/creds) | 🟡 needs an API key and secret | Old Atlas-card + pref-poll auth. Static `live.staticflickr.com` URLs. Synthetic "All Photos" album. |
| Proton Drive | — | SRP + OpenPGP | — | not built | 🔬 recon | Argon2id, X25519 etc. are infeasible in ES5. Would need a native Go helper (`recon/proton-drive.md`). |

Photo `src_big` styles all **self-authenticate**, so the aggregator's curl fetch needs no header (`photos-integration/README.md`):

| Style | Connectors |
|---|---|
| Pre-signed or static URL | OneDrive, pCloud, Flickr, Koofr, S3 |
| Per-photo temporary link | Dropbox, Yandex |
| `?access_token=` in the URL | Box, kDrive, HiDrive (HiDrive assumed, not device-verified) |
| Local `file://` after decryption | MEGA |

---

## 6. QuickOffice Reroute and Photos Integration

> **Where this lives now.** `README.md` (License/attribution) says changes to the stock **core apps** (Photos / Messaging / Contacts / Phone) live in the separate **core-apps** repository. Any app-level patches still in this repo, e.g. `photos-integration/`, are "superseded and stale". Treat core-apps as the source of truth for those apps. The description below is what this repo contains and what `com.palm.synergy.generic`'s postinst applies.

### QuickOffice (`quickoffice-integration/`)

Applies identically to `com.quickoffice.webos` and `com.quickoffice.ar`:

| File | How it ships | What it changes |
|---|---|---|
| `source/RemoteFileService.js` | full drop-in | The reroute itself |
| `source/FileStore.js` | full drop-in | Account recognition |
| `source/File.js`, `source/SaveAs.js` | full drop-ins | Date and Save-As polish |
| `patches/FolderContentsList.js.patch` | patch | Pull-to-refresh, overlay crash fix |
| `patches/FolderContentsPane.js.patch` | patch | Toolbar Refresh button |
| `css/FileBrowser.css` | stylesheet | Row layout |

**Discovery is account-derived.**
1. `FileStore._modernServiceUri(acct)` returns the `DOCUMENTS` `implementation` **iff** it starts with `palm://com.palm.service.`.
2. When it matches, it registers `QOWT.MX.modernServiceByAccountId[acct._id] = uri` and tags the account `accountType "modernCloudAccount"`, `mxId "modern"`.
3. Legacy providers fall through to the stock `loc_name` switch and the dead MX proxy.

**Routing** (`RemoteFileService.js`): `QOWT.MX.modernServiceUriForAccount(account)` → one lazily cached `PalmService` per URI.

| QuickOffice operation | Service call |
|---|---|
| `getFiles` | `listFolder {accountId, path}` |
| `getFilePathToRemoteFile` | `downloadFile {accountId, dropboxPath, localPath: QOWT.MXConfig.downloadFolder + name}` |
| `replaceFileInCloud` (save-back) | `uploadFile {accountId, localPath, fileId, replace:true}` |
| `addFileInCloud` | `uploadFile {accountId, localPath, folderId, name}` |

Id-based providers lose the filename. `QOWT.mxRevivalNames` (locator → real name) restores the extension so the native viewer can pick a renderer.

**New connectors need zero QuickOffice edits.** kDrive was added without touching it. Requirements on the connector:
- the `DOCUMENTS` implementation URI;
- the QuickOffice ids in `FILE_APP_IDS`;
- `downloadFile` honouring `--create-dirs` (curl creates `/media/internal/.qo/`).

Limitation: Google-native Docs won't open (no `exportMime`). The PoC `docviewer/` (Atlas-hosted PDF.js/mammoth/SheetJS) is deliberately **not** packaged.

### Photos (`photos-integration/patches/`)

| Patch | Target | Effect |
|---|---|---|
| `Utils.js.patch` | `com.palm.service.photos` `photos-src/base/Utils.js` | The `default:` branch gives **any** unmatched PHOTO.UPLOAD account `serviceName = templateId.replace(/^com\.palm\./, "com.palm.service.")` with `deletePhoto=true`. `removePhoto()` calls `<serviceName>/deletePhoto {accountId, pid}` **first** and only clears the local cache/DB on success. |
| `Sync-Manager.js.patch` | same service | Replaces the plain-HTTP `node_http.createClient(80, …)` downloader with `spawn("/usr/bin/curl", ["-sS","-L","--fail","--create-dirs","--max-time","120","--cacert",CA,"-o",dest,src_big])`. Per-image wait goes 10 s → 130 s. `photo.fileName` names the local file. |
| `LibraryNavigationPanel.css.patch` + `assets/syn-*.png` | `com.palm.app.photos` | `.library-navigation-icon-<type>` for `boxnet dropbox kdrive onedrive yandexdisk mega koofr hidrive`. `<type>` is the last dotted segment of the templateId. |
| `PictureMode.js.patch`, `AlbumModeMultiselectControls.js.patch` | `com.palm.app.photos` | "permanently deletes … from your cloud account" warnings. The target paths are unconfirmed (`packaging/README.md`), so postinst applies them best-effort. |

**Routing rule:** the template id **must** be `com.palm.<x>` and the service `com.palm.service.<x>`. That is why Box is `com.palm.boxnet`/`com.palm.service.boxnet` and Yandex is `com.palm.yandexdisk`/`com.palm.service.yandexdisk`.

The photo provider methods live **inside the connector service**, not in a separate `com.palm.service.photos.<x>`. That avoids a second bus name and role (`docs/ARCHITECTURE.md` §6). Per `photolib.js`, **one configured folder becomes one album**, which bounds how much is auto-downloaded into `/media/internal/.photosApp/`. The Library name shown is the account **`alias`**.

---

## 7. Packaging and Deploy

### Packages (`packaging/`, version 0.9.3)

| Package | Contents |
|---|---|
| `com.palm.synergy.generic` | `_cloudcore` → `/usr/palm/services/_cloudcore`, `com.palm.app.cloud-auth`, the QuickOffice/Photos payloads (applied by postinst), plus the messaging infrastructure. **Install first.** |
| `com.palm.synergy.<name>` | One per connector. `<name>` ∈ `box dropbox flickr gdrive hidrive kdrive koofr mega onedrive pcloud s3 yandex`. Built by `packaging/cloud/stage.sh <name>` from `packaging/cloud/<name>/control.env` (`PKG_ID`, `PKG_VERSION`, `PKG_DESC`). |

The package namespace is `com.palm.synergy.*`, renamed from `org.webosports.synergy.*` in commit `f008730`. There is **no `Depends:` line**: Preware/WebOS Quick Install refuse a dependency that isn't in a subscribed feed, so install order is honour-system. Install with **Preware or WebOS Quick Install, not `palm-install`**, because `palm-install` skips the root postinst.

What `stage.sh` puts in a connector `.ipk`:

```
account template        /usr/palm/public/accounts/com.palm.<id>/           (base + resources/*)
service                 /usr/palm/services/com.palm.service.<x>/
  + palm_bus_config.json   {"busNames":["com.palm.service.<x>"],"privateBusAccess":true}
LS2 roles (pub + prv)   /usr/share/ls2/roles/{pub,prv}/com.palm.service.<x>.json
dbus activation         /usr/share/dbus-1/system-services/com.palm.service.<x>.service
dedicated auth app      /media/cryptofs/apps/usr/palm/applications/<app-id>/   (kdrive/mega/s3/flickr)
```

The generated role and activation files, exactly as `stage.sh` writes them:

```json
{"role": {"allowedNames": ["com.palm.service.<x>"], "type": "regular", "exeName": "js"},
 "permissions": [{"inbound": ["*"], "outbound": ["*"], "service": "com.palm.service.<x>"}]}
```
```ini
[D-BUS Service]
Name=com.palm.service.<x>
Exec=/usr/bin/run-js-service -n /usr/palm/services/com.palm.service.<x>
```

Why all three files are needed (commits `edcef2a`, `baf279a`; modelled on stock `com.palm.service.photos.facebook`):
- **No role:** sign-in fails with "not permitted".
- **No `.service` file:** ls-hubd answers "Service not listed in service files: com.palm.service.mega". A role only grants permission once the hub knows the service exists.
- `exeName` is `"js"` because jsservicelauncher registers as `js`, even for `"engine": "node"` services.

On LuneOS, sign-in uses the `OAuthWindow` path (commit `8a37e0c`). This repo does not show whether LuneOS's hub consumes the same activation file (unverified).

### postinst / prerm (`packaging/cloud/postinst`, `prerm`; shared by all 12)

ipkg unpacks `data.tar.gz` **before** postinst can remount `/` read-write. So everything bound for the root filesystem is staged under `/media/cryptofs/synergy-revival/rootfs-overwrite/<PKG_ID>/`, and postinst:

1. Derives `PKGID` from `$0`: `/usr/lib/ipkg/info/<id>.postinst` or `/media/cryptofs/apps/.scripts/<id>/pmPostInstall.script`.
2. Remounts `/` rw.
3. Merges any **doubled** offline-root path `/media/cryptofs/apps/media/cryptofs/…` back. This has to happen *before* computing `$OV` (the MEGA 0.9.3 bug).
4. Copies each staged file to its real path. It backs up a stock file once to `/media/cryptofs/synergy-stock-backup/` and records every path in `/media/cryptofs/synergy-revival/applied-paths.<PKGID>.list`. It fails loudly on an empty or partial stage, and treats a second WebOS Quick Install run as a no-op.
5. Runs `luna-send … applicationManager/rescan` **backgrounded**. A synchronous `-n 1` deadlocks the installer (GH #6).
6. Runs **`ls-control scan-services`**, because ls-hubd only reads `.service` files and roles at startup.
7. Kills `accounts.js` so the Accounts service reloads templates.

`prerm` walks the applied list: it restores a backup, or else deletes the file. It stops and starts `imtransport` around the removal and backgrounds the rescan.

### Manual deploy (dev loop, from per-connector READMEs)

```sh
mount -o remount,rw /
# service  -> /usr/palm/services/com.palm.service.<x>/  (+ _cloudcore/ sibling)
# template -> /usr/palm/public/accounts/com.palm.<x>/   (base + resources/*)
# auth app -> /media/cryptofs/apps/usr/palm/applications/<app-id>/
ls-control scan-services                      # new bus name / role / .service file
```

What to restart after which edit:

| Edit | Restart |
|---|---|
| Template **content** | Kill the Accounts service, then restart LunaSysMgr. It caches templates in RAM and reloads only when the template *list* changes (`docs/ARCHITECTURE.md` §3). |
| Auth-app JS | LunaSysMgr |
| Service `.js` | nothing ("reloads per-call", `cloud/dropbox/README.md`). The on-demand service is respawned. |
| QuickOffice files | LunaSysMgr |
| Photos-app CSS | cold-relaunch the Photos card |

### Tests

- **No cloud unit tests are committed.** The READMEs cite off-device harnesses (MEGA crypto vs native `crypto`/`BigInt`, S3 SigV4 vs AWS vectors 12/12, Koofr mock 13/13, HiDrive mock 10/10), but those harness files are not in the repo.
- `tests/test-connectors.sh [--file PATH] [--cleanup] [--per-acct-wait N]` drives a device over `novacom`: it creates accounts from `tests/accounts.local.tsv` and classifies `imloginstate` from `/media/internal/imstdout.log`. It is **messaging-only** (`accounts.example.tsv` lists IM templates).
- `tests/test-prerm-restore.sh`, `test-prerm-atomic-restore.sh`, `test-postinst-no-blocking-rescan.sh`, `test-nudge-kill.sh` are packaging regression tests for GH #2/#8/#6/#3, run on the host.

### Debugging on device

```sh
# call a service directly. Gated methods need Acl.BRINGUP=true or an app caller.
luna-send -n 1 palm://com.palm.service.dropbox/listAlbums '{"accountId":"<ACCOUNT_ID>"}'
luna-send -n 1 palm://com.palm.service.kdrive/verifyToken '{"token":"<API_TOKEN>"}'
# is the bus name known?  "Service not listed in service files" -> .service file / scan-services
ls /usr/share/dbus-1/system-services/com.palm.service.*.service; ls-control scan-services
# curl/CA sanity (the same flags httpcurl uses)
/usr/bin/curl -sS --tlsv1.2 --cacert /etc/ssl/certs/ca-certificates.crt -o /dev/null \
  -w '%{http_code} %{ssl_verify_result}\n' https://api.dropboxapi.com/
```

- Service `console.log` lines carry `Config.SERVICE_NAME`, e.g. `token endpoint failed status=…`, `ACL denied caller='…'`.
- cloud-auth logs `cloud-auth: launch params …`, `serviceUri=…` and `startEmbeddedAuth … redirectPrefix=…`.
- See `webos://knowledge/synergy` "Debugging" for log locations and the jail problem.

---

## 8. Checklist: Adding a Cloud Connector

1. **Pick the auth model.**
   - OAuth2 with PKCE and no secret is best.
   - A secret ships in the package. Treat it as public and document the risk.
   - Token, key or password? Write a local validator command plus your own customUI app (copy `kdrive-auth`/`mega-auth`/`s3-auth`).
   - Non-standard token exchange? Write a local `oauth2.js` + `exchangeCode` (copy pCloud).
2. **Register the app with the provider** using redirect `http://localhost/<x>/oauth2callback`. Put the real `CLIENT_ID`/secret in `config.js` **at build time**. Never commit live secrets; the repo keeps `PLACEHOLDER_…` sentinels for several providers.
3. **Name things consistently.** Service `com.palm.service.<x>`, template `com.palm.<x>`. Photos routing and the Library icon class depend on this.
4. **Write `config.js`** with every field from §3, including `SERVICE_NAME`, `ROOT_FOLDER`, `AUTH_APP_IDS` and `FILE_APP_IDS` (the QuickOffice ids).
5. **Write `adapter.js`.**
   - Implement `getAccountInfo`, `listFolder` (normalised, ISO-`Z` dates, **string** ids), `downloadFile` (streams via `outFile`), `uploadFile`, `uploadReplace`. Add `deletePhoto` and `ensureAlbumFolder` for photos.
   - Refresh-on-401 → `cb(newCreds)`.
   - Every non-2xx reply → throw `{returnValue:false, errorCode, status, body}`.
6. **Photo source (optional):** `commands/photolib.js`, `listAlbums_command.js`, `listPhotos_command.js`.
   - One folder becomes one album.
   - `src_big` must self-authenticate (no header), or be a decrypted `file://` path.
   - Set `fileName`.
   - Leave these commands open (no `allowedAppIds`).
7. **Write `services.json`** with `"engine":"node"`, `"assistant":"CloudService"`, `"public":true` commands, and 300 s timeouts on photo commands.
8. **Write `sources.json`** in the order shown in §3.
9. **Write the account template.**
   - customUI `com.palm.app.cloud-auth`/`oauth.html` (or your own app) and the `validator.address`.
   - `onCredentialsChanged` → `checkCredentials`.
   - The auth app **and** the service in read+writePermissions.
   - A DOCUMENTS `implementation` of `palm://com.palm.service.<x>/`. For photos, a PHOTO.UPLOAD block pointing at `com.palm.service.photos`.
   - Mirror the JSON into **every** `resources/<locale>/`.
   - 32×32 and 48×48 icons.
10. **Validator replies must include `username`.** `createAccount` asserts it. Resolve the command Future **only inside `.then`**: `future.nest()` leaks the raw token result, and Accounts then stores nothing.
11. **Package it:** `packaging/cloud/<x>/control.env` (`PKG_ID=com.palm.synergy.<x>`). Optionally add a Library icon (`assets/syn-<x>.png` + CSS rule) in core-apps. Then `packaging/build-all.sh <x>` → `packaging/out/`.
12. **Verify on device.**
    - Sign in, then reboot.
    - `listFolder` with only `accountId`.
    - QuickOffice open + save-back.
    - A photo album appears, upload works, delete works.
    - The refresh path, by expiring the token.
    - `luna-send` from a shell is rejected for gated methods.

---

## Gotchas

**Device runtime (node 0.4.12 / OpenSSL 0.9.8k)**

- **No `aes-128-ctr` cipher** ("Unknown cipher"). MEGA builds CTR itself: the counter blocks are `nonce(8) || 0(4) || uint32_be(i)`, run through native `aes-128-ecb`, and the keystream is XORed in JS in 64 KiB slices (`megacrypto.js ctrFile`).
- **`createCipheriv` on 0.4.12 wants binary-string key/iv, not Buffers.** It has no `setAutoPadding`, and ECB needs a 16-byte iv where modern node wants `null`. The code detects both cases at runtime.
- **`hmac.digest()` with no encoding returns a binary *string*, not a Buffer.** `update(str)` without an encoding also mangles input. MEGA's PBKDF2 uses explicit `"binary"` everywhere (`megacrypto.js pbkdf2Native`).
  *Unverified risk:* `s3sig.js signingKey()` chains `hmac()` → `digest()` with no encoding. It passed AWS vectors on modern node, but S3 has never run on a device.
- **`crypto.randomBytes` blocks on `/dev/random`**, which hung uploads, and `Buffer.readUInt32BE` doesn't exist. Read `/dev/urandom` through `fs` (MEGA `_rand`, `oauth2.js _genVerifier`).
- **No `crypto.privateDecrypt` and no SHA-512 PBKDF2.** RSA goes through pure-JS bignum, PBKDF2 through an HMAC loop.

**Accounts framework**

- **Templates are cached in RAM.** After editing template *content*, kill the Accounts service and restart LunaSysMgr.
- **Locale files override the base template.** Mirror every change into all of them.
- **A validator reply without `username` makes `createAccount` refuse.** Resolve futures only in `.then`. Never `future.nest()` the token call.
- **On re-auth (`mode:"modify"`) there is no template.** cloud-auth derives the service from `capabilityProviders[].implementation` instead.

**Transport**

- **Unbounded curl showed up as eternal QuickOffice spinners.** Keep `--connect-timeout`/`--max-time`.
- **Without a current CA bundle every provider fails verification.** The 2011 stub has no ISRG Root X1.
- **Secrets and refresh tokens show up in `ps` argv** (`--data-urlencode`).
- **The Photos aggregator's old downloader was plain HTTP on port 80.** Without `Sync-Manager.js.patch`, cloud photos never download.

**OAuth and UI**

- **Tearing down the WebView inside its own navigation callback crashes LunaSysMgr.** cloud-auth defers with `setTimeout(0)`.
- **On LuneOS there is no NPAPI, so the inline Atlas view never paints.** `<iframe>` is blocked by Google (X-Frame-Options) and frame-busted by Microsoft, so cloud-auth uses `window.open` (WAM runs with `--disable-web-security`).
- **Flickr's card-based Atlas flow needs a cold Atlas launch.** A stale card doesn't re-navigate.

**Providers**

- Google Photos is unreachable headlessly. The Library API (since 2025-03-31) only returns app-created media and needs the interactive Picker (`recon/google-drive.md`).
- Google OAuth in "Testing" mode kills refresh tokens after 7 days. Listing is capped at `pageSize` 1000.
- pCloud returns HTTP 200 for logical errors (`result != 0`). The wrong region host answers "log in first".
- Microsoft and Box rotate the refresh token on every use. Always persist `renewedCredentials`.
- Yandex wants `Authorization: OAuth`, not `Bearer`.
- kDrive's drive root is not writable. QuickOffice string-ops the locators, so ids must be strings.
- MEGA's `g` URLs serve ciphertext. Photos must be decrypted to local files at list time, which is slow and eager.
- Dates must be ISO-`Z`. kDrive (epoch seconds) and Box (RFC 3339 offsets) blanked QuickOffice rows until normalised.
- Instagram, Facebook and LinkedIn are dead as photo sources. Snapfish is marginal (`recon/`).

**Packaging**

- An LS2 role alone is not enough. Ship the `.service` activation file and `palm_bus_config.json` too, then `ls-control scan-services`.
- Never run a blocking `luna-send -n 1` from postinst/prerm.
- Offline-root installs double the `/media/cryptofs/…` prefix.

### Doc drift to be aware of

- `README.md` "Shared `_cloudcore` runtime" lists Dropbox, Box, Google Drive and Yandex as "own standalone service". Their current `sources.json` files all load `../_cloudcore/…`. **Only Flickr is standalone.**
- `cloud/box/README.md`, `gdrive/README.md` and `yandex/README.md` describe `boxapi.js`/`driveapi.js`/`yandexapi.js` and per-provider `*-auth`/`*-files` apps. Those are gone.
- `cloud/dropbox/README.md` says the file methods are gated to `com.palm.app.dropbox-files`/`com.palm.app.photos`. The code gates them to the QuickOffice ids.
- `cloud/koofr/README.md` describes app-password Basic auth with a `koofr-auth` app and a `login` command. The current code is OAuth2 via `cloud-auth` (`koofr/account/com.palm.koofr.json`, `adapter.js` header).
- The `_cloudcore/oauth2.js` and `creds.js` header comments still say "Google Drive" (copied). The code itself is generic.
- `photos-integration/README.md` describes a fall-through `case` list. The patch uses a `default:` derivation instead.

---

## See Also

- `webos://knowledge/synergy-internals`: how the framework works underneath (accounts service, lifecycle, Sync library)
- `webos://knowledge/synergy-messaging-connectors`: libpurple-based IM connectors (Messaging + Phone apps)
- `webos://knowledge/synergy-music-connectors`: streaming music providers ("Music" account type)
- `webos://knowledge/synergy` covers classic Synergy services: templates, db8 sub-kinds, Futures, keymanager credentials, checkCredentials, debugging.
- `webos://knowledge/oauth` is the hosted OAuth broker, the alternative when Atlas and modern curl are not on the device.
- `webos://knowledge/tls-and-networking` covers the OpenSSL 1.1.1w / TLS 1.3 updates, `/usr/bin/curl`, and shell-out patterns.
- `webos://knowledge/db8` covers the Photos aggregator album/file records, which live in MojoDB.
- `webos://knowledge/ls2-roles` covers role file format and `exeName`.
- `webos://knowledge/postinst-packaging` covers postinst/prerm patterns and Preware vs `palm-install`.
- `webos://knowledge/js-services` covers `services.json`/`sources.json` and the command assistants.
