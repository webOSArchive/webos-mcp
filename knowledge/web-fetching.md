# Fetching Data and Files from the Web

webOS apps have several mechanisms for making HTTP requests. The right choice depends on the framework (Mojo vs. Enyo), whether you're fetching data or downloading a file, and whether authentication is involved.

> **TLS caveat applies everywhere:** webOS's TLS stack is too old to negotiate TLS 1.2+ with most modern servers. Every approach listed below inherits this limitation. See `tls-and-networking.md` for workarounds (SSL-bump proxy, curl via a Node.js service).

---

## Decision Summary

| Situation | Recommended approach |
|-----------|---------------------|
| Fetching JSON/XML data in Enyo | XHR directly |
| Fetching JSON/XML data in Mojo | XHR directly |
| Convenience wrapper in Enyo | `enyo.WebService` |
| Calling a public web API from Mojo | `Mojo.Service.Request` with a URL |
| Downloading a large file (no auth) | Download Manager |
| Downloading a large file (with auth) | `curl` via a Node.js service |

---

## XHR (Recommended Default)

Plain `XMLHttpRequest` works in both Mojo and Enyo apps and is the right default for most API calls. It runs in the WebKit layer shared by all apps.

```javascript
var req = new XMLHttpRequest();
req.open("GET", "http://api.example.com/data.json", true);
req.onreadystatechange = function() {
    if (req.readyState === 4) {
        if (req.status === 200) {
            var data = JSON.parse(req.responseText);
            // handle data
        } else {
            // handle error
        }
    }
};
req.send();
```

**Capabilities and limits:**
- GET and POST work reliably. PROPFIND/MKCOL/PUT/DELETE are unreliable depending on webOS version.
- Respects the system proxy with no per-request override.
- Cannot skip TLS certificate verification.
- No control over `Authorization` headers beyond what the server will accept via URL-embedded credentials.

Use XHR when: you want JSON or XML from a simple API, the server is HTTP (not HTTPS), or you have a working SSL-bump proxy covering all traffic.

---

## `enyo.WebService` (Enyo Apps)

`enyo.WebService` is a declarative wrapper around XHR provided by the Enyo 1 framework. It adds convenience (automatic JSON parsing, Enyo-style event callbacks) but has the same underlying capabilities and limitations as raw XHR.

```javascript
// Declare in components array:
{ kind: "WebService", name: "myRequest",
  onSuccess: "handleSuccess", onFailure: "handleFailure" }

// Call it:
this.$.myRequest.call({ param: "value" }, "http://api.example.com/data.json");

// Handle response:
handleSuccess: function(inSender, inResponse) {
    // inResponse is already parsed if the server returns JSON
}
```

**Reference:** https://sdk.webosarchive.org/api/index.html#enyo.WebService

Use `enyo.WebService` as a stylistic choice in Enyo apps when you prefer the declarative component pattern. It offers nothing over XHR in terms of capability.

---

## `Mojo.Service.Request` with a Public URL (Mojo Apps)

Mojo's service framework can make outbound HTTP requests to public URLs — not just calls to on-device Luna services. The call goes through the system's network stack rather than WebKit.

```javascript
// For HTTP requests to external URLs:
this.controller.serviceRequest("palm://com.palm.downloadmanager/download", {
    method: "download",
    parameters: {
        target: "http://api.example.com/data.json",
        // ...
    }
});
```

**Reference:** https://sdk.webosarchive.org/docs/dev-guide/mojo/services-overview.html

`Mojo.Service.Request` to external URLs is most naturally expressed through the Download Manager service (see below). For simple data fetches, XHR is cleaner.

---

## Download Manager (`palm://com.palm.downloadmanager`)

The OS Download Manager handles large file downloads in the background, with progress tracking and resume support. It writes files directly to `/media/internal/downloads/` (or a path you specify) without buffering the entire file in app memory.

```javascript
// Enyo:
{ kind: "PalmService", name: "downloader",
  service: "palm://com.palm.downloadmanager/",
  method: "download",
  onSuccess: "downloadStarted",
  onFailure: "downloadFailed" }

this.$.downloader.call({
    target: "http://files.example.com/largefile.zip",
    mime: "application/zip",
    targetDir: "/media/internal/downloads/",
    targetFilename: "largefile.zip",
    subscribe: true
});
```

**Reference:** https://sdk.webosarchive.org/docs/reference/services/download-manager.html

### When to use it

- Files large enough that buffering in memory would be a problem (video, audio, archives).
- You want OS-level progress reporting or background download behavior.
- The file is publicly accessible (no authentication required).

### Authentication caveat

The Download Manager does **not** reliably pass HTTP authentication credentials. Even when credentials are embedded in the URL, some server implementations strip or ignore them. Do not use the Download Manager for authenticated downloads.

**Alternative for authenticated large downloads:** shell out to `curl -u user:pass` from a Node.js service. See `tls-and-networking.md` for the full curl pattern, flags, and timeout guidelines.

---

## See Also

- [tls-and-networking.md](tls-and-networking.md) — TLS limitations affecting all of the above, SSL-bump proxy setup, curl via Node.js service (the escape hatch for authenticated and HTTPS downloads)
- [js-services.md](js-services.md) — Writing the Node.js service that shells out to curl
- [services.md](services.md) — Full Luna bus services reference
