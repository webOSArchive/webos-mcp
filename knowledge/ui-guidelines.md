# webOS UI Design Guidelines

Palm's official *webOS User Interface Design Guidelines* (v0.9, 2009) — the human-interface rulebook for original webOS apps. It describes how a webOS app should *look and behave* so it feels native alongside the built-in apps (Email, Calendar, Contacts, Phone). This is the design counterpart to the framework mechanics in `mojo.md` — it tells you *which* control to use, *when*, and *why*, and maps each one to its Mojo widget/CSS class.

Applies to the original Palm/HP webOS (Pre/Pixi/TouchPad, 2009–2012). The philosophical foundation behind these rules is captured separately in `zen-of-palm.md`.

---

## Design Philosophy — the "Palm Way"

Five principles drive every good webOS app. Users learn the platform from the built-in apps; if your app follows the same conventions, they already know how to use it.

- **Do one thing well.** Write a one-sentence *statement of purpose* and use it to decide what goes in — and what stays out. (Email manages email. It does *not* manage contacts or open PDFs — it leans on other apps for that.)
- **Leverage other apps and their data.** Don't re-create Contacts, Maps, or the browser. Tap a phone number to call, an address to map it. The platform is a set of cooperating apps, not silos.
- **Design for short bursts.** Mobile users often have only 10–15 seconds. Optimize the most common tasks so they take the fewest steps.
- **Design a beautiful app for free.** Start with the default controls and styling. They already look good, are correctly sized for touch, and have proper whitespace. Customize *later*, if at all.
- **Delight.** An app is a favorite when it helps the user finish something important quickly and elegantly.

> "Don't try to fit a mountain into a teacup." Focus on what users truly need on the go.

---

## The Design Process

Palm recommends designing on paper *before* writing code:

1. **Statement of purpose** — one sentence. What does this app do, and for whom?
2. **Sketch the workflow** — draw a box per scene, connect with arrows for taps. Ask: does this accomplish the primary tasks in the fewest steps?
3. **Set performance goals** — e.g. "read email quickly," "compose quickly." These keep the design honest.
4. **Sketch each scene** — header, scroll view, command buttons, app-menu commands.
5. **Prototype** with real Mojo widgets.
6. **Usability test early and often** (see below).

Design is iterative — "more like editing a poem than a novel." Every element must earn its place.

---

## Scene Anatomy

A webOS app is a stack of **scenes** (see `mojo.md`). Each scene commonly has:

| Element | Role | Height |
|---------|------|--------|
| **Header** (optional) | Scene title + view-affecting controls | Fixed: 50px · Scrolling: variable (~68px) |
| **Scroll View** | The content/controls; scrolls freely | Fills remaining space |
| **Command Menu** (optional) | Up to 5 buttons for the most important actions; floats above scrolling content, always visible | 50px |
| **Application Menu** | "Other" commands, top-left in the status bar | — |

### Fixed vs. scrolling headers

- **Fixed header** stays put; content scrolls *under* it. Use `palm-header`. Good when the title/controls must remain reachable.
- **Scrolling header** scrolls out of view with the content. Use `palm-page-header`. Good when the header is just a title.
- **View Menu** = fixed header + pop-up menu that controls what's shown below (`Mojo.Menu.viewMenu`).

---

## Screen Dimensions (Palm Pre)

The Pre screen is **320×480 (portrait) / 480×320 (landscape)**. OS chrome eats into it:

| Area | Size | Notes |
|------|------|-------|
| Status Bar | 28px top | Always present (App Menu, clock, connection) |
| Notification Bar | 28px bottom | Appears when a background app posts a notification; pushes your app up |
| Popup Notification | up to ½ screen | Transient overlay — don't design around its height |

**Worked example:** fixed header (50) + notification allowance (28) + status bar (28) = 106px of overhead, leaving roughly **320×374 portrait** / **480×214 landscape** of usable content area. Plan for the notification bar appearing.

**Full Screen Mode** — games and media apps can hide the Status and Notification bars for an immersive experience. Popup Notifications still come through (so you never miss a call or alarm).

---

## Cards vs. Scenes — Navigation

- The app launches into a **card**. Push new **scenes** within that card for the normal flow; the **Back gesture** (right-to-left swipe over the gesture area) pops to the previous scene.
- **Open a new card only when it purposefully supports the workflow** — e.g. composing a reply, so the user can break away, check another email, and return without losing work. Extra cards cost device resources and clutter the card view.
- Many apps run perfectly in a single card (Calendar does). Default to same-card scenes.
- **Re-use scenes** for related actions — Compose, Reply, Reply All, and Forward are all the same scene with different pre-filled content.

### Scene transition animations (use consistently)

| Movement | Effect |
|----------|--------|
| Down into the scene hierarchy | Zoom In |
| Up the hierarchy / Back gesture | Zoom Out |
| Sideways (same level) | Cross-Fade |
| Launching another app | New Card |

---

## No Save Button — autoSave

The platform's interaction model is "everything is live." **There is no Save button.** Persist changes automatically when:

- the user edits a field and taps into another,
- the user edits a value then performs the Back gesture,
- the user edits, minimizes to a card, then quits.

**Exception:** when a mistaken auto-save could lock the user out or destroy data (e.g. changing a password), provide explicit **Commit / Discard** buttons instead. If the consequences of autoSave outweigh the benefit, let the user save deliberately.

---

## Good Platform Citizenship

- **Plan for interruptions.** A notification or incoming call can arrive anytime. Games should `autoPause` on a Popup Notification or when minimized to a card.
- **Use resources responsibly.** When minimized to a card, throttle back — stop or slow network polling so the foreground app (the one the user cares about) gets the resources.

---

## UI Control Catalog

Every control below maps to a Mojo widget or CSS class. Use standard controls wherever possible — they're familiar, correctly sized for touch, and styled for free.

### Headers & commands

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Scrolling Header | Title that scrolls away | `palm-page-header` |
| Fixed Header | Title that stays put | `palm-header` |
| View Menu | Fixed header + pop-up that controls the view | `Mojo.Menu.viewMenu` |
| Command Buttons | Most important scene actions (max 5) | `Mojo.Menu.commandMenu` |
| Command Button Group | 2+ mutually-exclusive command buttons (e.g. Day/Week/Month) | `Mojo.Menu.commandMenu` with a Menu Group |
| Application Menu | "Other" commands, submenus | `Mojo.Menu.appMenu` |

**Command button icons:** 32×64px PNG (24-bit RGB + 1-bit alpha). Top 32px holds the 24×24 unpressed image; bottom 32px the pressed state.

### Text & buttons

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Title | Static title text | `palm-body-title` |
| Body Text | Static explanatory text | `palm-body-text` |
| Info Text | Secondary/help text under a control | `palm-info-text` |
| Text Field | Editable text (single/multi-line, autoGrow, autoTruncate) | `Mojo.Widget.TextField` |
| Rich Text Field | Text with bold/italic/underline/color | `Mojo.Widget.RichTextEdit` |
| Password Field | Masks all but the last-typed char | `Mojo.Widget.Password` |
| Push Button | Trigger an action (primary/secondary, affirmative/negative) | `Mojo.Widget.Button` |

### Value selectors

| Control | Purpose | Implementation |
|---------|---------|----------------|
| Checkbox | On/off toggle; label states clearly | `Mojo.Widget.Checkbox` |
| Segmented Button | Pick one of several (radio) | `Mojo.Widget.RadioButton` |
| Toggle Button | Switch-style on/off | `Mojo.Widget.ToggleButton` |
| MultiToggle Button | Cycle through multiple states | (successive presses) |
| Pop-Up Menu | Tap to pick one from a list | `Mojo.Widget.ListSelector` |
| Date Picker | Month/day/year pop-ups | `Mojo.Widget.DatePicker` |
| Time Picker | Hour/minute/AM-PM pop-ups | `Mojo.Widget.TimePicker` |
| Integer Picker | Numeric range pop-up | `Mojo.Widget.IntegerPicker` |
| Slider | Drag a knob between min/max | `Mojo.Widget.Slider` |

### Lists & organizers

| Control | Purpose | Implementation |
|---------|---------|----------------|
| List | Single-selection or action list; rows can hold multiple tap targets | `Mojo.Widget.List` + `palm-rows` |
| Multiple Selection List | Checkbox per row | `Mojo.Widget.List` + `palm-list` |
| Group Box | Bordered, optionally titled list | `Mojo.Widget.List` + `palm-group` |
| Filter List | Entry field that filters an inline list | `Mojo.Widget.FilterList` |
| Filter Field | Text input feeding a list you render | `Mojo.Widget.FilterField` |
| Divider | Header line for a group of rows | `Mojo.Widget.List` divider attrs |
| Collapsible Divider | Divider with an open/close button | `Mojo.Widget.List` divider attrs |
| Drawer | Shows/hides contained items | `Mojo.Widget.Drawer` |

Lists support: add-item, alphabetical dividers, drag-to-reorder, expandable/collapsible dividers, and swipe-to-delete.

### Data & media

| Control | Purpose | Implementation |
|---------|---------|----------------|
| People Picker | Pick/attach a Contacts record | `Mojo.Widget.PeoplePicker` |
| File Picker | Full-screen file chooser (filterable by type) | Pickers |
| Media Player | Full-screen media playback within your app | Video Playback widget |
| WebView | Embed web content (full scene or framed) | `Mojo.Widget.WebView` |
| ImageView | Pan/zoom/navigate images | `Mojo.Widget.ImageView` |

---

## The Application Menu

A dynamic menu present in every scene, top-left. By default contains:

- **Edit** — always first; holds Cut/Copy/Paste (a Drawer submenu). Enabled only when a text field has focus. Paste enables only when the clipboard holds text the focus accepts; Copy when text is selected (or the app exposes its scene as text); Cut when text is selected in an editable field. Always present (even if disabled) so the menu layout stays scannable.
- **Scene commands** — insert up to ~4 per scene between Edit and Preferences. More forces scrolling; avoid it.
- **Preferences / Accounts** — include in *every* scene if the app has them; show "Preferences" before "Accounts." Omit entirely if there are none.
- **Help** — opens the app's help.

**Naming:** title case; add an ellipsis (`Add Bookmark…`) when selecting the item requires further action to complete the task; no ellipsis when it simply opens a scene (`Bookmarks`).

**Dynamic state:** *disable* (gray out) an action that's normally available here but not right now (communicates it exists). *Suppress* an action entirely when users wouldn't expect it in this context. Items may also swap (speakerphone → Bluetooth submenu) or reflect internal state.

---

## Providing Feedback

### Progress & activity — show for anything ≥ 2 seconds

**Progress indicators** (you know how long / how much is done):

| Widget | Use |
|--------|-----|
| Progress Pill (`Mojo.Widget.ProgressPill`) | Downloads/loads; has an X to cancel |
| Progress Slider (`Mojo.Widget.ProgressSlider`) | Audio/video scrubbing |
| Progress Bar (`Mojo.Widget.ProgressBar`) | Launch/init; no cancel |
| Inline Progress Bar | e.g. previewing a song in a list row |

**Activity indicators** — spinners (`Mojo.Widget.Spinner`) — when you *can't* estimate duration. Small ones go in a menu item, a button, the notification bar, or a tapped list row. Avoid a big spinner floating over a whole list; show a progress scene instead if other taps would degrade responsiveness.

### Dialogs

`Dialog Panel` rises from the bottom, attached to the current scene, when the app needs a decision to continue. Works in the foreground or when minimized to a card.

### Errors

Report an error only when it impacts the user and the app can't quietly fix it:

| Where | When |
|-------|------|
| Banner notification | User only needs to *know*, no action required |
| Dialog panel | App can't continue without a decision |
| Inline message | Alert icon + message under the item that caused it |

**Writing error messages:** be concise. Avoid "please," negative phrasing ("invalid account," "wrong password"), and jargon ("server error," "timed out"). Prefer "Try again." Button verbs should mirror the message language. For destructive actions, use the destructive (red) button style and provide a Cancel.

---

## Notifications & Dashboard Apps

The platform lets a *background* app tell the user something without interrupting them.

- **Banner Notification** — slides in at the bottom (a summary icon + message), doesn't overlay the foreground app, minimizes to a dashboard icon after a few seconds. Optional; some apps (Email) gate it behind a preference (off by default).
- **Dashboard Summary** — the persistent icon a banner collapses to. Tapping opens the Dashboard View; the user flicks an item right to dismiss or taps to open. Represent a single event as one tap target; accumulated events (e.g. "30 emails") with two targets (open latest vs. show list). Your app owns the icons and text.
- **Popup Notification** — slides up from the bottom for *urgent* things needing interaction (calendar alarm, USB-connect prompt). You design its UI; keep it small — never more than half the screen height. Not suppressed even in Full Screen Mode.

**Dashboard apps** provide a service (weather, stock ticker, surf report) with minimal UI — typically one config card plus notifications. They must have an app icon and some UI so the user can configure it, be notified, and quit it.

---

## Layout & Customization

Defaults give you a light-gray background with correctly-contrasting, touch-sized controls and proper whitespace. Color and font choices carry meaning consistently:

- **Enabled vs. disabled** — high contrast = tappable; low contrast = disabled.
- **Primary vs. secondary** — dark-gray button = primary action; lighter gray = other.
- **Destructive vs. constructive** — **red** = destructive; **green** = constructive/positive.

**Two built-in styles:** the default (light background/dark controls) and **`palm-dark`** (dark background/light controls, as used by Music and Videos). Pick whichever matches your background.

**Customizing:**

- **Change the backdrop** — often enough on its own; pair with default or `palm-dark` controls.
- **Fonts** — you may adjust font *colors* for your look, but **do not change font sizes** (they're chosen for readability/consistency). Ensure your colors contrast properly and still convey enabled/disabled meaning.
- **Responsive layout** — size scene elements *flexibly* (e.g. width 100%, unset height) rather than with fixed pixels, so scenes reflow correctly when the device rotates between portrait and landscape.

---

## Usability Testing

The only way to know if real users can use your app is to let them try it — early and often.

- Recruit *regular people* (not friends/colleagues) — e.g. a short craigslist ad, offer a small reward. Test where they'd actually use it (park, couch, in line, on a bus).
- Ask them to perform *meaningful tasks* from your statement of purpose, then let them explore.
- Watch and listen; let them struggle a little before helping. Ask what they were trying to do when they get stuck.
- Look for *trends* — if many people hit the same wall, the design (or implementation) is wrong. Record every problem.
- Brainstorm fixes using standard controls/interactions; take user suggestions as input, not gospel. Fix, then test again.

---

## Prepare for Delivery

**App icons:**

- 64×64px PNG with a 56×56 image centered, **and** 48×48px PNG with a 42×42 image centered.
- 24-bit RGB + 1-bit alpha.
- **No glossy shine.** Place the image on a rectangular base (Music, Videos) or use a photo-realistic image with a transparent circle behind it (Web, Camera, Photos).

**Submit:** run the app through the Application Checklist, write a description, add keyword tags so it's searchable, and include screenshots (capture with **Orange + Sym + P** → Screen Captures folder on the mounted device).

---

## See Also

- `webos://knowledge/zen-of-palm` — the design *philosophy* (less-is-more, the sweet spot, 80/20 rule) these rules grew out of
- `webos://knowledge/mojo` — the Mojo framework mechanics: scenes, assistants, and how to instantiate these widgets
- `webos://knowledge/touch-and-gestures` — touch events, standard gestures, and orientation handling
- `webos://knowledge/system-features` — Full Screen / `noWindow`, dashboard stage, system sounds, key events
- `webos://knowledge/enyo` — Enyo 1 UI framework (TouchPad); the same design principles apply
