# [Your App Name] — webOS Project

This is a **Palm/HP webOS** application (original 2009–2012 platform, not LG webOS).

## Session Setup

At the start of every session, load the full webOS platform context:

```
webos://knowledge/all
```

This gives you knowledge of the Mojo/Enyo frameworks, Luna service bus, SDK tools (including novacom), app structure conventions, and common gotchas — so we don't have to re-establish basics each time.

---

## Project Details

<!-- Fill in the specifics for your app -->

**App ID:** `com.example.yourapp`
**Framework:** Mojo <!-- or: Enyo (TouchPad) -->
**Target devices:** Pre, Pre 2, Pre 3 <!-- list your targets -->
**webOS version(s):** 1.4.5+ <!-- minimum supported version -->

## App Structure

<!-- Briefly describe what this app does and any non-obvious structure -->

This app does [describe purpose].

Key files:
- `appinfo.json` — app manifest
- `app/assistants/stage-assistant.js` — app entry point
- `app/assistants/main-assistant.js` — main scene

## Services

<!-- If your app has a Node.js service, describe it here -->

This app [does / does not] include a backend service.

<!-- If it does:
Service ID: `com.example.yourapp.service`
The service handles: [describe what it does]
-->

## Development Notes

<!-- Anything project-specific that Claude should know:
- Non-standard patterns used in this codebase
- Known issues or constraints
- External APIs or services this app talks to
- Anything that deviates from standard webOS conventions
-->

## Useful Commands

```bash
# Package and install
palm-package com.example.yourapp/ && palm-install com.example.yourapp_*.ipk

# Launch and watch logs
palm-launch com.example.yourapp && palm-log -f com.example.yourapp

# Quick file push (during active development)
novacom put file:///usr/palm/applications/com.example.yourapp/app/assistants/main-assistant.js \
  < app/assistants/main-assistant.js
```
