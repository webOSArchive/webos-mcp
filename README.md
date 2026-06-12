# webos-mcp

An MCP (Model Context Protocol) server that gives Claude deep, persistent knowledge of legacy Palm/HP webOS development — so you don't have to re-teach Claude platform basics every session, and neither does anyone else. This effort compliments the SDK restoration at [sdk.webosarchive.org](https://sdk.webosarchive.org)

This covers the **original Palm/HP webOS (2009–2012)**, not LG's webOS TV platform. Maintained in conjunction with the [webOS Archive](https://www.webosarchive.org) project.

---

## How It Works

Claude needs to be taught webOS once per session — things like how novacom works, what `sources.json` does, how the Luna service bus operates. Without help, that knowledge disappears when the session ends and has to be re-established the next time.

This package solves that with a two-layer approach:

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: webos-mcp (this package)                  │
│  Installed once globally. Holds all the curated     │
│  webOS knowledge. Updated centrally via npm.        │
└─────────────────────────────────────────────────────┘
                          +
┌─────────────────────────────────────────────────────┐
│  Layer 2: CLAUDE.md in your project                 │
│  Added once per project. Tells Claude to load the   │
│  MCP knowledge at the start of every session,       │
│  automatically — no slash command to remember.      │
└─────────────────────────────────────────────────────┘
```

**The result:** open any webOS project in Claude Code, and Claude already knows the platform. No setup, no `/commands` to remember, no copy-pasting documentation.

---

## Setup

### Step 1 — Install the MCP server (once, globally)

**Prerequisites:** Node.js 18+, Claude Code CLI

Run this command once — no separate `npm install` needed:

```bash
claude mcp add webos-mcp -s user -- npx -y webos-mcp
```

The `-s user` flag registers the server globally (available in every project). The server starts automatically in new Claude Code sessions — you can verify it's connected with `claude mcp list`.

> **Running a local clone instead of npx?**
> ```bash
> claude mcp add webos-mcp -s user -- node /path/to/webos-mcp/index.js
> ```

> **Prefer to edit `~/.claude.json` manually?** Add this under the top-level `mcpServers` key:
> ```json
> "webos-mcp": {
>   "type": "stdio",
>   "command": "npx",
>   "args": ["-y", "webos-mcp"],
>   "env": {}
> }
> ```

### Step 2 — Add a CLAUDE.md to your webOS project (once per project)

Copy `templates/CLAUDE.md` from this repo into the root of your webOS app and fill in your project details:

```bash
curl -o CLAUDE.md https://raw.githubusercontent.com/webosarchive/webos-mcp/main/templates/CLAUDE.md
```

Then edit it — set your app ID, framework, target devices, and add any project-specific notes Claude should know.

The key part that makes loading automatic is this section in the template:

```markdown
## Session Setup

At the start of every session, load the full webOS platform context:

    webos://knowledge/all
```

When Claude opens your project, it reads `CLAUDE.md`, sees that instruction, fetches the knowledge bundle from the MCP server, and arrives pre-loaded with webOS context — without you doing anything.

---

## Knowledge Included

All files in `knowledge/` are auto-discovered and served as `webos://knowledge/<filename>`. Load everything at once with `webos://knowledge/all`, or fetch individual topics as needed mid-session.

### Core Platform

| Resource | Contents |
|----------|----------|
| `webos://knowledge/overview` | Platform architecture, versions, device matrix, Luna service bus |
| `webos://knowledge/app-structure` | `appinfo.json`, `sources.json`, directory layout, IPK packaging |
| `webos://knowledge/sdk-tools` | `palm-package`, `palm-install`, `palm-launch`, `novacom`, full dev workflow |
| `webos://knowledge/gotchas` | Hard-won knowledge — things that bite every developer |

### UI Frameworks

| Resource | Contents |
|----------|----------|
| `webos://knowledge/mojo` | Mojo framework — scenes, assistants, widgets, events (phones + early TouchPad) |
| `webos://knowledge/enyo` | Enyo 1 framework — kinds, published properties, events (TouchPad) |
| `webos://knowledge/enyo2` | Enyo 2.x — cross-platform build, Cordova, LuneOS, Android |
| `webos://knowledge/pdk` | Native C/C++ PDK apps — toolchain, SDL, packaging, jail |

### Services & Backend

| Resource | Contents |
|----------|----------|
| `webos://knowledge/services` | Luna built-in services quick reference; privileged service calls |
| `webos://knowledge/js-services` | Writing Node.js background services that register on the Luna bus |
| `webos://knowledge/synergy` | Synergy account/sync framework — Contacts, Messaging, Calendar integration |
| `webos://knowledge/ls2-roles` | LS2 hub role files — service-name registration, the lunasend impersonation pattern for recovery/migration |

### System Features

| Resource | Contents |
|----------|----------|
| `webos://knowledge/system-features` | Just Type, `noWindow`, dashboard stage, key events, system sounds |
| `webos://knowledge/system-internals` | Below-the-SDK plumbing — encrypted `/var/db`, mountcrypt/NDUID, boot event graph, jail `/proc`, debug-info binaries, binary patching |
| `webos://knowledge/exhibition` | Touchstone dock / Exhibition mode — full implementation guide |
| `webos://knowledge/alarms` | Background timers via `palm://com.palm.power/timeout`; TouchPad workaround |
| `webos://knowledge/touch2share` | Touch2Share — tap-to-share URLs over Bluetooth between TouchPads |
| `webos://knowledge/url-handlers` | Registering an app as handler for URL patterns (reverse-engineered) |

### Distribution & Packaging

| Resource | Contents |
|----------|----------|
| `webos://knowledge/postinst-packaging` | `postinst`/`prerm` scripts, setuid helpers, upstart daemons |
| `webos://knowledge/patches` | Preware/AUSMT system file patches — raw `.patch` and packaged `.ipk` |
| `webos://knowledge/updater` | App self-update via App Museum II API |
| `webos://knowledge/nizovn-packages` | Qt 5, modern glibc, OpenSSL ports for advanced PDK apps |

### Networking & Portability

| Resource | Contents |
|----------|----------|
| `webos://knowledge/tls-and-networking` | TLS 1.0 limitations, SSL-bump proxy, HTTP workarounds |
| `webos://knowledge/pwa-portability` | Multi-platform builds: webOS IPK + Android APK + PWA from one Enyo 2 codebase |

### Bundle

| Resource | Contents |
|----------|----------|
| `webos://knowledge/all` | All files concatenated — use for automatic session loading |

Also includes prompts:
- **`webos-session-start`** — manually prime Claude with full webOS context
- **`webos-new-app`** — scaffold a new Mojo or Enyo app

---

## Developer Experience

Once set up, the flow is:

```
1. Open your webOS project in Claude Code
2. Claude reads CLAUDE.md → fetches webos://knowledge/all automatically
3. Start working — Claude already knows webOS
```

You can also load specific topics mid-session:

> "Read webos://knowledge/sdk-tools before we continue"

Or manually trigger the session prompt if you're starting a webOS session outside a project:

> "Use the webos-session-start prompt"

---

## Project-Level Config (alternative to global)

If you only want the MCP server active for specific webOS projects, register it at project scope instead:

```bash
claude mcp add webos-mcp -s project -- npx -y webos-mcp
```

This writes to `.mcp.json` in the project root (commit it to share with your team). Team members will be prompted to approve the server the first time they open the project.

---

## Keeping Knowledge Current

The knowledge lives in `knowledge/` as plain Markdown files — easy to read, easy to edit, easy to contribute to.

To improve or correct anything:

1. Edit the relevant `.md` file in `knowledge/`
2. Submit a PR to [webosarchive/webos-mcp](https://github.com/webosarchive/webos-mcp)
3. When a new version is published to npm, everyone using `npx` gets it automatically on their next session

---

## License

MIT
