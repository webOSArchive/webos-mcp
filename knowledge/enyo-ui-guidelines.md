# Enyo UI Design Guidelines (TouchPad)

HP's official *HP TouchPad webOS Design Guidelines* (June 2011) — the human-interface rulebook for **Enyo 1** apps on the HP TouchPad tablet. It is the Enyo-era counterpart to the Mojo/phone guidance in `ui-guidelines.md`, and the two differ substantially: the TouchPad is a large tablet with **no gesture area**, and Enyo apps are built from **views and panes** rather than Mojo scenes. This doc tells you which Enyo component to use, when, and how to lay out a tablet app so it feels native.

Applies to Enyo 1 on webOS 3.x (TouchPad; also Pre 3 / Veer Enyo apps). For the framework mechanics behind these components see `enyo.md`; for the underlying design philosophy see `zen-of-palm.md`. Mirrored by the webOS Archive at `sdk.webosarchive.org/docs/design/enyo/`.

---

## The DNA of webOS

Six principles the whole platform is built on — follow them for an app that feels native:

- **Simple, effortless design.** Find the essence of your app; make its core activities immediately accessible in the minimum number of steps.
- **Spatial metaphors.** Users flick between cards and drag panes. Let them manipulate objects directly with gestures so it feels natural.
- **Unobtrusive notifications.** Always visible, but discrete — the user decides when to act.
- **Synchronized data.** Integrate multiple sources/accounts (Synergy) into one coherent experience so users find info with minimal navigation.
- **Seamless multitasking.** The Card view lets users move between activities freely — not a linear path.
- **Protecting the user's data.** Auto-save always; warn before destructive actions; save state when tasking away.

---

## Design Principles

These echo the *Zen of Palm* sweet-spot philosophy (`zen-of-palm.md`), re-expressed for tablets:

- **Focus on benefits to users, not technical features.** Start with only the essentials and add features **only until you reach the sweet spot** — the optimal user experience, and no more. Weigh each feature's benefit against the complexity it adds.
- **Streamline interactions.** Common tasks in the fewest steps — ideally one tap. Minimize clutter; push less-frequent activities a tap away. Consider how the user holds the device: important actions should be easy to reach.
- **Familiarity leads to intuitiveness.** Use built-in webOS components and follow these guidelines — familiar patterns give instant usability.
- **Pleasantly surprise experienced users.** Layer in shortcuts for power users *after* the core is highly accessible — discoverable over time, never adding clutter and never the only way to do something.
- **Fit the form factor.** A tablet app is *not* a scaled-up phone app. It has its own ergonomics and contexts of use; provide a larger-scale experience so the user needn't reach for a PC.

---

## Phone (Mojo) vs. Tablet (Enyo)

| Phone | Tablet |
|-------|--------|
| Single, focused content area | Multiple content areas (panes) where appropriate |
| Only highest-priority actions on screen | More high-priority actions can be exposed |
| Mainly list-based navigation | More visual, object-based navigation |
| Navigation through many screens | Minimal screen changes — use panes / interactive pop-ups |

> **Critical difference — no gesture area.** The TouchPad (and some later phones) omit the physical gesture strip. Actions that used the back/forward gesture must instead use **direct manipulation** (sliding panes) or **explicit buttons** ("OK", "Cancel", "Done", a Back button).

---

## Hardware & System Context

- **Display:** 9.7″ capacitive XGA, **1024×768** (132 PPI). Design for both portrait (768 wide) and landscape (1024 wide).
- **Swipe up from the bottom** (or Center button) → Card view; again → toggles App Launcher. This replaces the old gesture-area actions.
- **No physical keyboard** — a virtual keyboard rises from the bottom over content (see Text Input).
- Integrates with the same system features as phones: **Card view / multitasking**, **App Launcher**, **Exhibition mode** (Touchstone dock — see `exhibition.md`), **Synergy** (`synergy.md`), **Just Type** universal search (`just-type.md`), and **Touch to Share** (`touch2share.md`).
- **Compatibility mode** runs legacy **Mojo** apps in a window on the TouchPad (App menu top-left, notifications in the status bar, a Back-gesture area inside the window). Enyo is preferred for new apps.

---

## Standard Gestures

| Gesture | Typical action |
|---------|---------------|
| Tap | Open/launch; select/deselect; place cursor |
| Double tap | Zoom content in/out; select a word |
| Flick | Scroll (any direction) |
| Press & hold | Enter edit/reorder mode (cards, grids, lists); invoke Cut/Copy/Paste in text |
| Press & drag | Scroll; move an object or resize a selection |
| Pinch in / out | Zoom content in / out |

See `touch-and-gestures.md` for the Enyo event API behind these.

---

## Layout: Views & Panes

An Enyo app is one or more **views**, each containing one or more **panes** of content. Panes can be **fixed** (constant width regardless of orientation) or **free** (grow to fill available space). Content within a pane scrolls. Each pane may have its own **Header** and **Footer**. Within a view, either *all* panes have headers or *none* do (visual consistency).

The **Status Bar** (battery, network, app notifications) is generally visible but can be dismissed for Full Screen Mode.

### Layout types

| Layout | Use |
|--------|-----|
| **Single pane** | Simplest; header for nav/search/view-options; content area for visual content (grids, notes). Not ideal for list-based info. Examples: Memos, Calendar. |
| **Split view** | Fixed left pane (a list) + free right pane (detail of the selected item). One list item is always selected. Example: Photos & Videos. |
| **Sliding panes** | Hierarchy where each level is a pane; new panes slide in from the right as the user drills down, older panes slide left. Panes ~320px; the final **detail pane** grows to fill space. Landscape shows up to 3 panes; portrait shows a partial third. Dismiss the rightmost pane by swiping it left→right. Example: Email. |
| **Pane peeking** | Keep ~50px of the left-most (top-level) pane always visible so the user can jump between sections at any depth. Only use if the peeking pane has minimal, non-scrolling, easily-recognizable content and there's a strong use case. |

### Headers & footers

- A **Header** area can stack several headers, each **fixed** (anchored to the top) or **scrolling** (scrolls with content). Use headers for view title, search, view options, navigation, and (if no footer) actions/controls.
- A **Footer** holds a toolbar of icon buttons for actions/controls.

### Portrait & landscape

Provide *both* orientations wherever possible (users hold tablets any way). Free panes resize automatically; content should **re-flow** to fill the space (a free pane needs ≥320px to re-flow well). Header/footer *items* stay the same across orientations — **never introduce new content or functionality on rotation**. Grid layouts scale best; avoid single full-width columns (keep the column width constant rather than stretching it in landscape).

### Full Screen Mode

Dismisses all chrome (status bar, headers, footers); content fills the screen for an immersive experience. A tap can reveal semi-transparent, transient header/footer areas that fade out after a time-out. Notifications are suppressed (no status bar) but **alerts still show**. **Always provide a way to exit.**

---

## Laying Out Controls

- **Tap targets:** standard TouchPad controls are **54px square** — bigger than on phones. Make custom targets ≥54px too. Every tappable target needs an immediate **pressed state**.
- **Positioning:** the TouchPad has no fixed grip and is held one- or two-handed in either orientation. The **sides** are easily thumb-able — good for controls, but **keep destructive controls off the sides** (easy to hit by mistake when gripping).
- Use standard webOS controls wherever possible — sized and styled for the TouchPad, and instantly familiar.

---

## Component Catalog

For full visual specs, HP points to the **HP TouchPad Wireframe Stencils** and the **Style Matters** app (bundled with the webOS 3.0 SDK) which shows default styling.

### Lists

Multi-line rows displaying selectable items. Support dividers (including expandable/collapsible), inline text fields for adding/editing items, and **swipe-to-delete** (swipe a row to reveal confirm/cancel). A row can be a single tap target (drill into detail / trigger an action) or hold **multiple tap targets** (e.g. a thumbnail that opens a pop-up plus a favorite toggle).

### Buttons

Push buttons take a pressed state and can be disabled (e.g. while a spinner runs). **Color carries meaning:**

| Color | Meaning |
|-------|---------|
| **Light grey** | Default — use in most cases |
| **Grey (dark)** | The primary action among choices (omit if there's no clear primary) |
| **Green** | The positive choice in a decision (Done/Yes); the "Done" button in task flows |
| **Red** | Destructive action (typically Delete) |
| **Blue** | Draw attention to a prominent action — use sparingly |

Other buttons: **Icon buttons** (in header/footer toolbars; no label or border). **Back button** (left-aligned in a toolbar, carries a back arrow, ideally labeled with the previous view's title; light and dark styles). **Radio buttons** (pick one from a group; in a header, selecting one changes the pane's content).

### Interactive pop-ups

Modal (a scrim dims the view beneath) with a scrollable **content area**, a **button area** (always in the chrome, never scrolls), and an optional header. Use for **small, self-contained sub-tasks** relevant to the current view — on a large tablet, navigating away for a small task is disorienting, so the pop-up keeps context. Keep interaction brief; it should never be the primary way to use a view. Action buttons stack vertically; navigation buttons sit side-by-side (max two). If the pop-up has a text field, reposition/resize it so the **virtual keyboard doesn't cover it**, and don't dismiss the keyboard until the pop-up is dismissed. Prefer in-line text entry over pop-up entry.

### Dialogs

Also modal, but **no interactive content** — just a title, body text, and buttons. Use for simple, quick prompts (confirm / inform / disambiguate). Because they interrupt flow, use only when it's important to grab attention — otherwise use a notification. Three kinds: **Confirmation** (two buttons, cancel left/bottom + confirm right/top; typically for irreversible actions), **Informative** (title + body + single dismiss button), **Action** (a list of vertically-stacked action buttons + a Cancel).

### App menu

App-specific menu reachable from **any** view, launched by tapping/swiping down the title area (top-left of the chrome). Unlike Mojo, it is **static** — the same items appear every time; items not applicable in the current context are **grayed out**, not removed. Ends with **Global Commands** in this order: **Print** (optional), **Preferences & Accounts** (or just one), **Help**. Use it for occasional, app-wide commands — put frequent/important actions directly in the view.

### Multiple selection

Tap an edit icon/button (in header or footer) to enter selection mode. The header and footer toolbars are replaced with **blue toolbars**; selected items get a **blue border/tint**. The header toolbar gives **Cancel** (and optionally **Select All**) and shows the count selected; the footer gives icon buttons for the batch actions (e.g. Add to Album, Delete). Same pattern for lists and grids.

---

## Text Input

The virtual keyboard rises from the bottom and covers content beneath (the user can still scroll/tap). The focused field must **stay visible** — auto-scroll the view if needed. The keyboard offers suggestions/spell-correction, user-settable sizes (XS/S/M/L), and language layouts. Apps can pick a keyboard configuration by context: **Default** (alphanumeric), **Email**, **Form navigation**, **URL**; set the Shift key state, toggle spell-correction, or customize the Enter key label. **Cut/Copy/Paste** is built into text fields (double-tap or long-press → context menu). Search fields are a text-field variant with a search icon + hint text (a **pill** inside a toolbar, or **full-width** inside a list).

---

## Providing Feedback

- **Pressed states** — every tappable control shows one, *immediately* on press.
- **Spinners** — for actions >1 second where you *can't* estimate duration; spins indefinitely. Embed in the relevant component (button, notification, menu item, list row) so the user knows what's busy; a large spinner over the content area shows general view progress. A button holding a spinner is disabled.
- **Progress indicators** — when you *know* the approximate duration/progress:

| Indicator | Use |
|-----------|-----|
| Progress button | Downloads/DB loads/long ops; tap X to cancel |
| Progress bar item | Progress within a list row (e.g. song preview) |
| Progress bar | Overall task progress (launch/init); no cancel |
| Progress slider | Audio/video playback position; drag/tap to seek |

---

## Alerting the User — pick the right channel

Even when the app is backgrounded (or its card dismissed), it can message the user. Choose by urgency:

| Channel | When |
|---------|------|
| **Notification** (banner / banner-only / icon) | Non-modal, discrete. Background event the user should know about but needn't act on immediately. Icons collect in the status-bar **Icon Summary**; tapping opens the **Dashboard** list; swipe to dismiss. Multiple from one app group into a single dashboard item with a count. Can play a sound and/or vibrate. |
| **Alert** | Non-modal but prominent; for **important/time-critical** events worth disturbing the user. Persists above content until dismissed or timed out. Includes an app icon, a dismiss button, and optional action buttons. **Only one alert shows at a time.** Still appears in Full Screen Mode. |
| **Dialog** | Modal; when the app needs a **decision before proceeding**. |
| **In-line text** | An error icon + message in the view, under the item that caused it; summarize multiple errors in one message. |

**Notification types:** *Banner-only* (text banner animates in, times out), *Banner* (banner then a persistent icon in the summary area), *Icon* (icon only, no banner).

**Writing messages / errors:** be concise. Avoid "please," negative phrasing ("invalid account," "wrong password"), and jargon ("server error," "timed out"). Button verbs mirror the message. For destructive actions use the **red** button style and provide a Cancel.

---

## Saving Data & Forms

Protecting data is a core driver — the rules mirror the phone guidance:

- **No "Save" button, ever.** Auto-save so work survives unexpected closures. If a form/task flow needs an explicit commit, label it **"Done," not "Save."**
- Warn before **destructive** actions that irreversibly erase data.
- If the user edits a form then swipes the card away, save the changes automatically.
- Preferences apply immediately or on exit from preferences.
- When tasking away, **save state** so the user resumes where they left off.

**Form filling** is a *task flow*: form elements go in the content area; navigation buttons (**Done / Cancel / Back**) go in the **footer**. (On phones these are absent — the Back gesture handles it.)

---

## Navigation Patterns

### Hierarchical (drilling down)

- **Sliding panes** — swipe panes left/right through levels (see Layout).
- **Zoom in/out** — tap a grid/free-form item to zoom into a new view or a pop-up above the grid; return by Back button or tapping outside the pop-up.
- **Back button** — always give a way back when drilling into a new view: a left-aligned Back button in the header/footer, ideally labeled with the previous view's title.

### Same-level (sideways)

- **Tabs** — quick access to different content sections; live in a pane header.
- **View-switching** — button groups in a header that change the *presentation* of the *same* content (Calendar Day/Week/Month; list vs. grid).
- **Pan canvas** — flick a full-screen object sideways to the next/previous (Photos).

### Combining

- **Pane peeking** — keep the top level partly visible while drilling down, so the user can both drill *and* jump sideways between sections.

### Task flow (step-by-step)

For a constrained multi-step task (not a content hierarchy). One or more actions advance/complete the flow; a Back button steps back; a Cancel aborts without saving (present from the start). **Button placement in the footer:** Back/Cancel on the **left** (side-by-side) or **bottom** (stacked); action and **Done** buttons on the **right** or **top**. "Done" completes and saves.

---

## Source & Further Reading

- **HP TouchPad webOS Design Guidelines** (HP, 2011-06-20) — the source of this file. Mirrored at `sdk.webosarchive.org/docs/design/enyo/`.
- **HP TouchPad Wireframe Stencils** — complete UI-component library (PDF + Adobe Illustrator) for wireframing app layouts.
- **Style Matters** app — bundled with the webOS 3.0 SDK; shows default framework styling.

---

## See Also

- `webos://knowledge/ui-guidelines` — the Mojo/phone HI guidelines; compare scenes-and-cards vs. views-and-panes
- `webos://knowledge/zen-of-palm` — the less-is-more design philosophy behind the sweet-spot principle
- `webos://knowledge/enyo` — Enyo 1 framework mechanics: kinds, components, events
- `webos://knowledge/touch-and-gestures` — Enyo touch/gesture event API and orientation handling
- `webos://knowledge/exhibition` — Exhibition (Touchstone dock) mode design
- `webos://knowledge/just-type` — integrating with Just Type universal search
- `webos://knowledge/synergy` — syncing data into Contacts/Calendar/Messaging
- `webos://knowledge/system-features` — Full Screen / `noWindow`, dashboards, system sounds, key events
