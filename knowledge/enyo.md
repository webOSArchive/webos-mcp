# Enyo Framework

Enyo is the component-based JavaScript UI framework shipped later in the platform's life. It was built-in to the OS in 2.2.4, and available as an add-on package in Preware for earlier versions. It replaced Mojo's scene/assistant pattern with a declarative, composable kind system.

> **Important:** "Enyo" in the context of original webOS hardware means **Enyo 1** (shipped on the OS). Enyo 2 was open-sourced by HP after the platform was discontinued and runs on modern browsers — it is related but different. Unless otherwise specified, webOS development uses Enyo 1.

## Core Concepts

### Kinds

A "kind" is Enyo's equivalent of a class. Everything is a kind — components, views, applications.

```javascript
enyo.kind({
  name: 'MyView',
  kind: enyo.Control,    // what we extend

  components: [           // child components (declarative)
    { kind: 'Header', content: 'My App' },
    { kind: 'Button', content: 'Tap Me', ontap: 'buttonTapped' }
  ],

  buttonTapped: function(inSender, inEvent) {
    this.$.header.setContent('Tapped!');
  }
});
```

### The `$` Hash

Every component automatically gets a reference to its named children in `this.$`:

```javascript
enyo.kind({
  name: 'MyView',
  kind: enyo.Control,
  components: [
    { name: 'myButton', kind: 'Button', content: 'Click' },
    { name: 'myText', content: 'Hello' }
  ],
  create: function() {
    this.inherited(arguments);
    this.$.myButton.setDisabled(true);   // access child by name
    this.$.myText.setContent('World');
  }
});
```

### Published Properties

Declare properties with automatic getter/setter generation and optional change handlers:

```javascript
enyo.kind({
  name: 'MyComponent',
  kind: enyo.Component,

  published: {
    value: '',       // generates getValue() / setValue()
    count: 0         // generates getCount() / setCount()
  },

  valueChanged: function(oldValue) {
    // called automatically whenever setValue() is called
    this.doSomethingWith(this.value);
  }
});
```

### Events

```javascript
enyo.kind({
  name: 'MyButton',
  kind: enyo.Button,

  events: {
    onAction: ''    // declares an event this kind can fire
  },

  tap: function() {
    this.doAction({ data: 'something' });   // fires onAction event
  }
});
```

Parent wires it up:
```javascript
components: [
  { kind: 'MyButton', onAction: 'handleAction' }
]
```

## Application Entry Point

```javascript
// app.js
enyo.kind({
  name: 'MyApp',
  kind: enyo.Application,   // or enyo.Control for simpler apps

  components: [
    { kind: 'MyMainView' }
  ]
});
```

`index.html` instantiates it:
```javascript
new MyApp().renderInto(document.body);
```

## Common Built-in Kinds

- `enyo.Control` — base visual component (renders a DOM node)
- `enyo.Component` — non-visual component (no DOM)
- `enyo.Application` — top-level app container
- `enyo.Button` — tappable button
- `enyo.Input` / `enyo.TextArea` — text input
- `enyo.Scroller` — scrollable container
- `enyo.List` — virtual scrolling list (efficient for large datasets)
- `enyo.Pane` / `enyo.Panels` — multi-panel navigation
- `enyo.Ajax` — XHR wrapper

### Moonstone / Onyx (Enyo 2 UI libraries — not on original hardware)

Original webOS uses the built-in webOS styling; Moonstone and Onyx are Enyo 2 UI libraries for modern environments.

## Virtual Lists

Enyo's `List` kind uses a flyweight pattern — it renders a fixed number of DOM rows and calls a handler to populate them with data:

```javascript
enyo.kind({
  name: 'MyListView',
  kind: enyo.Control,

  components: [{
    name: 'list',
    kind: 'List',
    count: 0,
    onSetupItem: 'setupItem',
    components: [
      { name: 'itemName', tag: 'div' }
    ]
  }],

  create: function() {
    this.inherited(arguments);
    this.data = ['Item A', 'Item B', 'Item C'];
    this.$.list.setCount(this.data.length);
  },

  setupItem: function(inSender, inEvent) {
    var index = inEvent.index;
    this.$.itemName.setContent(this.data[index]);
    return true;
  }
});
```

## Service Calls (Luna)

In Enyo, Luna calls go through `enyo.palmGetResource` or a service kind:

```javascript
enyo.kind({
  name: 'MyComponent',
  kind: enyo.Component,

  components: [{
    kind: 'PalmService',
    name: 'connStatus',
    service: 'palm://com.palm.connectionmanager/',
    method: 'getStatus',
    onSuccess: 'gotStatus',
    onFailure: 'serviceFailed'
  }],

  checkConnection: function() {
    this.$.connStatus.call({});
  },

  gotStatus: function(inSender, inResponse) {
    console.log('Connected:', inResponse.isInternetConnectionAvailable);
  }
});
```

## Lifecycle Methods

```javascript
enyo.kind({
  name: 'MyKind',
  kind: enyo.Control,

  create: function() {
    this.inherited(arguments);
    // component created, but not yet in DOM
  },

  rendered: function() {
    this.inherited(arguments);
    // component is now in the DOM
  },

  destroy: function() {
    // cleanup before removal
    this.inherited(arguments);
  }
});
```

> Always call `this.inherited(arguments)` in lifecycle methods — skipping it breaks the component chain.

---

## See Also

- `webos://knowledge/enyo2` — Enyo 2.x for cross-platform builds (Android, PWA, LuneOS); different API from Enyo 1
- `webos://knowledge/system-features` — Just Type, noWindow/dashboard, hardware key events, system sounds
- `webos://knowledge/exhibition` — Touchstone dock/Exhibition mode (TouchPad feature, Enyo 1 apps)
