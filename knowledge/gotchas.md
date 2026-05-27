# webOS Common Gotchas

Hard-won knowledge about webOS development — things that aren't obvious and tend to bite developers repeatedly.

## App Structure

### sources.json — The Silent Failure Trap
If you add a new JavaScript file to your Mojo app and forget to add it to `sources.json`, it simply won't load. No error, no warning — the code just doesn't exist. Always update `sources.json` when adding files.

### appinfo.json Field Requirements
Missing or malformed `appinfo.json` fields cause `palm-package` to fail or the app to silently not appear in the launcher. Required fields: `id`, `version`, `vendor`, `type`, `main`, `title`. The `icon` field is technically optional but a missing icon shows a broken placeholder in the launcher.

### App ID Naming
App IDs must be reverse-domain format (`com.example.myapp`). They must be all lowercase, no underscores. Hyphens are allowed. The same ID constraint applies to service IDs.

## Mojo

### Always Clean Up Event Listeners
Mojo does not automatically remove event listeners when a scene is popped. If you attach listeners in `setup()`, always remove them in `cleanup()`. Forgetting causes listeners to accumulate across scene pushes/pops and produces duplicate event handling.

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

### Subscription Memory
Subscription-based service calls (`subscribe: true`) keep a persistent connection. Always cancel subscriptions you no longer need or they will keep the service running and consume resources.

## Packaging & Installation

### Version Must Increment
`palm-install` may silently refuse to install a package if the version string is the same as what's already installed. Increment the version in `appinfo.json` when testing installation from scratch.

### cryptofs vs usb Storage
Apps installed normally go to `/media/cryptofs/` (encrypted storage). Apps on the USB partition go to `/media/internal/`. Some system paths differ between these. When spelunking with novacom, check both locations if you can't find what you expect.

### Reinstall Clears Force-Pushed Files
If you've been force-pushing files via novacom for rapid development, a full `palm-install` will overwrite them with the packaged versions. Always re-package from your source of truth before a final install.

## Jails and Caching
Binaries may be put in a "jail" until the next reboot. The web engine aggressively caches javascript apps (particularly Enyo) between Luna restarts. This can cause confusion when troubleshooting because changes don't seem to work. When an app is jailed or cached, reboot or do a Luna restart to ensure the user is seeing the most up-to-date code.

## Device Communication

### novacom Requires Device in Developer Mode
The device must have Developer Mode enabled (available as a downloadable app or via the webOS Archive) before novacom will connect to it. Without it, the device is not visible to SDK tools.

### Emulator vs Device Differences
Some behaviors differ between the emulator and real hardware:
- Hardware sensors (accelerometer, camera, GPS) are mocked in the emulator
- Performance characteristics differ significantly
- Some system services behave differently or aren't present in the emulator
- The emulator runs webOS 1.4.5; testing on a real device for 2.x or 3.x behavior requires real hardware

## General JavaScript

### `var` Scope (No `let`/`const`)
webOS's WebKit engine is from 2009-era — ES5 only for the UI layer. Use `var`, not `let` or `const`. Arrow functions, template literals, destructuring, Promises, etc. are **not available** in the app layer.

Node.js services run a more modern Node version and may support newer syntax — check which Node version is on the target device.

### No CORS, No Same-Origin for XHR
Apps have elevated privileges and can make cross-origin XHR requests without CORS restrictions. Don't add unnecessary CORS workarounds — they're not needed and can cause confusion.

---

## See Also

- `webos://knowledge/alarms` — background alarm scheduling; includes the critical TouchPad workaround for background execution when screen is off
- `webos://knowledge/tls-and-networking` — TLS 1.0 limitations and SSL-bump proxy workarounds
- `webos://knowledge/postinst-packaging` — `palm-install` does not run postinst scripts; must use Preware or WOSQI
