# Music Connectors (Spotify & Streaming Providers)

`org.webosports.app.music` ("Music+Spotify") is a fork of the stock Enyo 1.x Music app (`com.palm.app.musicplayer`) that plays local files **and** streaming services: Spotify, Apple Music, Deezer, Tidal, Qobuz, SoundCloud, Jamendo, Internet Archive and YouTube. Each provider is added through **Settings → Accounts → Add Account**, but the actual work is done by one native Go daemon, `spotify-webos-service`, which the app and the sign-in UI reach over **localhost HTTP** (`127.0.0.1:8730`). The daemon is not a Luna bus service.

This page describes the code as of the 0.9.2 tree (`app/appinfo.json`, `CHANGELOG.md`). Some of the repo's documents are out of date. Where they disagree with the code, this page follows the code and points out the difference.

**Reference repo:** `org.webosports.app.music` (paths below are relative to it). Test scripts that call the daemon with `curl` live in the separate `~/webos/spotify/` directory (`svcplay.sh`, `probe2.sh`, `vhandoff.sh` …) and in `service/playtest.sh` / `service/probe.sh`.

---

## Key Answer: Are Music Providers Synergy Accounts?

**Partly.** Each provider is a real account type. It has a template in `/usr/palm/public/accounts/`, is registered with `com.palm.service.accounts`, and appears under Add Account. It declares a `capabilityProviders` entry with a **custom `"Music"` capability**. It is **not** a full Synergy connector, though:

| Synergy feature | Music connectors |
|---|---|
| Account template + icons | ✅ `deploy/accounts/org.webosports.app.music.<p>/org.webosports.app.music.<p>.json` |
| `validator.customUI` | ✅ shared app `org.webosports.app.musicauth`, `validator.html` |
| `capabilityProviders` | ✅ `capability:"Music"`, `capabilitySubtype:"STREAMING"`, `alwaysOn:true` |
| `implementation` / `onCreate` / `onEnabled` / `onDelete` / `sync` | ❌ none. There is no bus service for the Accounts service to call back into. |
| `dbkinds` | ❌ none. Tracks are never written to DB8. |
| Credentials in the account store | Only for **Spotify** (`credentials.common = {accessToken, refreshToken, expiry}`). For every other provider the validator stores `credentials.common = {service:"<id>"}`, and the real secret goes into a **file the daemon owns** under `/media/cryptofs/spotify-webos/`. |

Evidence: `docs/MUSIC-ACCOUNTS-SYNERGY.md` ("declared *without* bus callbacks … our backend is a localhost HTTP server, not a luna-bus service"), `service/creds.go` and `app-musicauth/source/musicAuth.js` (`finishService()` vs `fetchTokenAndFinish()`).

> **Docs disagree:** the design doc's example template says `"capabilityProviders": []` and the text says `capability:"MUSIC"`. Every shipped template uses `"capability": "Music"` (mixed case), and `app/utility/accountmanager.js` filters with `{capability:"Music"}`. Use the shipped form.

Consequence: deleting an account in Settings removes only the account row. Because there is no `onDelete`, the daemon's credential files (`qobuz-auth`, `deezer-arl`, `tidal-token`, `apple-music-user-token`, `spotify-token.json`) are left in place, and the provider stays usable until those files are removed by hand. This was inferred from the absence of any delete hook (grep for `onDelete`/`deleteAccount` finds nothing in `service/`, `app-musicauth/` or `deploy/`). It has not been tested on a device.

### The template (shipped shape, Spotify)

```json
[{
  "templateId": "org.webosports.app.music.spotify",
  "loc_name": "Spotify",
  "icon": { "loc_32x32": "images/spotify-32x32.png", "loc_48x48": "images/spotify-48x48.png" },
  "validator": { "customUI": { "appId": "org.webosports.app.musicauth", "name": "validator.html" } },
  "loc_usernameLabel": "SPOTIFY ACCOUNT",
  "readPermissions":  ["org.webosports.app.music.service", "org.webosports.app.music", "org.webosports.app.musicauth"],
  "writePermissions": ["org.webosports.app.music.service", "org.webosports.app.music", "org.webosports.app.musicauth"],
  "capabilityProviders": [{
    "capability": "Music", "capabilitySubtype": "STREAMING",
    "id": "org.webosports.app.music.spotify.streaming", "alwaysOn": true,
    "loc_shortName": "Spotify",
    "icon": { "loc_32x32": "images/spotify-32x32.png", "loc_48x48": "images/spotify-48x48.png",
              "splitter": "images/spotify-32x32.png" }
  }]
}]
```

The templates for apple, archive, deezer, jamendo, qobuz, soundcloud and tidal are identical apart from the names. Compared with a messaging template from `webos-synergy-revival` (for example `messaging/signal/account/com.palm.signal/com.palm.signal.json`), the shape is the same except that `implementation`, `onEnabled`, `onDelete`, `serviceName` and `dbkinds` are missing.

`org.webosports.app.music.service` in the permission lists is an identity that the daemon **claims** through `luna-send -a`. It does not register on the bus (see Service).

---

## Architecture

```
 Settings → Accounts → Add Account → "Spotify" (template from connector ipk)
          │ launches customUI
          ▼
 ┌──────────────────────────────┐   XHR http://127.0.0.1:8730
 │ org.webosports.app.musicauth │──────────────────────────────┐
 │ validator.html / musicAuth.js│  /login /auth/* /tidalauth/* │
 │ (Atlas WebView for OAuth)    │  /appleauth/* /qobuzauth/... │
 └──────────────┬───────────────┘                              │
   CrossAppResult {credentials.common…}                        │
          ▼                                                    ▼
 com.palm.service.accounts  ◄── luna-send -a org.webosports.app.music.service
   (account rows)               listAccounts/readCredentials/writeCredentials
          ▲                                                    │
          │ listAccountsPublic / readCredentialsPublic         │
 ┌────────┴─────────────────────────────┐                      │
 │ org.webosports.app.music (Enyo 1.x)  │   XHR :8730           │
 │  kindMediaIndex  (local, com.palm.db)│                      │
 │  kindConnectorView ── /providers, /provider/<id>/search ───►│
 │  kindPlayback → kindAudioRouter                             │
 │    ├ kindAudioManager   (local: HTML5 <audio>)              │
 │    ├ kindLibrespotManager ("spotify:…") ── /player/* ──────►│
 │    └ kindStreamManager ("<prov>:<id>") ── /provider/<id>/play, /stream/* ─►│
 └─────────────────────────────────────┘                       ▼
                         ┌───────────────────────────────────────────────┐
                         │ spotify-webos-service (Go, ARMv7, upstart)    │
                         │ MusicProvider registry · token/cred files     │
                         │ /dzstream /tidalstream /applestream proxies   │
                         └──────┬───────────────────────────┬────────────┘
             Spotify Web API    │ spawns                    │ sh -c "curl -sL URL |
             (Connect control)  ▼                           ▼   gst-launch-0.10 fdsrc ! decodebin
                         librespot --backend subprocess      ! audioconvert ! ffaudioresample
                           | gst-launch-0.10 fdsrc ! queue    ! pulsesink media.role=music"
                           ! pulsesink media.role=music
```

### Data sources

| Source | Kind | Backed by |
|---|---|---|
| Local library | `kindMediaIndex` (`app/utility/mediaindex.js`, stock) | `com.palm.media.audio.*:1` DB8 kinds |
| All streaming providers | `kindConnectorView` (`app/source/connectorView.js`) | `GET /providers`, then `GET /provider/<id>/search?q=&limit=` |
| `kindSpotifyIndex` (`app/utility/spotifyindex.js`) | Loaded in `depends.js` but **not instantiated** in `app/source/app.js` (only `MediaIndex` is). It is a leftover scaffold from before the Connectors view existed. | — |

The Connectors view builds one `TabButton` for each provider returned by `/providers`, using the icon `images/connectors/<id>.png`. Spotify appears as one of these tabs (the header comment in `connectorView.js` still says Spotify is excluded, but `buildTabs` includes it). `app.js` calls `refreshProviders()` every time the view is entered, so a provider added while the app is open appears without a restart.

### Playback dispatch (`app/utility/audiorouter.js`)

`app/utility/playback.js` uses `kind:"kindAudioRouter"` in place of the stock `kindAudioManager`. The router chooses an engine from the track's `path`:

```js
_streamRe: /^(youtube|soundcloud|deezer|jamendo|archive|qobuz|tidal|apple):/,
_pick: function (p) {
    if (p.indexOf("spotify:") === 0) return this.$.spotify;   // kindLibrespotManager
    if (this._streamRe.test(p))      return this.$.stream;    // kindStreamManager
    return this.$.local;                                       // kindAudioManager (HTML5 audio)
}
```

The three engines expose the same interface: `playAudio`, `pauseAudio`, `setAudioTime`, `getAudioCurrentTime`, `getAudioDuration`, `resetAudio` and `killAudio`, the flags `boolAudioPlaying/Paused/Loaded`, and the events `onPlaying/onEnded/onSrcChanged/onPausePlay/onAudioError`. The router passes the active engine's events up unchanged.

**Where the audio goes:** local files use HTML5 `<audio>` through the Palm media server. Both remote engines play nothing inside the app. Audio comes out of the **daemon's own gst-0.10 pipeline into PulseAudio with `media.role=music`**, and Palm audio policy routes that role to the speaker. This is why `/stream/status` and `/player/status` are polled once a second for position and end of track.

---

## Providers

Every provider implements `MusicProvider` (`service/provider.go`):

```go
type MusicProvider interface {
    ID() string
    Name() string
    Search(ctx context.Context, query string, limit int) ([]providerTrack, error)
    StreamURL(ctx context.Context, trackID string) (string, error) // "" = plays via own engine
}
// optional: formatSelector.StreamURLFormat(ctx,id,format)  (YouTube only)
// optional: videoResolver.StreamURLVideo(ctx,id)           (YouTube only)
```

`providerTrack` JSON fields: `id, provider, title, artist, album, thumbnail, duration_ms, published (omitempty), path`. `path` is `spotify:track:<id>` for Spotify and `<provider>:<id>` for the others.

| Provider | Sign-in (musicauth mode) | Creds stored at | Metadata API | Playback | Status in code |
|---|---|---|---|---|---|
| **Spotify** | OAuth Auth-Code + PKCE run **in the daemon**; validator opens `/login` in a WebView and polls `/auth/status` (2 s, cap 60 polls ≈ 2 min) | `spotify-token.json` **and** the Accounts `common` creds | Spotify Web API via `github.com/zmb3/spotify/v2` | librespot Connect receiver "webOS", driven over the Connect Web API (`/player/*`) | Works; **Premium required** (`librespot/README.md`) |
| **Apple Music** | MusicKit page served by `/appleauth/login` in a WebView; it POSTs to `/appleauth/save`; validator polls `/appleauth/status` (cap 60) | `apple-music-user-token`; **`/media/internal/device.wvd`** | iTunes Search API (`itunes.apple.com/search`) | `/applestream?id=` does the web-player `webPlayback` call, then the Widevine license, then downloads the **whole** encrypted fMP4, decrypts it (`github.com/iyear/gowidevine`) and serves m4a to gst | Code complete (commit 51155be "ported from jukie-drm"); needs a user-supplied L3 CDM |
| **Deezer** | email+password → `/dzauth/login` (fetches the ARL); if blocked, ARL paste → `/dzauth/save` | `deezer-arl` | public `api.deezer.com/search` (no auth) | with ARL: `/dzstream?id=` Blowfish-descrambling proxy; without: 30 s `preview` MP3 | Provider is always registered |
| **Tidal** | PKCE web flow: `/tidalauth/start` → WebView → validator grabs `?code=` from the `tidal.com/login/auth` redirect → `/tidalauth/exchange` | `tidal-token` | `api.tidal.com/v1` search | `/tidalstream?id=` rebuilds DASH fMP4/FLAC segments into FLAC | Registered only when the token file exists |
| **Qobuz** | email+password → `/qobuzauth/login` (validated by logging in; file removed on failure) | `qobuz-auth` (email, password, optional app_id/secret lines) | `qobuz.com/api.json/0.2` | plain FLAC URL from `track/getFileUrl` | Registered only when creds exist |
| **SoundCloud** | none ("noauth": just add) | — | api-v2 with a `client_id` **scraped from site JS** (cached, re-fetched on failure) | progressive MP3 / HLS URL | Always registered |
| **Jamendo** | none | optional `jamendo-clientid` | Jamendo v3.0 API | direct MP3 | Built-in demo client id is rate-limited |
| **Internet Archive** | none | — | `advancedsearch` + metadata API | first playable audio file URL | Always registered |
| **YouTube (Music)** | none in practice | `youtube-oauth.json` only if `/ytauth/*` device-code is used | InnerTube WEB client search | InnerTube **ANDROID_VR** client + anonymous visitorData session gives un-ciphered itag 140 (AAC) / 251 (Opus); `ytcipher.go` (goja) is the fallback | Always ready (`providerReady`), but **there is no account template / connector ipk** (see Gotchas) |

Apple Music, Tidal, Qobuz and Deezer full-track playback all require a paid subscription with that service (`CHANGELOG.md` "Known limitations"; Tidal's PKCE note is in `service/tidaldl.go`). `docs/MUSIC-CONNECTORS.md`'s table says Apple Music is "not feasible". That is out of date: later commits a755091 and 51155be added Widevine playback.

**DRM / secrets notes (described from the code, not endorsed):**
- Apple: the code describes `device.wvd` as "a Widevine L3 CDM (client-id + RSA key)" supplied by the user. It is never committed (it is in `.gitignore`) and is kept on `/media/internal` so the user can drop it in over USB. The short-lived web developer token is scraped from `music.apple.com` JS bundles and cached in `apple-webtoken.json`.
- Deezer: streams are Blowfish "BF_CBC_STRIPE" encrypted. The key is derived per track using a constant that is common to all clients and hard-coded in `deezerdl.go`.
- Tidal, YouTube, SoundCloud and Jamendo use public client identifiers that are **hard-coded or scraped** in the Go sources (`tidaldl.go`, `ytauth.go`, `youtube.go`, `jamendo.go`). Do not copy them into new code. Read them from the source if you need them.
- Spotify: no client secret (PKCE). Each device needs a **developer client id** in `spotify-client-id`, and the Spotify app must have the redirect URI `http://127.0.0.1:8730/auth/callback` registered exactly as written.

### Lossless download (side feature)

`service/lossless.go` works as follows: take a Spotify track, look up its ISRC (`isrc.go`), call `Resolve(ISRC)` on Qobuz, Tidal or Deezer, call `FileURL`, then download into `/media/internal/Downloads` (descrambling for Deezer). The endpoints are `GET /download/providers` and `POST /download {spotify_id | isrc, provider?}`, which returns `{ok, provider, path, format, isrc}`.

### YouTube video hand-off

`POST /provider/youtube/resolveVideo {trackId}` returns `{url}` for **progressive** itag 22 (720p) or itag 18 (360p), which are muxed H.264+AAC. The commit says the SoC decoder (`OMX.qcom.video.decoder.avc`) handles H.264 only, not VP9/AV1. The URL is meant for the native Video Player (`~/webos/spotify/vhandoff.sh` launches `com.palm.app.videoplayer` with `params.target`). Commit 06fcbde notes that nothing in the app calls this yet. Providers that do not implement `videoResolver` answer **409**.

---

## Service: `spotify-webos-service`

**It is not a Luna service.** `CLAUDE.md` and `docs/ARCHITECTURE.md` both say it is "a plain localhost HTTP/JSON server". There is no `services.json`, no LS2 registration, and no `palm://` service name. The name `org.webosports.app.music.service` appears only as the identity passed to `luna-send -a` when the daemon calls the Accounts service (`service/creds.go`):

```go
const serviceCallerID = "org.webosports.app.music.service"
ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
cmd := exec.CommandContext(ctx, "luna-send", "-n", "1", "-a", serviceCallerID, uri, payload)
// uris: palm://com.palm.service.accounts/listAccounts | readCredentials | writeCredentials
```

At startup `restoreSession()` (`token.go`) **prefers account credentials**: `listAccounts`, filtered by the templateId prefix `org.webosports.app.music.`, then `readCredentials {accountId, name:"common"}`. If that fails it falls back to `spotify-token.json`. Each refreshed token is written back to the account with `writeCredentials`. Credentials can come back in three nesting shapes (direct, `{credentials:…}`, `{common:…}`), and both `creds.go` and `accountmanager.js` normalise all three.

### Flags (`service/main.go`)

| Flag | Default |
|---|---|
| `-addr` | `127.0.0.1:8730` |
| `-librespot-name` | `webOS` (Connect device name to auto-select) |
| `-client-id` / `-client-id-file` | `""` / `/media/cryptofs/spotify-webos/spotify-client-id` (read **once at startup**) |
| `-redirect` | `http://127.0.0.1:8730/auth/callback` |
| `-token-file` | `/media/cryptofs/spotify-webos/spotify-token.json` |

### HTTP endpoints (all JSON, CORS `*` except where noted)

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /providers` | — | `{providers:[{id,name}]}`; Spotify is hidden until a session exists |
| `GET /provider/<id>/search` | `q`, `limit` (default 50; Spotify clamps to 10) | `{tracks:[providerTrack]}`; 502 on upstream error |
| `POST /provider/<id>/play` | `{trackId, format?}` | `{ok:true}`; **409** if the provider has no stream URL (Spotify) |
| `POST /provider/<id>/resolveVideo` | `{trackId}` | `{url}` / 409 |
| `POST /stream/pause` `/resume` `/stop` | — | `{ok:true}` (SIGSTOP/SIGCONT/SIGKILL the pipeline process group) |
| `GET /stream/status` | — | `{is_playing, position_ms, ended, format, formats}` |
| `POST /stream/switchformat` | `{format}` | restarts the current track in that format (no position resume) |
| `GET /login` | — | 302 to the Spotify authorize URL (412 without a client id); no CORS |
| `GET /auth/login` | — | `{authUrl}` |
| `GET /auth/callback` | `code, state` | HTML "Spotify connected"; starts librespot; no CORS |
| `GET /auth/status` | — | `{authenticated}` |
| `GET /auth/token` | — | `{accessToken, refreshToken, expiry}` for the validator |
| `GET /me` | — | Spotify profile (used for the account username) |
| `POST /session` | `{access_token, refresh_token, token_type?, expiry}` | `{ok:true}`; installs the token and starts librespot |
| `GET /search` | `q, type, limit` | Spotify-only legacy search |
| `GET /browse/album?id=` / `/browse/artist?id=` / `/me/playlists` | | Spotify browse |
| `POST /player/load` | `{uri, position_ms}` | `{ok, duration_ms}`; 409 if no librespot device |
| `POST /player/play` `/pause` `/next` `/prev` | — | `{ok}` |
| `POST /player/seek` | `{position_ms}` | `{ok}` |
| `POST /player/volume` | `{volume}` 0–100 | `{ok}` |
| `GET /player/status` | — | `{is_playing, position_ms, duration_ms, uri, state, format:"OGG 320"}` |
| `/ytauth/start` `/poll` `/status` | | Google device-code login (optional) |
| `/tidalauth/start` → `{authorize_url}`, `/tidalauth/exchange {code}` → `{ok, username?}`, `/tidalauth/status` | | |
| `/appleauth/login` (HTML), `/appleauth/save {musicUserToken}`, `/appleauth/status` → `{authenticated, hasCDM}`, `/appleauth/done` | | |
| `POST /qobuzauth/login {email,password}` / `POST /dzauth/login {email,password}` / `POST /dzauth/save {arl}` | | `{ok, username}` |
| `GET /dzstream?id=` `/tidalstream?id=` `/applestream?id=` | | decrypted/reassembled audio for gst (no CORS) |
| `GET/POST /download/providers`, `/download` | | see Lossless |

After a successful credential POST, `refreshFirstPartyServices()` hot-registers the provider (Qobuz, Tidal, Deezer or Apple) **without restarting** the daemon.

### Process model and audio sink

- The daemon spawns **librespot** (`/media/cryptofs/spotify-webos/librespot`) in a restart loop (`service/librespot.go`) with `--backend subprocess --bitrate 320 --dither none --autoplay off --initial-volume 100 --volume-ctrl linear --system-cache …/librespot-cache`. It passes `--access-token` when it has one. Any stale `librespot`/`gst-launch-0.10` left by a previous run is killed first. The subprocess sink is:

```
gst-launch-0.10 fdsrc fd=0 ! queue max-size-buffers=0 max-size-bytes=176400 max-size-time=0 !
  audio/x-raw-int,rate=44100,channels=2,width=16,depth=16,signed=true,endianness=1234 !
  audioconvert ! pulsesink stream-properties=s,media.role=music buffer-time=500000 latency-time=50000
```

- Stream-URL providers use `sh -c "curl -sL --retry 2 '<url>' | gst-launch-0.10 fdsrc fd=0 ! decodebin ! audioconvert ! ffaudioresample ! audio/x-raw-int,rate=48000,… ! pulsesink stream-properties=s,media.role=music …"`. The pipeline runs in its own process group (`Setpgid`) so that pause and resume can signal curl and gst together. `souphttpsrc` is not present on the device, which is why the pipeline uses `curl | fdsrc`.
- Outbound HTTP timeouts in the code are: luna-send 6 s, YouTube 25 s (URL probe 6 s), Deezer 25 s, Qobuz 30 s, Apple 20 s for the token fetch and 60 s for playback.

### Starting it

On the TouchPad / legacy webOS this is an upstart job, `deploy/spotify-webos-service.upstart`, installed to `/etc/event.d/spotify-webos-service`:

```
start on started LunaSysMgr
stop on stopping LunaSysMgr
respawn
exec /media/cryptofs/spotify-webos/spotify-webos-service -addr 127.0.0.1:8730
```

It runs as root with no jail. All of its state lives in `/media/cryptofs/spotify-webos/` (`service/paths.go`).

### The accept4 hang (twice fixed)

On the 2.6.35 TouchPad kernel the daemon logged "listening" but never accepted a single connection. Go (1.25 here) always calls `accept4`, and the ARM syscall table on that kernel never wires up syscall 366. There have been two fixes:
1. A kernel patch adding `CALL(sys_accept4)` to `arch/arm/kernel/calls.S` (`service/README.md`, `docs/ROADMAP.md`).
2. A userspace fix (commit 65675f2), which is the one in use now. `service/main.go`'s `rawAcceptListener` duplicates the listener fd and calls `syscall.SYS_ACCEPT` directly, retrying on `EINTR`/`ECONNABORTED`. **Do not switch back to `http.ListenAndServe` or any plain `net.Listen().Accept()`.**

---

## Packaging

Built with `./build.sh` (base) and `./deploy/build-connector-ipk.sh <provider>` (one per provider). Both produce plain `ar` ipks with `debian-binary`, `control.tar.gz` and `data.tar.gz`, and both **require Preware or WebOS Quick Install**, because `palm-install` never runs `postinst`.

| Package | Contents | postinst does |
|---|---|---|
| `org.webosports.app.music_<ver>_all.ipk` (base) | Enyo app + musicauth app (as `payload.tar.gz` + `dest.txt`) + ARM daemon + upstart job, staged under `media/cryptofs/music-overwrite/org.webosports.app.music/` | finds the overwrite tree (at the direct path **or** the offline-root path `/media/cryptofs/apps/media/cryptofs/…`), extracts the apps into `/media/cryptofs/apps/usr/palm/applications/<id>` (fails loudly on an empty extraction), installs the daemon to `/media/cryptofs/spotify-webos/`, copies the upstart job to `/etc/event.d/` (remount rw/ro), runs `ls-control scan-services`, `applicationManager/rescan`, and restarts the job. A second invocation (WOSQI runs it twice) is a no-op. |
| `org.webosports.app.music.<provider>_<ver>_all.ipk` | the account template + icons, staged under `media/cryptofs/music-overwrite/<pkg-id>/connector-payload/accounts/`; `packageinfo.json` with `"app": "org.webosports.app.musicauth"` | copies the template to `/usr/palm/public/accounts/`, nudges the Accounts service (`registerServerStatus` signal for `com.palm.service.accounts[.mojoservice]`, then restarts `LunaSysService`), and optionally decodes a bundled secret |

The connector `prerm` removes only that template. The base `prerm` stops the daemon, removes the job, the binary and both app directories, and **keeps** `/media/cryptofs/spotify-webos/` (tokens).

**Secrets bundling** (commit 7daa30e): if `deploy/secrets/<file>` exists on the build host (the directory is gitignored), the connector postinst gets the file base64-encoded inside a heredoc:

| Provider | Secret file | Installed to | Daemon restart |
|---|---|---|---|
| spotify | `spotify-client-id` | `/media/cryptofs/spotify-webos/spotify-client-id` | yes |
| apple | `device.wvd` | `/media/internal/device.wvd` | no |
| jamendo | `jamendo-clientid` | `/media/cryptofs/spotify-webos/jamendo-clientid` | yes |

⚠️ An ipk built this way **contains the secret in plain base64**. Treat it as personal and never publish it. Without a bundled secret, follow `docs/PROVISIONING.md` and push the file with novacom.

**Not packaged anywhere:** the **librespot binary**. `build.sh` ships only the Go daemon, and `startLibrespot()` logs "librespot not found … playback disabled" if `/media/cryptofs/spotify-webos/librespot` is missing. `docs/INSTALL.md` does not mention this.

### LuneOS vs TouchPad

| Aspect | TouchPad / legacy webOS 3.0.x | LuneOS |
|---|---|---|
| Bus permissions for the apps | permissive dev bus; `luna-send -a` works without a role (`deploy/ls2-roles/*.json` comment) | ACG: `requiredPermissions` in `appinfo.json` (commit 862d3dd). Without it `webos_app_generate_security_files.bbclass` generates an empty grant. |
| App `requiredPermissions` | ignored | `accountsservice.operation, audio.management, audio.operation, database.operation, luna-sysmgr.operation` |
| musicauth `requiredPermissions` | ignored | `accountsservice.management, accountsservice.operation, networkconnection.query` |
| Daemon start | upstart `/etc/event.d` | **unverified**. The repo has no systemd unit and no LuneOS recipe. |
| gst-0.10 / `pulsesink media.role=music` / `ffaudioresample` | verified on-device (topaz) | **unverified** |
| `luna-send -a <id>` from the daemon under ACG | — | **unverified**. It may need an ACG grant for the claimed id. |

`com.palm.service.mediabroadcast` and `com.palm.filenotifyd` have no ACG group on LuneOS, so the app claims nothing for them (commit 862d3dd).

---

## Build

```bash
# Daemon (build.sh does exactly this; toolchain path is configurable via GOROOT_BIN)
cd service && GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o spotify-webos-service .
```

- `go.mod`: `go 1.25.0`. Direct dependencies are `zmb3/spotify/v2 v2.4.3`, `golang.org/x/oauth2 v0.18.0`, `iyear/gowidevine v0.1.3` (Apple), `dop251/goja` (YouTube cipher JS) and `dlclark/regexp2/v2`.
- `CGO_ENABLED=0` gives a static binary, so no Yocto sysroot is needed. Only ARMv7 is built. aarch64/x86-64 builds are not scripted.
- **librespot**: `librespot-src/` is librespot **0.8.0** (`Cargo.toml`). `librespot/cargo-config.toml` targets `armv7-unknown-linux-musleabi` with linker `arm-unknown-linux-musleabi-gcc` and `rustflags = ["-C","target-feature=+crt-static","-C","target-cpu=cortex-a9"]`, i.e. a static musl build. `librespot/README.md` and `ROADMAP.md` still say `arm-unknown-linux-gnueabihf`, which is out of date. The audio backend used at runtime is `subprocess`, so no ALSA or Pulse crate is needed.
- `build.sh` rewrites every `app/resources/**/appinfo.json` so its `id` and `version` match the main appinfo. The stock localized copies say `com.palm.app.musicplayer`, and LunaSysMgr silently refuses to register an app when that happens.

---

## Adding a Provider: Checklist

1. **Daemon**: create `service/<p>.go` implementing `MusicProvider` (`ID/Name/Search/StreamURL`). Return the normalised `providerTrack` with `Path: "<p>:<id>"`. If the stream is encrypted or segmented, return a `http://127.0.0.1:8730/<p>stream?id=` proxy URL and register that handler in `main.go` without `withCORS`.
2. **Register** it in `main()`. If it needs credentials, register it only when they exist and add it to `refreshFirstPartyServices()` so that a sign-in hot-registers it. Adjust `providerReady()` if needed.
3. **Credentials**: add `/<p>auth/*` handlers that validate the credentials before writing `spotifyDataDir/<file>` with mode 0600. Delete the file when validation fails.
4. **App routing**: add the prefix to `_streamRe` in `app/utility/audiorouter.js`. A provider that is missing there silently goes to the local HTML5 engine.
5. **Icons**: add `app/images/connectors/<p>.png` (tab) and `app-musicauth/images/connectors/<p>.png` (validator header). Both directories exist with one PNG per provider.
6. **Validator**: add a case in `modeFor()` / `configureForMode()` / `performPrimary()` in `app-musicauth/source/musicAuth.js`. Unknown ids fall through to "noauth", which just adds the account. Cap any polling loop.
7. **Account template**: add `deploy/accounts/org.webosports.app.music.<p>/org.webosports.app.music.<p>.json` plus `images/<p>-32x32.png` and `-48x48.png`. Copy an existing template and keep `capability:"Music"`, `STREAMING`, the musicauth `customUI` and the three permission ids.
8. **Connector ipk**: run `./deploy/build-connector-ipk.sh <p>`. If it needs a provisioned secret, add a `case` line for `SECRET_FILE`/`SECRET_DEST`/`SECRET_RESTART`.
9. Bump `VER` / the appinfo version so Preware re-runs `postinst`, and update `docs/INSTALL.md` / `PROVISIONING.md`.

---

## Gotchas

- **No `onDelete`.** Removing an account leaves the daemon's credential files, and the provider keeps working.
- **Spotify selection is "first music account with a refresh token".** `accountToken()` in `creds.go` does not filter on the Spotify templateId, but only Spotify accounts store a `refreshToken`, so in practice it picks Spotify. `accountmanager.js` filters explicitly on `org.webosports.app.music.spotify`.
- **The `ls2-roles` file is poison.** `deploy/ls2-roles/org.webosports.app.music.service.json` declares `exeName: /usr/bin/luna-send`, which duplicates the stock `com.palm.lunasend.json`. Installing it broke **every** `luna-send` on the device (`-1027 Invalid permissions for (null)`) until it was removed and the device rebooted. `build.sh` no longer ships it, but `deploy/ondevice-install-accounts.sh` still copies it. Don't run that script as-is.
- **Templates are cached** by the Accounts service. Dropping a file into `/usr/palm/public/accounts/` is not enough; send the `registerServerStatus` signal and restart `LunaSysService`.
- **Keep everything off `/media/internal`** except `device.wvd` and `Downloads`. A binary, open log or fd on that vfat partition blocks USB-drive mode ("USB drive Connection failed"), because `force-unmount.sh` will not kill it. See `deploy/relocate-to-cryptofs.sh`.
- **Upstart must `exec` directly.** A `sh -c '… >> log'` wrapper confused upstart's process tracking, leaving orphan instances fighting over port :8730 (commit 483a084).
- **Bounded gst queue is load-bearing.** With `max-size-bytes=0`, librespot dumped the whole track into RAM at 3–4× speed, hit end-of-track after about a minute, and playback stopped. The fix bounds the queue to 176400 bytes (about 1 s of PCM). Also `--autoplay off`, otherwise "resume" landed on a radio track.
- **Do not add a `queue` to the stream-URL pipeline.** A buffer added to work around Bluetooth hiccups made curl streams reach EOS about 5 s in (commit 483a084).
- **Spotify search limit is clamped to 10** (`searchLimitMax`). Larger values come back as "Invalid limit" errors, which surface as HTTP 502.
- **Secret transport on device**: BusyBox `echo "$big"` truncates large values, and OpenSSL 0.9.8 `base64 -d` outputs 0 bytes for one unwrapped multi-KB line. Use a heredoc and 76-column wrapping (commit 7daa30e).
- **Embedded WebView**: musicauth patches `enyo.BasicWebView` to `type="application/x-atlas-browser"` and loads the page with `callBrowserAdapter("openURL", ["atlas-simple:" + url])` (not `setUrl`; commit b367418). `onConnected` is unreliable on enyo 0.10, so there is a 3 s fallback timer. A "Keyboard" button toggles the VKB through `PalmSystem.setManualKeyboardEnabled(true)` (Apple sign-in, commit d24e446). Google blocks embedded-WebView login, which is why YouTube auth uses the device-code flow.
- **validator.html must not `<script>` the source directly.** `enyo.js` loads `depends.js` asynchronously, and a direct script tag races it and blanks the page.
- **Local library needs a DB8 grant.** The app is third-party, so reading `com.palm.media.audio.*:1` returns `-3963` until `deploy/provision-media-perms.sh` runs `putPermissions` while impersonating `com.palm.filenotifyd.js`. No postinst does this.
- **Tidal**: the device-code flow returns tokens that fail with 4005 ("Asset is not ready") on every track. Only the PKCE web-player token can stream (`tidaldl.go`). The header comment in `musicAuth.js` still describes device-code plus `/tidalauth/poll`, which does not exist. The code uses PKCE.
- **YouTube**: `providerReady("youtube")` is always true, so the tab always appears. Its account template was removed in c246525 and never restored, so there is no YouTube connector ipk, even though `docs/INSTALL.md` lists YouTube as "just add". The `ytcipher.go` (goja) path breaks whenever YouTube ships a new `base.js`.
- **Stream seek is unsupported** (`kindStreamManager.setAudioTime` is a no-op). Duration comes from provider metadata because gst reports none (commit 3774cf5).
- **Engine-switch pause quirk**: `kindAudioManager.pauseAudio(false)` pauses, while the librespot and stream managers ignore the flag and toggle. The router therefore pauses the outgoing engine only when that engine is actually playing.
- **Stale artifacts**: `build-output/` contains an `org.webosports.app.musicauth_*.ipk` from before musicauth was folded into the base ipk, and `CLAUDE.md` still says the daemon is installed "via ad-hoc scripts … rather than a signed ipk with postinst". Both predate commit f5b121a.
- **README "scaffold" status is out of date.** The code has working providers, account types and packaging. Some in-file `STATUS: scaffold` headers (`librespotmanager.js`, `spotifyindex.js`) are also outdated.
- **Amazon Music** exists only as a design sketch (`docs/amazon-provider.md`, a client for a third-party middleman). There is no `amazon*.go`.

---

## See Also

- `webos://knowledge/synergy-architecture`: one-page overview of the whole Synergy system; start here
- `webos://knowledge/synergy-internals`: how the framework works underneath (accounts service, lifecycle, Sync library)
- `webos://knowledge/synergy-messaging-connectors`: libpurple-based IM connectors (Messaging + Phone apps)
- `webos://knowledge/synergy-cloud-connectors`: cloud/file connectors (DOCUMENTS / PHOTO.UPLOAD)
- `webos://knowledge/synergy`: full Synergy connectors (templates with `implementation`/`onEnabled`/`onDelete`, `dbkinds`), for comparison with this callback-less "Music" capability
- `webos://knowledge/js-services`: what a real Luna service looks like, which this daemon deliberately is not
- `webos://knowledge/enyo`: Enyo 1.x kinds, `PalmService`, `CrossAppResult`, `WebView`
- `webos://knowledge/oauth`: OAuth/PKCE patterns on legacy webOS
- `webos://knowledge/ls2-roles`: why a second role file with the same `exeName` breaks the hub
- `webos://knowledge/postinst-packaging`: the overwrite-tree + `dest.txt` postinst pattern and the offline-root path doubling
- `webos://knowledge/tls-and-networking`: why crypto and TLS live in the Go daemon rather than the old browser
