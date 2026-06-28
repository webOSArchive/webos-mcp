# webOS Common Gotchas

Hard-won knowledge about webOS development — things that aren't obvious and tend to bite developers repeatedly.

## App Structure

### sources.json or depends.js — The Silent Failure Trap
If you add a new JavaScript file to app and forget to add it to `sources.json` (Mojo) or `depends.js` (Enyo), it simply won't load. No error, no warning — the code just doesn't exist. Always update `sources.json` or `depends.js` when adding files.

### appinfo.json Field Requirements
Missing or malformed `appinfo.json` fields cause `palm-package` to fail or the app to silently not appear in the launcher. Required fields: `id`, `version`, `vendor`, `type`, `main`, `title`. The `icon` field is technically optional but a missing icon shows a broken placeholder in the launcher.

### App ID Naming
App IDs must be reverse-domain format (`com.example.myapp`). They must be all lowercase, no underscores. Hyphens are allowed. The same ID constraint applies to service IDs.

## Mojo

### Always Clean Up Event Listeners
Mojo does not automatically remove event listeners when a scene is popped. If you attach listeners in `setup()`, always remove them in `cleanup()`. Forgetting causes listeners to accumulate across scene pushes/pops and produces duplicate event handling and memory leaks.

```javascript
// setup:
Mojo.Event.listen(element, Mojo.Event.tap, this.handler);

// cleanup (required!):
Mojo.Event.stopListening(element, Mojo.Event.tap, this.handler);
```

### `bind(this)` — Do It Once
Bind your handler methods in `setup()` and store the reference. If you call `.bind(this)` directly in the `listen()` call, you lose the reference needed to `stopListening()` later.

```javascript
// Wrong — can't stop listening later:
Mojo.Event.listen(el, Mojo.Event.tap, this.handler.bind(this));

// Right:
this.boundHandler = this.handler.bind(this);
Mojo.Event.listen(el, Mojo.Event.tap, this.boundHandler);
// ... in cleanup:
Mojo.Event.stopListening(el, Mojo.Event.tap, this.boundHandler);
```

### modelChanged() Is Required
After updating a widget's model data, you must call `this.controller.modelChanged(model)` to trigger a re-render. Directly mutating the model object without calling `modelChanged()` does nothing visually.

### Widget IDs Must Match HTML
The ID passed to `setupWidget()` must exactly match the `id` attribute on the HTML element with `x-mojo-element`. Case-sensitive. A mismatch causes the widget to silently not initialize.

### Scroller Wrap Pattern
Most scene content should be wrapped in a Mojo Scroller widget, not a plain CSS `overflow: scroll`. The Mojo Scroller handles momentum scrolling and integrates with the system correctly.

## Enyo

### Always Call `this.inherited(arguments)`
In lifecycle methods (`create`, `rendered`, `destroy`) and in overridden handlers, failing to call `this.inherited(arguments)` breaks the component chain. This is the most common Enyo mistake.

### `$` References Are Only Valid After `create()`
The `this.$` hash is populated during component creation. Don't try to access it in a constructor or before `create()` has run.

### List `count` Must Be Set Before Render
Set `this.$.list.setCount(n)` before the list renders, or call `this.$.list.reset()` after updating the count dynamically.

## Luna / Services

### Always Check `returnValue`
Luna service responses always include a `returnValue` boolean. A successful HTTP-level call can still contain `{ returnValue: false, errorText: "..." }`. Always check it:

```javascript
onSuccess: function(response) {
  if (!response.returnValue) {
    // Handle logical failure
    return;
  }
  // Safe to use response data
}
```

### Service Not Found Errors
If a Luna service call fails with "service not found" or "unknown method":
1. Verify the service URI — it must end with `/`
2. Check the service is installed and running (`novacom run 'ps aux | grep node'`)
3. Verify the method name exactly matches what the service exposes
4. Do not call a privileged service from an app whose id does not start with com.palm

### Subscription Memory
Subscription-based service calls (`subscribe: true`) keep a persistent connection. Always cancel subscriptions you no longer need or they will keep the service running and consume resources.

## Packaging & Installation

### Version Must Increment
`palm-install` will silently refuse to install a package if the version string lower than what's already installed. Increment the version in `appinfo.json` when testing installation from scratch.

### cryptofs vs usb Storage
Apps installed normally go to `/media/cryptofs/` (encrypted storage). Apps may create files on `/media/internal/`. Some system paths differ between these. When spelunking with novacom, check both locations if you can't find what you expect.

### Reinstall Clears Force-Pushed Files
If you've been force-pushing files via novacom for rapid development, a full `palm-install` will overwrite them with the packaged versions. Always re-package from your source of truth before a final install.

## Jails and Caching
Apps may be put in a "jail" until the next reboot, especially if they include a service. The web engine aggressively caches javascript apps (particularly Enyo) between Luna restarts. This can cause confusion when troubleshooting because changes don't seem to work. When an app is jailed or cached, do a Luna restart, or if all else fails, a full reboot to ensure the user is seeing the most up-to-date code. Reboots take a long time, so a Luna restart is preferred (and works) in most cases.

### Jails have their own `/proc`
A "hybrid jail" gets a fresh `proc` mount under `/var/palm/jail/<appid>/proc`, separate from the host `/proc`. A `mount --bind` on the host `/proc/nduid` (or any other procfs file) is invisible to a jailed process — you have to apply the same bind inside `/var/palm/jail/<appid>/proc/` too. Capabilities are also stripped, so **even root can't `ptrace` a jailed process** — `strace -p $pid` returns `Operation not permitted`. Plan debugging around log analysis, tcpdump, and direct SQLite reads instead. See `system-internals.md`.

### PDK apps run jailed too — and it bites differently than JS apps
`LunaSysMgr` launches a **PDK (native) app** in a hybrid jail under `/var/palm/jail/<appid>/` as **uid 5003 (`jailuser`)**, with `LD_PRELOAD=libpvrtc.so`, CWD = the app dir. Consequences that trip up native devs (full detail in `pdk.md` → "How the Launcher Runs a PDK App"):
- **stdout/stderr go nowhere** — not a tty, not `/var/log/messages`. The binary must redirect them to a file on `/media/internal` itself, or you're debugging blind. (`pdk.md`'s old "stdout ends up in `/var/log/messages`" advice only holds when you run the binary directly from a novacom shell, not from the launcher.)
- **The launch params arrive as `argv`** (`myapp "{ }"`) — a binary that reads `argv` as a file path will choke.
- **`main` must be the ARM binary** — a shell-script `main` is silently not exec'd.
- **`argv[0]` is unreliable** — self-locate with `readlink("/proc/self/exe")`.
- The jail is **torn down on exit**; read an in-jail file **while the app lives** via `/proc/<pid>/root/...` (e.g. `cat /proc/$(pidof myapp)/root/media/internal/<appid>.log`). `/media/internal` is bind-mounted **rw** into the jail, so it's the reliable place to write logs/saves.

## Shell-side `luna-send` output is split between stdout and stderr
When scripting `luna-send` calls from a shell (e.g. driving the device through `novacom run`), the `payload {...}` line containing the actual response goes to **stderr**, while only `Total time …` goes to **stdout**. Naive `luna-send … > file.json` captures almost nothing. Use `2>&1` to merge them and then grep out the payload:

```sh
luna-send -t 1 -m com.example.app palm://com.palm.db/find '{"query":{"from":"…:1"}}' > resp.json 2>&1
# resp.json now contains the timing line on top, the JSON payload after "payload ", and Total time at the end.
```

## TouchPad BusyBox shortcomings
The TouchPad's BusyBox does **not** support several common GNU options. Workarounds:

| You wrote | What it actually does on BusyBox | Use instead |
|---|---|---|
| `tr -d '[:space:]'` | Deletes literal `[`, `:`, `s`, `p`, `a`, `c`, `e`, `]` | `tr -d ' \t\r\n'` |
| `head -c 200 file` | `head: invalid option -- 'c'` | `dd if=file bs=1 count=200 2>/dev/null` |
| `find -regex …` with alternation | May silently miss matches | List branches separately |

The `tr` one in particular has bitten install scripts that try to strip whitespace from control files — see `postinst-packaging.md`.

## Device Communication

### novacom Requires Device in Developer Mode
The device must have Developer Mode enabled (available as a downloadable app or via a code found the webOS Archive) before novacom will connect to it. Without it, the device is not visible to SDK tools.

### Emulator vs Device Differences
Some behaviors differ between the emulator and real hardware:
- Hardware sensors (accelerometer, camera, GPS) are mocked in the emulator
- Performance characteristics differ significantly
- Some system services behave differently or aren't present in the emulator
- The emulator runs webOS 1.4.5; testing on a real device for 2.x or 3.x behavior requires real hardware

## General JavaScript

### `var` Scope (No `let`/`const`)
webOS's WebKit engine is from 2009-era — ES5 only for the UI layer. Use `var`, not `let` or `const`. Arrow functions, template literals, destructuring, Promises, fetc, etc. are **not available** in the app layer.

Node.js services also run an ancient Node version, that differs between OS releases — check which Node version is on the target device.

### No CORS, No Same-Origin for XHR
Apps have elevated privileges and can make cross-origin XHR requests without CORS restrictions. Don't add unnecessary CORS workarounds unless also targeting modern platforms (see pwa-portability.md) — they're not needed on legacy webOS and can cause confusion.

---

## See Also

- `webos://knowledge/alarms` — background alarm scheduling; includes the critical TouchPad workaround for background execution when screen is off
- `webos://knowledge/tls-and-networking` — TLS 1.0 limitations and SSL-bump proxy workarounds
- `webos://knowledge/postinst-packaging` — `palm-install` does not run postinst scripts; must use Preware or WOSQI
- `webos://knowledge/ls2-roles` — `Invalid permissions` errors and the service-name registration model
- `webos://knowledge/system-internals` — Encrypted `/var/db`, mountcrypt, jail `/proc`, and other below-the-SDK plumbing
