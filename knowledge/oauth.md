# OAuth on webOS — the Broker Workaround

Modern sign-in is effectively impossible to do **on** a webOS device, for two independent reasons:

1. **TLS is too old.** The 2009-era stack can't complete a handshake with today's OAuth endpoints (see `webos://knowledge/tls-and-networking`). The device often can't even *reach* the provider's token endpoint. (A TouchPad with the community TLS 1.3 updates *can* reach modern endpoints — but reason 2 still applies, so the broker pattern remains necessary.)
2. **The browser is too old.** Neither the built-in WebView nor sideloaded browsers can render a modern consent screen — they go blank at the "Approve" step. The TLS updates don't change the rendering engine.

So the device can neither talk to the provider nor show the provider's login page. **Anything that tries to do OAuth on the device is doomed.** Don't try to embed a WebView login, don't ship the client secret, don't run a redirect listener on `127.0.0.1`.

The community solution is a small hosted helper — the **OAuth broker** at `https://oauth.wosa.link` — that does all the OAuth on the device's behalf. The device's job shrinks to: *show a code, then poll for the answer.*

---

## The pattern

```
 device                     broker (oauth.wosa.link)              provider
 ──────                     ────────────────────────              ────────
  │  get a code   ─────────►  mint "BKF7Q", remember it
  │  show:                                                         (all the
  │   "go to oauth.wosa.link/<app>                                  modern-TLS
  │    and enter BKF7Q"                                             + consent-page
  │                          ◄── user visits on a phone/PC          work happens
  │                              enters code, approves ────────────► here, in a
  │                              broker swaps code→tokens ◄────────  real browser)
  │  poll check-code ──────►  tokens ready → hand them over once
  │  store tokens, done
  │  refresh later ───────►  broker refreshes with the secret ───► provider
```

**Key properties**

- The device only ever talks to the broker (HTTPS the device *can* reach, or reachable through the user's SSL-bump proxy — see `webos://knowledge/tls-and-networking`).
- The consent screen renders in the user's *real* browser, on a *different* device.
- The **client secret lives only on the broker**, never in the shipped `.ipk`.
- Access tokens are refreshed through the broker too, so the secret stays server-side.
- Activation codes are short, single-use, drawn from an unambiguous alphabet (safe to read aloud), and expire quickly.

---

## Two flows, one broker

Different services authenticate differently. Each app is configured on the broker with a `flow`:

| `flow`            | For                                   | User does on the helper page          | Tokens                 |
|-------------------|---------------------------------------|---------------------------------------|------------------------|
| `oauth2_authcode` | Modern OAuth 2.0 (Box, Google, Dropbox, Reddit, Microsoft, …) | enters the code, then approves consent | ~1h access + refresh   |
| `oauth1_xauth`    | Legacy OAuth 1.0a xAuth (Instapaper)  | enters the code + provider user/password | long-lived, no refresh |

Both produce the **same device experience**: show a code, poll, receive tokens. Your device code barely changes between them — only which token fields you read out of the final JSON.

---

## Endpoints

All take `?app=<name>` (a pretty `/<app>/…` form also works if the broker's rewrite is enabled). The device only ever calls three of these; the rest run in the user's browser.

| Endpoint         | Called by          | Purpose                                                        |
|------------------|--------------------|----------------------------------------------------------------|
| `get-code.php`   | **device**         | mint a code → `{code, useUrl, pollSeconds, flow, appTitle}`     |
| `check-code.php` | **device** (poll)  | `{status:"pending"}` → `{status:"ready", …tokens}`, then `404`  |
| `refresh.php`    | **device**         | refresh an OAuth2 access token server-side (oauth2 only)        |
| `activate.php`   | user's browser     | the "enter your code" page (pretty URL: `/<app>`)              |
| `start.php`      | user's browser     | form target → xAuth exchange, or redirect to the provider      |
| `callback.php`   | provider → browser | exchange the auth code, park the tokens (oauth2 only)          |

### Response shapes

`get-code.php` →
```json
{ "code":"BKF7Q", "useUrl":"https://oauth.wosa.link/myapp",
  "pollSeconds":3, "flow":"oauth2_authcode", "appTitle":"My App" }
```

`check-code.php` while waiting → `{ "status":"pending" }`

`check-code.php` when done (**returned exactly once, then the record is deleted**):
- oauth2_authcode → `{ "status":"ready", "access_token":"…", "refresh_token":"…", "expires_in":3600, "token_type":"bearer" }`
- oauth1_xauth → `{ "status":"ready", "oauth_token":"…", "oauth_token_secret":"…", "username":"…" }`

`check-code.php` for an unknown/expired code → **HTTP 404**. Treat 404 as "this code is dead, get a new one" — *not* as a transient error to keep polling.

`refresh.php` → `{ "status":"ready", "access_token":"…", … }`, or `{ "status":"invalid_grant" }` when the refresh token is truly dead (a real logout). Anything else is transient — keep the tokens you have.

---

## The device side (the whole integration)

ES5 only — 2009 WebKit, so **no** `let`/`const`, arrow functions, `Promise`, `fetch`, or template literals. `var` and callbacks. Three moves:

```javascript
var BROKER = 'https://oauth.wosa.link';
var APP    = 'myapp';                 // your slug, registered with the broker

function brokerGet(path, cb) {
    enyo.xhr.request({ url: BROKER + path, method: 'GET',
        callback: function (resp, xhr) {
            var j; try { j = JSON.parse(xhr.responseText); } catch (e) { j = null; }
            cb(j, xhr);
        }
    });
}

// 1) Ask for a code and show it
brokerGet('/get-code.php?app=' + APP, function (j) {
    if (!j || !j.code) { /* show error */ return; }
    showToUser('Go to ' + j.useUrl + ' and enter code: ' + j.code);
    poll(j.code);
});

// 2) Poll until the user finishes (every ~1.5s feels instant; the broker's
//    pollSeconds is a floor, not a rule — polling a bit faster is fine)
function poll(code) {
    var t = setInterval(function () {
        brokerGet('/check-code.php?app=' + APP + '&code=' + code, function (j, xhr) {
            if (j && j.status === 'ready') {          // 3) store tokens
                clearInterval(t);
                // oauth2:  j.access_token / j.refresh_token
                // oauth1:  j.oauth_token / j.oauth_token_secret / j.username
                localStorage['myapp.access']  = j.access_token || j.oauth_token;
                localStorage['myapp.refresh'] = j.refresh_token || '';
                proceedIntoApp();
            } else if (xhr && xhr.status === 404) {
                clearInterval(t);                     // code expired — start over
            }
            // else: pending — keep polling
        });
    }, 1500);
}

// Later, when an OAuth2 access token expires (oauth1 tokens never do):
brokerGet('/refresh.php?app=' + APP + '&refresh_token=' + encodeURIComponent(rt),
    function (j) {
        if (j && j.status === 'ready')              { /* save j.access_token */ }
        else if (j && j.status === 'invalid_grant') { /* real logout */ }
        else                                        { /* transient — keep tokens */ }
    });
```

### Device-side gotchas

- **Poll in the background; don't make the user press "Verify."** Auto-poll every ~1.5s and only surface a manual "Check now" button as a fallback. (An early version made the user tap Verify and it confused everyone — the app *had* signed in, it just didn't say so.)
- **404 means expired, not "try again."** Stop polling and offer a fresh code.
- **Show the code + URL inline, not in a `ModalDialog`.** Old Enyo creates a dialog's children lazily, so `this.$.child.setContent(...)` before it opens throws `setContent of undefined`. Plain inline controls exist from `create()`. (See `webos://knowledge/gotchas`.)
- **Register every new JS file** (`depends.js` for Enyo, `sources.json` for services) or it silently won't load.
- **Never ship the client secret.** It lives only on the broker. The app holds only the (public) `app` slug — and, for oauth1 apps, the provider *consumer key/secret* used to sign per-request API calls, which must match the consumer the broker uses.

---

## Getting your app onto the shared broker

You **do not run your own broker.** `oauth.wosa.link` is a shared community service, and its code lives at **`github.com/webOSArchive/oauth-broker-for-webos`**. To add an app, open a **pull request** there adding `apps/<yourslug>/config.example.php` (copy the repo's `apps/_example/config.php`). Put the **non-secret** parts in the PR:

- **App slug** — the short name you'll pass as `?app=` (e.g. `myapp`), and the folder name.
- **Flow** — `oauth2_authcode` or `oauth1_xauth`.
- **Display title** (shown on the helper page and device).
- **OAuth2:** your public `client_id`, the provider's `authorize_url` and `token_url`, any `scope`, and any extra authorize params (e.g. Google needs `access_type=offline&prompt=consent` to return a refresh token).
- **OAuth1 xAuth:** your `consumer_key` and the provider's `access_token_url`.

**Secrets never go in the PR.** The `client_secret` / `consumer_secret` live only in the git-ignored `apps/<slug>/config.php` on the server; the maintainer arranges to receive yours privately while reviewing. For **OAuth2**, the maintainer also registers `https://oauth.wosa.link/callback.php` as the authorized **redirect URI** (it must also exist in the provider's developer console, or the consent step is rejected).

That's the whole server side. The broker is one small dependency-free PHP service; a single deployment serves many apps, each as a tiny per-app config file.

---

## Reference implementations

- **The broker itself:** `github.com/webOSArchive/oauth-broker-for-webos` — the dependency-free PHP service, per-app config templates, and both flow implementations. Add your app with a PR (see above).
- **Box for webOS** (`com.box.webos`) — `oauth2_authcode`, refreshable tokens. Device code in `source/views/login.js` + `source/api/api.js`.
- **ReadOnTouch / Instapaper** (`org.webosarchive.readontouch`) — `oauth1_xauth`, long-lived tokens. Device code in `source/Welcome.js` + `source/Services.js`.
- **Copy-paste starter + reusable Enyo helper:** `webos-common` → `OAuthExample/` (includes a `Helpers.OAuthBroker` component and a `CLAUDE.md` written to get an AI to a working integration): https://github.com/webOSArchive/webos-common

---

## See Also

- `webos://knowledge/tls-and-networking` — *why* the device can't do OAuth itself, and the SSL-bump proxy that lets it reach the broker at all
- `webos://knowledge/web-fetching` — `enyo.xhr` / `WebService` / `Mojo.Service.Request` for the broker calls
- `webos://knowledge/gotchas` — the lazy-`ModalDialog` trap and other repeat offenders
