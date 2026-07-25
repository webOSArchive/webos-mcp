# TLS, Networking, and Proxy Workarounds

webOS ships with a TLS stack from 2009–2011. It cannot negotiate TLS 1.2+ connections, doesn't support modern cipher suites, and will fail to connect to virtually any HTTPS server on the modern internet. This affects all built-in networking — the browser, the download manager, XHR in apps, and most system services.

> **TouchPad exception:** The HP TouchPad (webOS 3.0.5) can do TLS 1.2/1.3 natively via the OpenSSL 1.1.1w update packages and first-party app patches from [OpenSSL-legacyWebOS](https://github.com/codepoet80/OpenSSL-legacyWebOS). See Solution 1 below. The stock stack described here still applies to unpatched TouchPads, unpatched components, and all other webOS devices.

---

## The Core Problem

webOS's OpenSSL is too old to complete TLS handshakes with servers that require:
- TLS 1.2 or 1.3 (most modern servers require this)
- Modern cipher suites (ECDHE, AES-GCM, etc.)
- SNI (Server Name Indication) — many shared hosting servers require it

The result: HTTPS connections silently fail or produce unhelpful errors. HTTP works fine.

---

## Solution 1: Modern TLS Updates (TouchPad — Preferred)

The TouchPad and TouchPad Go (webOS 3.x) no longer need any of the workarounds below. Community-built packages install OpenSSL 1.1.1w alongside the stock stack and patch the first-party apps to use it, giving the device native TLS 1.2 and 1.3 with modern cipher suites and SNI.

- **Source:** https://github.com/codepoet80/OpenSSL-legacyWebOS (the OpenSSL build and app patches)
- **Distribution:** the Preware "modernize" feed — https://github.com/webOSArchive/preware-modernize-feed (feed URL: `http://stacks.webosarchive.org/feeds/modernize/ipkgs/`)
- **User install guide:** https://docs.webosarchive.org/modern-tls/

### How users install it

In Preware (recent versions ship with the modernize feed preconfigured), search for **"TLS 1.3 Updates"** and install it. That meta-package pulls in the current root-certificates update and the individual patches, then reboots the device. Accurate device date/time is required — TLS validation fails with a wrong clock (the feed includes an `ntpdate-sync` package that syncs at boot).

### What gets modern TLS after installation

- **Browser** (`browser-tls13` — patches `BrowserServer`)
- **App WebKit layer** (`luna-tls13` — patches the `LunaSysMgr`/`WebAppMgr` launcher, so XHR in Mojo/Enyo apps speaks TLS 1.3)
- **curl** (`curl-tls13` — modern curl at `/usr/bin/curl`, stock binary backed up to `/usr/bin/curl.0.9.8-orig`)
- **Download manager** (`downloadmgr-tls13`)
- **Email** (`mail-tls13`, optional — EAS, IMAP, POP, and SMTP through the modern stack)

### What still uses the stock TLS 1.0 stack

Wi‑Fi/VPN/EAP authentication, `keymanager`, `PmNetConfigManager`, OTA/app-catalog fetches, the system `/usr/lib/libcurl.so.4`, and Node.js services intentionally remain on the original OpenSSL 0.9.8. For Node services, keep using the shell-out-to-curl pattern below — with the updates installed, curl itself is modern.

**Once installed, no proxy is needed** — patched TouchPads connect to modern HTTPS servers directly, and previously configured proxies/OpenSSL workarounds can be removed. The rendering engine is unchanged, though: modern sites may still break on old JavaScript/CSS support, and bot-detection walls can still block the old WebKit.

The solutions below remain necessary for **all other webOS devices** (Pre, Pixi, Veer — webOS 1.x/2.x) and for unpatched TouchPads.

---

## Solution 2: SSL-Bump Proxy (Other Devices / Unpatched Systems)

An SSL-bumping proxy (typically Squid) sits between the webOS device and the internet. The device connects to the proxy over HTTP or old TLS; the proxy upgrades to modern TLS for the outbound connection and re-signs the server's certificate with a locally-trusted CA.

From the device's perspective: it's talking to something it can handle. From the server's perspective: it's talking to a modern client.

### Setup options

**On-network (home/office):** A Squid proxy running on a local machine or NAS. The device's network settings point to it. Works transparently for all apps.

**On-device:** Squid can be installed on the webOS device itself, running locally. The device proxies to itself. More portable — works away from a home network.

The webOS Archive maintains a pre-built Squid port for webOS: https://github.com/webosarchive/squid-for-webos

### Configuring the system proxy on webOS

Set via the device's WiFi settings (proxy hostname + port). All network-aware system services and the browser will respect this. Third-party apps must explicitly handle it.

---

## Solution 3: Per-Request Tool Selection

Not all tools respect the system proxy equally, and some use cases (local network servers) should **bypass** the proxy. The right approach is to let the user choose per-server and route to the appropriate tool:

| Scenario | Right tool | Proxy behavior |
|---|---|---|
| External HTTPS server, system proxy configured | `curl` (default) | Respects `http_proxy` env var / system proxy |
| Local network server (no proxy needed) | `curl --noproxy '*'` | Bypasses proxy entirely |
| Download via system proxy fallback | `wget` | Respects system proxy |
| Directory listing (WebDAV PROPFIND) | `curl` | Full control over headers and proxy |
| Authenticated download without service | `palm://com.palm.downloadmanager` | **Broken** — see below |

### The webOS Download Manager Auth Bug

`palm://com.palm.downloadmanager` does not properly pass HTTP Basic Auth credentials to servers that require them (e.g., ownCloud, NextCloud). Even when credentials are embedded in the URL, the download manager strips or ignores them on some server implementations.

**Solution:** Use a native Node.js service that shells out to `curl` with explicit `-u user:pass` authentication. This bypasses the download manager entirely for authenticated transfers.

---

## curl on webOS

`/usr/bin/curl` is available on webOS devices set up for homebrew. It is significantly newer than the system's OpenSSL/TLS stack, and with `-k` (insecure), it will skip certificate verification — which is necessary when using an SSL-bump proxy (whose cert the device doesn't fully trust) or when connecting to HTTP-only servers.

On a TouchPad with the TLS updates installed (Solution 1), `/usr/bin/curl` is a modern curl (7.88+) linked against OpenSSL 1.1.1w with a current CA bundle — TLS 1.3 works directly, and `-k` is only needed for self-signed certs or a bump proxy.

### Key curl flags for webOS

```bash
-k                      # Skip SSL certificate verification (required for SSL-bump proxy)
-s                      # Silent (no progress meter to stderr)
-S                      # Show errors even with -s
-f                      # Fail on HTTP errors (4xx/5xx) — curl exits non-zero
-w "%{http_code}"       # Write HTTP status code to stdout after response body
--noproxy "*"           # Bypass system proxy for this request
-u "user:pass"          # HTTP Basic Auth via Authorization header
--progress-bar          # Show progress without cluttering stdout
```

### Credential embedding vs `-u` flag

There are two ways to pass HTTP Basic Auth to curl:

**Embed in URL** (works for GET/PROPFIND/MKCOL/DELETE):
```bash
curl -k "https://user:pass@server/path"
# Encode special chars: encodeURIComponent(user) + ":" + encodeURIComponent(pass)
```

**`-u` flag** (use for PUT uploads):
```bash
curl -k -u "user:pass" -X PUT --data-binary "@/path/to/file" "https://server/path"
```

> **Critical quirk:** On old webOS curl, URL-embedded credentials do **not** work reliably for `PUT` requests. Use `-u` for uploads. For GET/PROPFIND/MKCOL, either approach works — embedding in the URL avoids credential exposure in process listings.

### Shell-escaping credentials

Passwords can contain special characters. In a service that builds commands as strings (rather than argv arrays), escape before interpolating:

```javascript
CommandLine.prototype.shellEscape = function(str) {
    if (!str) return "";
    return str.toString()
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`');
};
```

Note: `!` in passwords does **not** need escaping when the string is double-quoted and not run interactively.

### Extracting HTTP status from curl

Use `-w` to append the HTTP code and parse it out of stdout:

```bash
curl -k -s -S -f -w "\n__HTTP_CODE__:%{http_code}" "https://server/path"
```

Parse in Node.js:
```javascript
var match = stdout.match(/__HTTP_CODE__:(\d+)$/);
var httpCode = match ? match[1] : null;
var body = stdout.replace(/\n?__HTTP_CODE__:\d+$/, "");
```

---

## wget on webOS

`/usr/bin/wget` is also available and respects the system proxy. It's an old version. While its simpler than curl for straight downloads it lacks:
- Custom HTTP methods (can't do PROPFIND, MKCOL, DELETE, PUT)
- Fine-grained proxy control (can't bypass the proxy per-request without env var tricks)
- HTTP code extraction

Use wget as a fallback for simple downloads when the user has a proxy configured and curl has issues. Prefer curl for all WebDAV operations.

```bash
wget --no-check-certificate \
     --user="username" --password="password" \
     -O "/media/internal/downloads/filename" \
     "https://server/path/to/file"
```

---

## XHR in webOS Apps (Browser/Enyo Layer)

webOS apps can use `XMLHttpRequest` for HTTP calls. This goes through the WebKit networking stack, which shares the same ancient TLS as the system — unless the TouchPad TLS updates are installed, in which case the `luna-tls13` patch gives app XHR modern TLS 1.2/1.3. Remaining limitations (which apply even when patched):

- **No custom HTTP methods**: XHR can do GET and POST but not PROPFIND, MKCOL, DELETE, or PUT (at least not reliably in all webOS WebKit versions)
- **No proxy bypass control**: XHR respects the system proxy with no way to override it per-request
- **Auth header limitations**: Some servers require `Authorization: Bearer` or specific auth flows that XHR can't easily express
- **No certificate control**: Can't skip TLS verification from XHR

XHR works for: reading XML responses, parsing JSON APIs, calling HTTP-only services, and simple authenticated GETs where the server accepts credentials in the URL.

**Pattern:** Use XHR for PROPFIND directory listing as a fallback when the native service is unavailable. Use the native service (curl) as the primary path for all authenticated operations:

```javascript
// Check native service first; fall back to XHR
if (serviceAvailable) {
    webdavService.list(options, onSuccess, onFailure);
} else {
    // XHR fallback — may fail with authentication on some servers
    davReq.getDirList(path, handler);
}
```

---

## Native Node.js Service for Network Operations

Shelling out to `curl` from a Node.js service is the most reliable way to handle authenticated, proxy-aware HTTPS on webOS. The service pattern:

```javascript
// In a webOS Node.js service (webdav-assistant.js style):
var require = IMPORTS.require;
var childProcess = require("child_process");

function execCurl(command, callback, timeout) {
    childProcess.exec(command, {
        encoding: 'utf8',
        timeout: timeout || 300000,    // 5 min default
        maxBuffer: 1024 * 1024,
        killSignal: 'SIGTERM'
    }, function(error, stdout, stderr) {
        callback(error, stdout, stderr);
    });
}
```

**Timeout guidelines:**
- Directory listings (PROPFIND): 60 seconds
- Metadata operations (mkdir, delete): 30 seconds
- File transfers (download/upload): 600 seconds (10 minutes) — large files over slow WiFi

---

## Per-Server Proxy Bypass

The key design insight: whether to use the proxy is a **per-server setting**, not a global one. Local network servers don't need the proxy (and routing them through it adds unnecessary latency or may break). External internet servers need the proxy for TLS.

Store a `useProxy` boolean in each server's configuration. Pass it through to every curl invocation:

```javascript
// In server config storage (localStorage):
{ servername: "192.168.1.10", ..., useProxy: false }  // local server
{ servername: "cloud.example.com", ..., useProxy: true } // internet server

// In curl command builder:
if (!useProxy) {
    args.push("--noproxy", '"*"');
}
```

**Default:** `useProxy: true` — safer default. Prompts users to explicitly opt out for local servers rather than assuming they know about the proxy.

**UI:** Present as a "Use System Proxy" checkbox in the server configuration dialog, checked by default.

---

## Service Registration (for Network Services)

webOS Node.js services that make outbound network calls need proper registration. Several non-obvious requirements:

### Use `run-homebrew-js-service`, not `run-js-service`

The standard `run-js-service -n` causes jail mount failures for third-party services installed outside the normal Luna framework. The homebrew infrastructure provides `run-homebrew-js-service` which handles this correctly.

```json
// service/services.json
{
  "services": [{
    "name": "com.example.myapp.service",
    "commands": [{ "name": "download", "assistant": "DownloadAssistant" }]
  }]
}
```

The service runner is set in the service descriptor or the `package/postinst` script.

### postinst Script Required for Service Registration

`palm-package` does not inject `postinst`/`prerm` scripts into the IPK control archive. If your service requires post-install registration, you must manually inject these scripts:

```bash
# In build.sh:
palm-package com.example.myapp
# Now manually inject postinst into control.tar.gz:
ar x com.example.myapp_1.0.0_all.ipk
tar xzf control.tar.gz
cp package/postinst .
tar czf control.tar.gz control postinst prerm
ar r com.example.myapp_1.0.0_all.ipk control.tar.gz
```

### Install via webOS Quick Install, not palm-install

`palm-install` skips post-install scripts. Use webOS Quick Install (or Preware) to install apps that have services requiring registration. The `postinst` script must:

1. Copy service files to `/media/cryptofs/apps/usr/palm/services/com.example.myapp.service/`
2. Register D-Bus service in `/var/palm/ls2/services/prv/` and `/var/palm/ls2/services/pub/`
3. Install role files in `/var/palm/ls2/roles/prv/` and `/var/palm/ls2/roles/pub/`
4. Run `ls-control scan-services` to refresh the service registry

**Role files** (`roles.json`) grant Luna Service Bus permission for inbound connections. Without them, the service registers but callers receive permission errors.

---

## WebDAV-Specific Patterns

### PROPFIND for directory listing

```bash
curl -k -s -S -f \
  -X PROPFIND \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:allprop /></D:propfind>' \
  -w "\n__HTTP_CODE__:%{http_code}" \
  "https://user:pass@server/path/"
```

Always append a trailing `/` to directory URLs for PROPFIND. Without it, some servers return 301 or list incorrectly.

### MKCOL for mkdir

```bash
curl -k -u "user:pass" -X MKCOL "https://server/path/new-folder/"
```

HTTP 405 from MKCOL means the directory already exists (not a general failure).

### PUT for upload

```bash
curl -k -u "user:pass" -X PUT --data-binary "@/media/internal/file.pdf" "https://server/path/file.pdf"
```

ownCloud/NextCloud: uploading to the root of the WebDAV share returns 405. Users must navigate into a folder first.

### Credentials with special characters

Passwords containing `@`, `:`, `/`, or other URL-special characters must be `encodeURIComponent`-encoded when embedded in URLs. The `-u` flag handles these correctly without encoding:

```javascript
// URL embedding — encode first
var encodedUser = encodeURIComponent(username);
var encodedPass = encodeURIComponent(password);
var url = protocol + "://" + encodedUser + ":" + encodedPass + "@" + server + path;

// -u flag — no encoding needed, but shell-escape the string
args.push("-u", '"' + shellEscape(username + ":" + password) + '"');
```

### Two-factor authentication / App Passwords

If the server uses 2FA (e.g., ownCloud, NextCloud), HTTP Basic Auth with the account password won't work. Instruct users to generate an **App Password** via the server's security settings and use that instead.

---

## Data Migration from MojoDB to localStorage

If an older version of your app stored data in MojoDB (webOS's built-in JSON database), migrate on first launch to `localStorage` which is more reliable for simple key-value preferences:

```javascript
// On startup: check localStorage first, then MojoDB
var savedData = Prefs.getCookie("mydata", null);
if (savedData) {
    // Use localStorage data
} else {
    // Try reading from MojoDB, then save to localStorage and clear DB
    db = openDatabase('MyAppDB', '1.0', 'My App', 2000);
    db.transaction(function(tx) {
        tx.executeSql("SELECT * FROM mytable", [], function(tx, results) {
            // Migrate results to localStorage
            Prefs.setCookie("mydata", migratedData);
            Prefs.setCookie("ignoreDB", true);
            // Drop old table
            tx.executeSql("DROP TABLE mytable");
        });
    });
}
```

The `Prefs` pattern used in this codebase is a thin `localStorage` wrapper — store anything JSON-serializable as a named cookie:

```javascript
var Prefs = {
    getCookie: function(name, defaultValue) {
        var item = localStorage.getItem(name);
        return item !== null ? JSON.parse(item) : defaultValue;
    },
    setCookie: function(name, value) {
        localStorage.setItem(name, JSON.stringify(value));
    }
};
```

---

## Reference Project

- **OpenSSL-legacyWebOS** — OpenSSL 1.1.1w + TLS 1.3 patches for TouchPad first-party apps (browser, app WebKit, curl, email): https://github.com/codepoet80/OpenSSL-legacyWebOS
- **Preware modernize feed** — distributes the TLS updates and other modernized packages; feed URL `http://stacks.webosarchive.org/feeds/modernize/ipkgs/`: https://github.com/webOSArchive/preware-modernize-feed
- **Modern TLS install guide** — end-user instructions for installing the updates via Preware: https://docs.webosarchive.org/modern-tls/
- **webOS WebDAV Client** (`com.aventer.webdavclient`) — Enyo 1 app with Node.js service, curl/wget tool selection, per-server proxy bypass, MojoDB→localStorage migration: https://github.com/codepoet80/webos-webdavclient
- **Squid for webOS** — SSL-bumping proxy for on-device or local-network TLS upgrade: https://github.com/webosarchive/squid-for-webos

---

## See Also

- `webos://knowledge/pwa-portability` — multi-platform Enyo 2 builds; CSP and networking gotchas for Android/web targets
