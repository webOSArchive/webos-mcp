# Launching System Apps (Application Manager)

Apps communicate with built-in system apps — browser, calendar, email, camera, maps, messaging, phone, contacts — via the Application Manager service (`com.palm.applicationManager`). There are two methods:

- **`launch`** — Brings up an app by its app ID with optional parameters. Used when you just want to open an app, or navigate it to a particular state.
- **`open`** — Opens a resource (URL, file path, URI scheme) and lets the system pick the appropriate app. Used for mailto: links, tel: URIs, file viewing, and similar.

---

## Browser

```javascript
// Mojo — open a URL in a new browser card
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: { target: "http://www.example.com" }
});

// Enyo
this.$.appManager.call({ target: "http://www.example.com" });
// (PalmService: service="palm://com.palm.applicationManager/", method="open")
```

---

## Phone

```javascript
// Pre-populate the dialer (user must still tap dial)
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: { target: "tel://4085551234" }
});

// DTMF tones: t = 2.5s pause (CDMA), p = wait for user tap
// Example: dial 415-555-4242, pause, send 23, wait, send 99
{ target: "tel://4155554242t23p99" }
```

---

## Email

```javascript
// Simple mailto: URI
{ method: "open", parameters: { target: "mailto:user@example.com?subject=Hello" } }

// Pre-populate compose view with full details
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: {
        id: "com.palm.app.email",
        params: {
            summary: "Subject line",
            text: "Body text",
            recipients: [{
                type: "email",
                role: 1,
                value: "user@example.com",
                contactDisplay: "User Name"
            }],
            attachments: [{
                fullPath: "/media/internal/documents/report.pdf",
                displayName: "report.pdf",
                mimeType: "application/pdf"
            }]
        }
    }
});
```

---

## Calendar

```javascript
// Open calendar to a specific date (timestamp in milliseconds)
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "launch",
    parameters: {
        id: "com.palm.app.calendar",
        params: { date: String(Date.now()) }
    }
});

// Create a new event (user must confirm)
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: {
        id: "com.palm.app.calendar",
        params: {
            summary: "Team meeting",
            dtstart: 1304226000000,   // ms since epoch
            dtend:   1304229600000,
            location: "Conference Room A"
        }
    }
});
```

---

## Messaging

```javascript
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "launch",
    parameters: {
        id: "com.palm.app.messaging",
        params: {
            messageText: "Hello!",
            composeRecipients: [{
                address: "4085551234",       // phone number or IM address
                serviceName: "SMS"
            }]
        }
    }
});
```

---

## Camera

Cross-app camera capture returns control to your app after the user takes a photo or cancels:

```javascript
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "launch",
    parameters: {
        id: "com.palm.app.camera",
        params: {
            name: "capture",
            sublaunch: true,          // return to caller after capture
            mode: "still",            // or "video"
            filename: "/media/internal/myphoto.jpg"  // optional
        }
    },
    onSuccess: function(e) {
        // e.filename — path to the captured image
    }
});
```

---

## Contacts — Add or Pick

**Add a new contact** (user confirms in Contacts app):

```javascript
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: {
        id: "com.palm.app.contacts",
        params: {
            name: { givenName: "John", familyName: "Doe" },
            phoneNumbers: [{ value: "4085551234", type: "type_work", primary: true }],
            emails: [{ value: "john@example.com", type: "type_work", primary: true }]
        }
    }
});
```

**People Picker** (Mojo only) — push the Contacts picker scene; selected Person is passed to your scene's `activate()`:

```javascript
this.controller.stageController.pushScene(
    { appId: "com.palm.app.contacts", name: "list" },
    { mode: "picker", message: "Select a contact" }
);

MyScene.prototype.activate = function(person) {
    if (person) {
        // person is a Contact object with name, phoneNumbers, emails, etc.
    }
};
```

Note: Apps cannot read the contacts database directly for privacy reasons. People Picker is the only sanctioned way to read a contact the user selects.

---

## Viewing Files and Documents

```javascript
// Open any supported file type — webOS picks the right viewer
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "open",
    parameters: { target: "/media/internal/documents/report.pdf" }
});

// Supported: PDF, Office docs (Word, Excel, PowerPoint), images, and more
// See Resource Types in the SDK for the full list
```

---

## Checking if an App is Installed

```javascript
this.controller.serviceRequest("palm://com.palm.applicationManager", {
    method: "getAppInfo",
    parameters: { id: "com.example.otherapp" },
    onSuccess: function(e) { /* app exists */ },
    onFailure: function(e) { /* not installed */ }
});
```

---

## See Also

- `webos://knowledge/url-handlers` — Registering your app to *receive* URI scheme launches
- `webos://knowledge/mojo` — Scene lifecycle and cross-scene/cross-app navigation patterns
- `webos://knowledge/services` — Full Luna bus reference
