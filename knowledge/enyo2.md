# Enyo 2.x Framework

Enyo 2 was open-sourced by HP after the webOS platform was discontinued and runs on modern browsers via a build step. It is architecturally related to Enyo 1 (which shipped on the TouchPad) but the APIs are different enough that code is not compatible. Enyo 2 is used for "new generation" webOS apps that also target LuneOS, Android, and web, and for webOS TV (LG).

> **Existing knowledge:** `webos://knowledge/enyo` covers Enyo 1, which shipped on the TouchPad. This file covers Enyo 2.x and its version lineage.

**Reference projects (both Enyo 2.5.0-pre.1):**
- **enyo2-checkmate** (`com.webosarchive.checkmatehd`) — cross-platform to-do list; simpler Enyo 2 usage; layout + onyx only
- **FeedSpider2** (`com.othelloventures.feedspider2`) — RSS reader; full webOS integration; webos-lib, simplelang, NotificationTheme

---

## Version Detection

Check `enyo/package.json` in the app's vendored Enyo tree:

```json
{ "version": "2.5.0-pre.1" }   // webOS community version (most common)
```

For runtime detection:
```javascript
enyo.version    // string: "2.5.1", "2.6.0", etc. — present in 2.5+
typeof moon     // "object" = you're on Enyo 2.6 (TV-era)
typeof require  // "function" (not IMPORTS.require) = Enyo nightly/3.x modular
```

The nightly 2018+ build is identifiable by source files using `require("enyo/kind")` (AMD-style modules) instead of the global `enyo` namespace.

---

## Enyo 2 Common Architecture (All 2.x Versions)

These APIs are stable across all Enyo 2.x releases.

### Kind definition

```javascript
enyo.kind({
    name: "MyApp.MyView",          // namespace.Name convention
    kind: "FittableRows",          // what to extend (string or reference)
    fit: true,                     // fill available space

    published: {                   // auto-generates getters/setters + change handlers
        value: "",                 // → getValue(), setValue(), valueChanged()
        count: 0
    },

    events: {                      // events this kind can bubble up
        onSwitchView: ""           // → doSwitchView(payload) fires it
    },

    handlers: {                    // events to handle from children
        onChildEvent: "handleChild"
    },

    components: [                  // declarative child components
        {name: "myList", kind: "enyo.List", onSetupItem: "setupItem", fit: true},
        {name: "myButton", kind: "onyx.Button", content: "Tap", ontap: "buttonTapped"}
    ],

    create: function() {           // constructor; called before render
        this.inherited(arguments);
        // setup, data initialization
    },

    rendered: function() {         // called after DOM is ready
        this.inherited(arguments);
        // safe to measure, read DOM
    },

    destroy: function() {          // destructor
        this.inherited(arguments);
        // cleanup event listeners, timers
    },

    valueChanged: function() {     // auto-called when this.setValue() is called
        this.$.myLabel.setContent(this.value);
    },

    buttonTapped: function(inSender, inEvent) {
        this.doSwitchView({target: "detail"});  // fire event up
        return true;                            // prevent event from bubbling further
    },

    setupItem: function(inSender, inEvent) {
        // called per List row — set content on named sub-components
        this.$.rowTitle.setContent(this.data[inEvent.index].title);
    }
});
```

### The `$` hash

Named children are accessible via `this.$`:

```javascript
this.$.myList.setCount(10);
this.$.myButton.setDisabled(true);
this.$.myLabel.setContent("Hello");
```

### Super calls

```javascript
// Simple (call super first or last):
create: function() {
    this.inherited(arguments);
    // your code after
},

// Wrapping (call super in the middle, or control timing):
rendered: enyo.inherit(function(sup) {
    return function() {
        sup.apply(this, arguments);  // call super
        this.setupAfterRender();     // your code after super
    };
}),
```

Use `enyo.inherit()` when you need to interleave with the super call. Use `this.inherited(arguments)` for simple before/after.

### Binding utilities

```javascript
enyo.bind(this, "methodName")       // context-bound method reference (not native .bind())
enyo.bind(this, function() {...})   // context-bound anonymous function
window.setTimeout(fn.bind(this), 500)   // native .bind() also works in Enyo 2
```

### Logging

```javascript
enyo.log("message");     // console.log
enyo.warn("message");    // console.warn
enyo.error("message");   // console.error
```

### Platform detection

```javascript
enyo.platform.webos       // true on webOS
enyo.platform.firefoxOS   // true on Firefox OS
enyo.platform.android     // true on Android
enyo.platform.ios         // true on iOS
enyo.platform.chrome      // true on Chrome
```

---

## Standard Libraries (2.5.0-pre.1)

Both reference projects vendor these from the community-maintained 2.5.0-pre.1 fork.

### layout library (`$lib/layout`)

```javascript
// Fittable layouts
"FittableRows"              // vertical stack; fit:true on child takes remaining space
"FittableColumns"           // horizontal stack
"enyo.FittableColumnsLayout"  // as a layoutKind property

// Panels and navigation
"Panels"                    // sliding panels; arrangerKind controls transition
"CollapsingArranger"        // list+detail: list collapses when detail is shown
"CardArranger"              // one panel at a time, no sliding
"CarouselArranger"          // carousel-style

// Lists (virtual, efficient)
"List"                      // standard virtual list; onSetupItem per row
"AroundList"                // List with "around" content (sticky header rows above list)

// Other
"ImageView"                 // pinch/zoom image viewer
"Slideable"                 // panel that can be dragged open/closed
"PanZoomView"               // pan and zoom container
"Panels"                    // multi-panel navigation
```

### onyx library (`$lib/onyx`)

```javascript
// Buttons
"onyx.Button"               // standard button; classes: "onyx-negative", "onyx-affirmative"
"onyx.IconButton"           // button with src image
"onyx.RadioButton"          // radio group button
"onyx.ToggleButton"         // on/off toggle

// Inputs
"onyx.Input"                // text input
"onyx.InputDecorator"       // wraps Input with label styling
"onyx.TextArea"
"onyx.RichText"
"onyx.Checkbox"
"onyx.Picker" / "onyx.PickerDecorator" / "onyx.PickerButton"  // dropdown picker

// Navigation
"onyx.Toolbar"              // app bar; layoutKind: "FittableColumnsLayout" for row layout
"onyx.Grabber"              // drag handle for resizable panels
"onyx.Menu" / "onyx.MenuDecorator" / "onyx.MenuItem"

// Feedback
"onyx.Popup"                // modal/non-modal popup; centered: true, modal: true
"onyx.Spinner"              // loading indicator
"onyx.ProgressBar"
"onyx.Slider"

// Decoration
"onyx.Icon"                 // image icon; src property
"onyx.Groupbox" / "onyx.GroupboxHeader"
"onyx.Tooltip" / "onyx.TooltipDecorator"
```

### Core enyo kinds

```javascript
"enyo.Application"     // app root; view: "MyView" property
"enyo.Control"         // base DOM-rendering kind
"enyo.Component"       // non-visual base kind
"enyo.Scroller"        // scrollable container; TouchScrollStrategy on mobile
"enyo.List"            // virtual list (also in layout)
"enyo.Repeater"        // non-virtual repeater (renders all items)
"enyo.Popup"           // base popup
"enyo.Ajax"            // XHR wrapper
"enyo.Signals"         // global signal bus (cross-tree events)
"enyo.Audio"           // HTML5 audio element
"enyo.Checkbox"        // base checkbox
"enyo.Input"           // base text input
"enyo.Panels"          // base panels (also in layout, extended there)
```

---

## Dependency Declaration

```javascript
// In package.js files:
enyo.depends(
    "$lib/layout",           // from lib/layout/
    "$lib/onyx",             // from lib/onyx/
    "$lib/simplelang",       // localization ($L function)
    "$lib/webos-lib",        // webOS-specific APIs
    "style",                 // ./style/ directory
    "views",                 // ./views/ directory
    "app.js"                 // specific file
);
```

### deploy.json

Controls what gets bundled during the Enyo build:

```json
{
    "enyo": "./enyo",
    "packagejs": "./package.js",
    "assets": ["./appinfo.json", "./index.html", "./assets"],
    "libs": ["./lib/onyx", "./lib/layout", "./lib/webos-lib"]
}
```

Output: `build/enyo.js`, `build/app.js`, `build/enyo.css`, `build/app.css`

---

## webos-lib (FeedSpider2 pattern)

The `webos-lib` library provides webOS-specific integrations not in core Enyo 2. Add to deploy.json libs and `$lib/webos-lib` in package.js.

### Luna bus service calls

```javascript
// enyo.ServiceRequest (from webos-lib)
var request = new enyo.ServiceRequest({
    service: "palm://com.palm.power/timeout",
    method: "set"
});
request.go(parameters);

// With response handling
var clearRequest = new enyo.ServiceRequest({
    service: "palm://com.palm.power/timeout",
    method: "clear"
});
clearRequest.go({"key": webos.identifier().appID + ".timer"});
```

### webOS global APIs (from webos-lib/source/webos.js)

```javascript
webos.launchParams()         // returns launch params object
webos.identifier()           // returns {appID, processID, ...}
webos.identifier().appID     // the app's ID string
webos.fetchAppRootPath()     // returns path to app resources
webos.activate(windowRef)    // bring an existing window to front
```

### webOS window types

```javascript
// Card window (normal app window)
var win = window.open(url, "appWindow", 'attributes={"window": "card"}');

// Dashboard notification (strip across screen bottom)
var dash = window.open(url + "?count=" + n, "dashWindow", 'attributes={"window": "dashboard"}');

// Activate/focus an existing window
webos.activate(win);
win.close();
```

### System event handling

```javascript
enyo.kind({
    name: "MyApp.WindowManager",
    kind: "enyo.Component",
    components: [
        {kind: "enyo.ApplicationEvents", onrelaunch: "launch"}
    ],
    launch: function() {
        var params = webos.launchParams();
        if (params.action === "update") {
            // handle background wakeup
        } else {
            // handle foreground relaunch
        }
    }
});
```

### AppMenu

```javascript
// Adds the standard webOS app menu (appears when swiping from top edge)
{kind: "AppMenu", components: [
    {kind: "EditMenu"}     // standard Cut/Copy/Paste items
]}
```

---

## Localization (simplelang)

FeedSpider2 uses the `simplelang` library for `$L()`:

```javascript
// Wrap all user-visible strings
this.$.button.setContent($L("Logout"));
this.$.title.setContent($L("You have {unread} articles", {unread: count}));
```

Install: add `$lib/simplelang` to package.js and `"./lib/simplelang"` to deploy.json libs. The `$L` function becomes a global after load.

---

## Application Entry Points (webOS vs Other Platforms)

FeedSpider2 demonstrates the dual-entry pattern:

**`index.html`** — web/Android/Cordova entry:
```html
<script src="build/enyo.js"></script>
<script src="build/app.js"></script>
<script src="source/index.js"></script>   <!-- creates the Application -->
```

**`index-webos.html`** — webOS-only entry:
```html
<!-- Same scripts, but source/index-webos.js instead -->
```

**`webos-dashboard.html`** — notification dashboard (webOS only):
```html
<!-- Minimal HTML for the dashboard strip; reads ?count= from URL -->
```

**appinfo.json** sets which is loaded on webOS:
```json
{
    "main": "index-webos.html"   // webOS loads this
}
```

---

## List Patterns

### enyo.List (virtual, efficient for long lists)

```javascript
{kind: "enyo.List",
    name: "myList",
    fit: true,
    count: 0,                       // set via setCount()
    multiSelect: false,
    reorderable: true,              // drag-to-reorder
    enableSwipe: true,              // swipe actions
    onSetupItem: "setupItem",
    onSetupReorderComponents: "setupReorder",
    onReorder: "reorderDone",
    onSetupSwipeItem: "swipeStart",
    onSwipeComplete: "swipeDone",
    components: [
        {name: "rowContent", ontap: "rowTapped", components: [
            {name: "rowTitle"},
            {name: "rowCheck", kind: "enyo.Checkbox"}
        ]}
    ],
    reorderComponents: [
        {name: "reorderContent", classes: "enyo-fit reorderDragger"}
    ],
    swipeableComponents: [
        {name: "swipeItem", classes: "enyo-fit", components: [
            {name: "swipeAction"}
        ]}
    ]
}
```

Key methods:
```javascript
this.$.myList.setCount(this.data.length);   // must call before or after data change
this.$.myList.reset();                      // full redraw
this.$.myList.refresh();                    // redraw visible rows
this.$.myList.renderRow(index);             // redraw specific row
this.$.myList.select(index);                // programmatic selection
this.$.myList.deselect(index);
this.$.myList.isSelected(index);
this.$.myList.scrollToRow(index);
```

### AroundList (from layout — FeedSpider pattern)

Like `List` but with `aboveComponents` that appear above the scrollable content — useful for sticky/pinned header rows:

```javascript
{kind: "AroundList",
    aboveComponents: [
        {name: "stickySources", kind: "enyo.FittableRows"},  // always visible above list
    ],
    components: [/* row template */],
    ...
}
```

---

## Ajax / HTTP Requests

```javascript
// GET request
var request = new enyo.Ajax({
    url: "https://api.example.com/data",
    method: "GET",
    handleAs: "json",
    cacheBust: false
});
request.response(this, "handleSuccess");
request.error(this, "handleError");
request.go({param: "value"});    // triggers the request

handleSuccess: function(inRequest, inResponse) {
    // inResponse is parsed JSON (if handleAs: "json")
},
handleError: function(inRequest, inResponse) {
    // inResponse.xhrResponse.status for HTTP code
}
```

```javascript
// JSONP
var request = new enyo.JsonpRequest({url: "...", callbackName: "callback"});
request.response(this, "handleResponse");
request.go();
```

---

## Enyo 2.6 — TV-Era Additions

Enyo 2.6 targets webOS TV (LG smart TVs). Same global-namespace architecture as 2.5, but adds:

### `moon` namespace (~99 controls)

The `moon` library replaces `onyx` for TV UIs. Controls include: `moon.VideoPlayer`, `moon.Panels`, `moon.Dialog`, `moon.Button`, `moon.Input`, `moon.Spinner`, `moon.Scroller`, `moon.DataList`, `moon.Slider`, `moon.TimePicker`, `moon.Calendar`, and many more.

```javascript
// TV-specific patterns:
{kind: "moon.Panels", ...}          // TV-style panel navigation
{kind: "moon.VideoPlayer", ...}     // Full-featured video player
{kind: "moon.MarqueeText", ...}     // Scrolling marquee text (for long titles)
```

### Spotlight navigation

Spotlight enables keyboard/remote control navigation:
```javascript
// moon.HistorySupport mixin — back button navigation
// moon.MarqueeSupport — auto-marquee for focused items
```

### New core kinds in 2.6

```javascript
enyo.FluxDispatcher / enyo.FluxStore   // Flux architecture
enyo.Router                            // URL-based routing
enyo.RelationalModel                   // relational data models  
enyo.LightPanels                       // lightweight panels (less overhead than Panels)
enyo.ImageCarousel                     // image carousel
enyo.SpriteAnimation                   // sprite sheet animation
```

### Identifying Enyo 2.6

- `moon` global namespace is defined
- `enyo.version` is "2.6.x"
- Docs have both "Namespaces" (enyo/moon/onyx) and "Kinds" tabs; no "Modules" tab

---

## Enyo Nightly (2018) — Modular Architecture Break

The 2018 nightly represents a **complete architectural break** from 2.x. This version moved to AMD-style modules. You won't encounter this in webOS homebrew apps, but you may see it in LG webOS TV development toolchains.

### Require-based modules (biggest breaking change)

```javascript
// OLD (Enyo 2.5/2.6):
enyo.kind({ kind: "enyo.Application", view: "MyApp.Home" });

// NEW (Nightly):
var kind = require("enyo/kind");
var Application = require("enyo/Application");
kind({ kind: Application, view: "MyApp.Home" });
```

**If you see `require("enyo/…")` in source files, it's the nightly modular system** and is incompatible with Enyo 2.5/2.6 apps.

### New libraries in nightly

```javascript
// canvas/ — Canvas drawing
require("canvas/Canvas");   // 2D drawing context
require("canvas/Circle");
require("canvas/Line");
require("canvas/Rectangle");

// svg/ — SVG rendering
// spotlight/ — Focus management (was part of moon in 2.6, now standalone)

// enyo-webos/ — webOS integration (replaces webos-lib)
require("enyo-webos/LunaService");     // Luna bus (replaces PalmService)
require("enyo-webos/ServiceRequest");  // service request
require("enyo-webos/ServiceModel");
require("enyo-webos/AppInfo");
require("enyo-webos/VoiceReadout");
```

### New core modules in nightly

```javascript
require("enyo/ViewManager");           // replaces Panels in many cases
require("enyo/NewDataList");           // updated virtual data list
require("enyo/BackgroundTaskManager"); // background task management
require("enyo/SystemMonitor");
require("enyo/Loop");                  // animation loop helper
require("enyo/History");               // navigation history
require("enyo/ShowingTransitionSupport"); // animated show/hide
require("enyo/ViewPreloadSupport");    // preload views before navigation
```

### Computed properties (new in nightly glossary)

A formal system for properties whose value is automatically recalculated when dependent properties change:
```javascript
// In nightly, via ComputedSupport mixin:
computed: {
    fullName: ["firstName", "lastName"]  // recomputed when either changes
}
```

---

## Version Comparison Table

| Feature | Enyo 1 (on-device) | Enyo 2.5.0-pre.1 | Enyo 2.6 | Nightly 2018 |
|---|---|---|---|---|
| Target | TouchPad webOS 3 | webOS + Cordova + web | webOS TV (LG) | webOS TV / modern |
| Define kind | `enyo.kind()` | `enyo.kind()` | `enyo.kind()` | `require("enyo/kind")` |
| Namespace | `enyo.*` global | `enyo.*` global | `enyo.*` + `moon.*` | AMD modules |
| Luna calls | `enyo.ServiceRequest` (built-in) | webos-lib `PalmService` | webos-lib | `enyo-webos/LunaService` |
| Localization | Built-in | `$lib/simplelang` `$L()` | ilib | ilib |
| TV/remote nav | No | No | `moon.*` + Spotlight | `moonstone/*` + Spotlight |
| Flux/Router | No | No | Yes | Yes |
| Computed props | No | No | No | Yes |
| Canvas/SVG | No | No | No | Yes (separate libs) |
| JS constraint | ES5 | ES5 | ES5 | ES6+ OK |

---

## Build System (2.5.0-pre.1)

Both reference projects use the same build chain:

```bash
# Development
grunt serve              # dev server on port 8282
grunt jshint             # lint

# Build
./build.sh webos         # → bin/*.ipk
./build.sh android       # → bin/*.apk (via Cordova)
./build.sh www           # → bin/www/
./build.sh clean
```

**Node.js version matters:** The Enyo 2.5 build tools (old Grunt + deploy.js) require **Node.js v14**. Newer Node breaks the build scripts. Use nvm: `nvm use 14`.

**Oracle JDK 8 required for webOS builds:** `palm-package` checks for "java version" format (Oracle) and fails with OpenJDK. Android builds use JDK 17 (managed separately).

The build process:
1. `enyo/tools/deploy.js` concatenates all `enyo.depends()` source files in order
2. Minifies JS and CSS
3. Outputs `build/enyo.js`, `build/app.js`, `build/enyo.css`, `build/app.css`
4. These `build/` files are what `index.html` loads in production

---

## Common Patterns and Gotchas

### Dynamic component creation

```javascript
// Create at runtime, must call render()
var newPanel = this.$.contentPanels.createComponent({
    name: "signinPanel",
    kind: "checkmate.Signin",
    onLogin: "loginDone"
}, {owner: this});   // owner determines event handler resolution
newPanel.render();
this.$.contentPanels.render();  // re-render parent after adding child
this.$.contentPanels.setIndex(2);

// Destroy when done
this.$.contentPanels.getActive().destroy();
```

### Panels navigation

```javascript
{kind: "Panels",
    name: "contentPanels",
    fit: true,
    arrangerKind: "CollapsingArranger",  // list collapses when detail opens
    wrap: false,
    narrowFit: false,
    onTransitionFinish: "panelAnimationDone",
    components: [
        {kind: "myApp.DetailView", name: "detailPanel"},
        {kind: "FittableRows", name: "listPanel", components: [...]}
    ]
}

// Navigate
this.$.contentPanels.setIndex(0);    // show first panel (detail)
this.$.contentPanels.setIndex(1);    // show second panel (list)
this.$.contentPanels.getActive();    // returns active panel's toString (debugging)

// Test screen width
enyo.dom.getWindowWidth() <= 600     // narrow screen detection
enyo.Panels.isScreenNarrow()         // same check via Panels utility
```

### Event propagation

```javascript
// Return true from a handler to stop bubbling
ontap: function(inSender, inEvent) {
    this.doMyEvent({data: value});   // fire event defined in events:{}
    return true;                     // prevent tap from bubbling further
}

// Signals — cross-tree events (no parent/child relationship needed)
{kind: "enyo.Signals", onCustomSignal: "handleSignal"}
enyo.Signals.send("onCustomSignal", {data: value});
```

### FittableRows/Columns layout

```javascript
// fit: true on exactly ONE child makes it fill remaining space
{kind: "FittableRows", fit: true, components: [
    {kind: "onyx.Toolbar", ...},    // fixed height header
    {kind: "enyo.List", fit: true}, // ← this fills the rest
    {kind: "onyx.Toolbar", ...}     // fixed height footer
]}
```

### The `layoutKind` pattern for toolbars

```javascript
// Make a toolbar lay out as a row with one expanding child:
{kind: "onyx.Toolbar",
    layoutKind: "FittableColumnsLayout",
    noStretch: true,
    components: [
        {kind: "onyx.IconButton", src: "assets/menu.png"},
        {name: "title", fit: true},   // ← expands to fill
        {kind: "onyx.Spinner"}
    ]
}
```
