# Mojo Framework

Mojo is the JavaScript UI framework for webOS 1.x and 2.x phone apps. It is scene-based and follows an MVC-style pattern where each "scene" has an HTML view and a JavaScript assistant.

## Core Concepts

### Stages and Scenes

- A **stage** is a window (card in the webOS UI). Most apps have one card stage.
- A **scene** is a full-screen view pushed onto a stage's scene stack.
- Navigation is done by pushing/popping scenes on the stack, like a navigation controller.

### The Assistant Pattern

Every stage and scene has a corresponding **assistant** — a JavaScript object with lifecycle methods that Mojo calls at the right time.

**StageAssistant** (`app/assistants/stage-assistant.js`):
```javascript
function StageAssistant() {}

StageAssistant.prototype.setup = function() {
  // Called once when the stage (card) is created
  // Push your first scene here:
  this.controller.pushScene('main');
};
```

**SceneAssistant** (`app/assistants/main-assistant.js`):
```javascript
function MainAssistant() {}

MainAssistant.prototype.setup = function() {
  // Called when the scene is pushed onto the stack
  // Set up widgets, attach event listeners here
};

MainAssistant.prototype.activate = function(event) {
  // Called each time the scene becomes active (top of stack)
};

MainAssistant.prototype.deactivate = function(event) {
  // Called when the scene is no longer on top (another scene pushed)
};

MainAssistant.prototype.cleanup = function(event) {
  // Called when the scene is popped off the stack
};
```

### Scene Views (HTML Templates)

Each scene has a corresponding HTML view file in `app/views/<scene-name>/<scene-name>-scene.html`. These are HTML fragments (not full documents) that Mojo inserts into the DOM.

```html
<!-- app/views/main/main-scene.html -->
<div id="main-scene">
  <div class="palm-page-header">
    <div class="palm-page-header-wrapper">
      <div class="title">My App</div>
    </div>
  </div>
  <div id="my-list" x-mojo-element="List"></div>
</div>
```

The `x-mojo-element` attribute marks where Mojo should inject a widget.

## Widgets

Widgets are declared in the view HTML and configured in the assistant's `setup()`:

```javascript
MainAssistant.prototype.setup = function() {
  // List widget
  this.controller.setupWidget('my-list',
    {
      itemTemplate: 'main/item',      // refers to app/views/main/item.html
      listTemplate: 'main/list',
      swipeToDelete: false,
      renderLimit: 40,
      reorderable: false
    },
    this.myListModel = { items: [] }
  );

  // Button widget
  this.controller.setupWidget('my-button',
    { type: Mojo.Widget.activityButton },
    this.buttonModel = { label: 'Go', disabled: false }
  );
};
```

Common widgets: `List`, `Scroller`, `TextField`, `PasswordField`, `ToggleButton`, `Slider`, `Spinner`, `Button`, `CheckBox`, `RadioButton`, `DatePicker`, `TimePicker`, `FilePicker`.

## Event Handling

```javascript
MainAssistant.prototype.setup = function() {
  // Bind event handlers
  this.handleButtonTap = this.handleButtonTap.bind(this);

  // Listen for widget events
  Mojo.Event.listen(
    this.controller.get('my-button'),
    Mojo.Event.tap,
    this.handleButtonTap
  );
};

MainAssistant.prototype.handleButtonTap = function(event) {
  Mojo.Log.info('Button tapped');
};

MainAssistant.prototype.cleanup = function() {
  // Always stop listening in cleanup to avoid leaks
  Mojo.Event.stopListening(
    this.controller.get('my-button'),
    Mojo.Event.tap,
    this.handleButtonTap
  );
};
```

## Service Calls (Luna)

```javascript
this.controller.serviceRequest('palm://com.palm.connectionmanager', {
  method: 'getStatus',
  parameters: {},
  onSuccess: function(response) {
    Mojo.Log.info('Connected:', response.isInternetConnectionAvailable);
  },
  onFailure: function(error) {
    Mojo.Log.error('Service call failed:', error.errorText);
  }
});
```

## Scene Navigation

```javascript
// Push a new scene (navigate forward)
this.controller.stageController.pushScene('detail', { itemId: 42 });

// Pop the current scene (navigate back)
this.controller.stageController.popScene();

// Pop and pass a result back to the previous scene's activate()
this.controller.stageController.popScene({ result: 'done' });
```

## Logging

```javascript
Mojo.Log.info('Informational message');
Mojo.Log.warn('Warning message');
Mojo.Log.error('Error message');

// Output appears in the device log, viewable via novacom (see sdk-tools.md)
```

## Notifications and Banners

```javascript
// Dashboard notification
Mojo.Controller.getAppController().showBanner(
  { messageText: 'Something happened', soundClass: 'notification' },
  { source: 'mynotification' }
);
```

## Model Updates

After changing a model, tell Mojo to re-render the widget:

```javascript
// Update list data and re-render
this.myListModel.items = newItems;
this.controller.modelChanged(this.myListModel);
```

---

## See Also

- `webos://knowledge/system-features` — Just Type, noWindow/dashboard, hardware key events, system sounds
- `webos://knowledge/alarms` — background timers that fire when device is sleeping; the right way to do periodic work
- `webos://knowledge/exhibition` — Touchstone dock/Exhibition mode: full implementation including the stageDeactivated lifecycle bug
- `webos://knowledge/services` — built-in Luna service calls (display, audio, network radios, app management)
- https://github.com/webOSArchive/webos-common/blob/main/Mojo/com.wosa.mojo.additions.js
