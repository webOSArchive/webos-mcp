# Touch Events and Gestures (TouchPad / Enyo)

The HP TouchPad's capacitive display supports multi-finger touch tracking. webOS reports raw touch events and provides a gesture framework that apps can use to detect standard interactions. This document covers the TouchPad (Enyo 1) — phone gesture support differs and is more limited.

---

## Standard Gestures

These are the system-standard interactions webOS apps should recognize consistently:

| Gesture | Typical action |
|---------|---------------|
| Tap | Open/launch; select/deselect; place cursor |
| Double tap | Zoom in or out; select a word in text |
| Flick | Scroll in the flick direction |
| Press & hold | Enter edit/reorder mode; invoke cut/copy/paste |
| Press & drag | Scroll content; move/resize |
| Pinch in | Zoom out |
| Pinch out | Zoom in |

Design around these conventions. Users expect consistent behavior across apps.

---

## Touch Events

Any UI element can listen for these DOM-level touch events:

| Event | Fires when |
|-------|-----------|
| `touchstart` | One or more fingers touch the element |
| `touchmove` | Fingers drag across the element |
| `touchend` | Fingers lift from the element |
| `touchcancel` | Touch interrupted (e.g., incoming call) |

Each event's `touches`, `targetTouches`, and `changedTouches` lists contain `Touch` objects with `identifier`, `clientX`, `clientY`, `pageX`, `pageY`, and `target`.

```javascript
// Raw touch event handler in Enyo
handleTouchStart: function(inSender, inEvent) {
    var touches = inEvent.touches;
    if (touches.length === 2) {
        // Two-finger gesture starting
        this.startDistance = this.getDistance(touches[0], touches[1]);
    }
},

getDistance: function(t1, t2) {
    var dx = t1.clientX - t2.clientX;
    var dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
```

---

## Enyo Gesture Events

Enyo wraps the raw touch events into higher-level gesture events that propagate through the component tree. Wire them up in your component's `events` or directly on elements:

```javascript
components: [
    { name: "myView", ontap: "handleTap",
                      onflick: "handleFlick",
                      onhold: "handleHold" }
],

handleTap: function(inSender, inEvent) {
    // inEvent.target, inEvent.clientX, inEvent.clientY
},

handleFlick: function(inSender, inEvent) {
    // inEvent.xVelocity, inEvent.yVelocity (pixels/ms, signed)
    if (Math.abs(inEvent.xVelocity) > Math.abs(inEvent.yVelocity)) {
        // Horizontal flick
    }
},

handleHold: function(inSender, inEvent) {
    // Fired after press & hold threshold
}
```

### Gesture event reference

| Enyo event | Trigger |
|------------|---------|
| `ontap` | Quick touch and release |
| `ondblclick` | Two taps in quick succession |
| `onhold` | Press held past threshold |
| `onrelease` | Finger lifted (after hold) |
| `onflick` | Fast swipe — includes velocity |
| `ondragstart` | Drag begins (after movement threshold) |
| `ondrag` | Drag in progress |
| `ondragfinish` | Drag ends |
| `onscroll` | Scroll event on a scrollable container |

---

## Pinch-Zoom (Multi-touch)

Enyo does not provide a built-in pinch event — implement it with raw touch events:

```javascript
components: [
    { name: "zoomTarget",
      ontouchstart: "touchStart",
      ontouchmove:  "touchMove",
      ontouchend:   "touchEnd" }
],

touchStart: function(inSender, inEvent) {
    var t = inEvent.touches;
    if (t.length === 2) {
        this._pinchStart = this._dist(t[0], t[1]);
        this._scaleStart = this.currentScale || 1;
    }
},

touchMove: function(inSender, inEvent) {
    var t = inEvent.touches;
    if (t.length === 2 && this._pinchStart) {
        var dist  = this._dist(t[0], t[1]);
        this.currentScale = this._scaleStart * (dist / this._pinchStart);
        this.applyScale(this.currentScale);
    }
},

touchEnd: function(inSender, inEvent) {
    this._pinchStart = null;
},

_dist: function(a, b) {
    var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}
```

---

## Orientation Change

Detect device rotation via `ApplicationEvents` (see `application-events.md`):

```javascript
{ kind: "ApplicationEvents", onWindowRotated: "orientationChanged" }

orientationChanged: function(inSender) {
    var orientation = window.orientation; // 0, 90, -90, 180
    this.adjustLayout(orientation);
}
```

The TouchPad supports landscape and portrait. The OS rotates the viewport automatically; most apps just need to reflow layout.

---

## Back Gesture

The TouchPad has a software back gesture (swipe from the gesture area below the screen). Catch it in Enyo via `ApplicationEvents`:

```javascript
{ kind: "ApplicationEvents", onBack: "handleBack" }

handleBack: function() {
    // Navigate back or dismiss a dialog
    this.$.panels.selectPrevious();
}
```

In Mojo, the framework handles back gestures automatically for scene navigation.

---

## See Also

- `webos://knowledge/application-events` — `ApplicationEvents` component for orientation, back, and other global events
- `webos://knowledge/enyo` — Enyo 1 component and event model
