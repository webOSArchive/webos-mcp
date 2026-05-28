# Localization and Internationalization

webOS supports localized strings, app names, and HTML views in both Mojo and Enyo apps. The mechanisms differ slightly between frameworks but follow the same directory layout convention.

---

## Locale Directory Layout

Locale-specific files live under `resources/<locale>/` in your app directory:

```
myapp/
├── appinfo.json
├── index.html
├── resources/
│   ├── en_us/
│   │   └── strings.json
│   ├── es_us/
│   │   ├── appinfo.json     ← localized app name
│   │   └── strings.json
│   └── fr_fr/
│       ├── strings.json
│       └── views/           ← localized HTML (Mojo)
│           └── dialogs/
│               └── my-scene.html
```

Locale codes are `language_region` in lowercase (e.g., `es_us`, `fr_fr`, `de_de`).

---

## Localizing Strings: `$L()`

In both Mojo and Enyo, wrap user-visible strings with `$L()`:

```javascript
$L("Save")             // returns the translation of "Save" for the current locale
$L("Cancel")
```

The translations live in `resources/<locale>/strings.json`:

```json
{
    "Save": "Guardar",
    "Cancel": "Cancelar"
}
```

If no translation is found, `$L()` returns the original string as-is — safe to call unconditionally.

### Explicit keys

When the source string is not suitable as a translation key:

```javascript
$L({ value: "Done", key: "done_button_label" })
```

```json
{ "done_button_label": "Listo" }
```

### Strings with variables — use templates, not concatenation

Word order changes between languages. Never concatenate:

```javascript
// Wrong — breaks in languages that reorder words
"You have " + count + " messages"

// Correct — use template interpolation inside $L()
var text = $L("You have #{num} messages").interpolate({ num: count });

// Or with a Template object:
var tmpl = new Template($L("You have #{num} messages"));
var text = tmpl.evaluate({ num: count });
```

### Plurals

Use `Mojo.Format.formatChoice` for plural-aware strings:

```javascript
return Mojo.Format.formatChoice(
    count,
    $L("0#No messages|1##{num} message|1>##{num} messages"),
    { num: count }
);
```

The localized version of the format string can reorder the cases as needed for the target language.

---

## Localizing the App Name

Copy `appinfo.json` into `resources/<locale>/appinfo.json` with only the fields that change:

```json
{
    "title": "Mi Aplicación",
    "main": "../../index.html",
    "icon": "../../icon.png",
    "miniicon": "../../icon.png"
}
```

Keep the path adjustments (`../../`) — the localized `appinfo.json` is two directories deep.

---

## Localizing HTML Views (Mojo)

Place a translated copy of any scene view HTML at `resources/<locale>/views/<same-relative-path>`:

```
resources/es_es/views/dialogs/my-scene.html
```

Mojo automatically loads the localized view if one exists for the current locale.

---

## Enyo: `g11n` Globalization Package

Enyo provides a richer globalization library (`g11n-base`) with locale-aware date, time, and number formatting.

### Getting the current locale

```javascript
var uiLocale = enyo.g11n.currentLocale();     // locale for UI strings
var fmtLocale = enyo.g11n.formatLocale();     // locale for dates/numbers
```

### Locale object

```javascript
var loc = new enyo.g11n.Locale("fr_fr");
loc.getLanguage();  // "fr"
loc.getRegion();    // "fr"
loc.isMatch(enyo.g11n.currentLocale());  // true if compatible
```

### Date and time formatting

```javascript
// Format a date for the current locale
var fmt = new enyo.g11n.DateFmt({ date: "long" });
var str = fmt.format(new Date());

// Format a time
var timeFmt = new enyo.g11n.DateFmt({ time: "short" });

// Date + time together
var dtFmt = new enyo.g11n.DateFmt({ format: "medium" });

// Check 12 vs 24 hour clock
var fmts = new enyo.g11n.Fmts();
if (fmts.isAmPm()) { /* 12-hour clock locale */ }

// First day of week (0 = Sunday)
var firstDay = fmts.getFirstDayOfWeek();
```

### Localized resource bundles (Enyo libraries/packages)

For library code that can't use the global `$L()`, create a `Resources` object:

```javascript
this.resources = new enyo.g11n.Resources({ root: "." });
var str = this.resources.$L("Hello");
```

Resource files for Enyo live at `resources/<lang>/<lang>_<region>.json` or similar paths — consult `enyo.g11n.Resources.getResource()` fallback order: variant → region → language → English → unlocalized.

---

## File Encoding

All `strings.json` and `appinfo.json` files must be **UTF-8 without BOM**. A byte order mark will cause parsing failures.

---

## See Also

- `webos://knowledge/app-structure` — Full `appinfo.json` structure and the `resources/` directory layout
- `webos://knowledge/enyo` — Enyo 1 framework overview
- `webos://knowledge/mojo` — Mojo framework overview
