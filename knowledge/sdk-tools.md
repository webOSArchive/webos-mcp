# webOS SDK Tools

The webOS SDK provides command-line tools for packaging, installing, launching, and communicating with webOS devices and the emulator. The updated SDK for modern machines is available from https://www.webosarchive.org.

All tools operate over a USB connection to a real device or against a running emulator instance.

## palm-package

Packages an app directory into an installable `.ipk` file.

```bash
palm-package <app-directory>

# Example:
palm-package com.example.myapp/
# Output: com.example.myapp_1.0.0_all.ipk
```

The app directory must contain a valid `appinfo.json`. The output filename is derived from the app ID and version. If packaging fails, check:
- `appinfo.json` is valid JSON with required fields (`id`, `version`, `vendor`, `type`, `main`, `title`)
- All files listed in `sources.json` actually exist
- No files exceed the size limits

## palm-install

Installs a packaged `.ipk` to a connected device or running emulator.

```bash
palm-install <package.ipk>

# Install to a specific target when multiple are connected:
palm-install -d <device-id> <package.ipk>

# List connected devices:
palm-install -l

# Remove an installed app:
palm-install -r <app-id>
```

## palm-launch

Launches an installed app or service on the device/emulator.

```bash
# Launch an app:
palm-launch <app-id>

# Launch with parameters (passed to the stage assistant):
palm-launch -p '{"key":"value"}' <app-id>

# Close a running app:
palm-launch -c <app-id>

# List running apps:
palm-launch -l
```

## palm-log

Streams the device log to your terminal. Shows output from `Mojo.Log.*`, `enyo.log`, `enyo.warn` or `enyo.error` calls in apps, and `console.log` in services. Does not show system logs.

```bash
palm-log <app-id>

# Follow in real time:
palm-log -f <app-id>
```

## palm-run

Installs a packaged `.ipk` to a connected device or running emulator, launches it, and streams the device log to your terminal. Shows output from `Mojo.Log.*`, `enyo.log`, `enyo.warn` or `enyo.error` calls in apps, and `console.log` in services.  Does not show system logs.

```bash
palm-run <app-folder>
```

## palm-emulator

Launches the webOS emulator (requires VirtualBox).

```bash
palm-emulator
```

The emulator presents as a connected device to other SDK tools. The emulator image and setup instructions are available from https://github.com/webosarchive/webos-emulator.

## novacom

`novacom` is a general-purpose communication tool for webOS devices — the most powerful and versatile tool in the SDK. It provides shell-level access to the device over USB, enabling you to run arbitrary commands, transfer files, watch system logs, spelunk the filesystem, and push or pull data.

### Basic Usage

```bash
# Open an interactive shell on the device:
novacom -t open tty://

# Run a single command and return output:
novacom run 'ls /media/internal'

# Run a command as root:
novacom run 'luna-send -n 1 palm://com.palm.applicationManager/listApps {}'
```

### File Transfer

```bash
# Copy a file FROM the device to your machine:
novacom get file:///path/on/device /local/path

# Copy a file TO the device:
novacom put file:///path/on/device < /local/file

# Example — grab a log file:
novacom get file:///var/log/messages ./device-messages.log

# Example — push a file to the device:
novacom put file:///media/internal/myfile.txt < ./myfile.txt
```

### Log Watching

```bash
# Stream the system log in real time:
novacom run 'tail -f /var/log/messages'

# Filter for your app's output:
novacom run 'logread -f' | grep 'com.example.myapp'
```

### Filesystem Spelunking

```bash
# Explore app installation directories:
novacom run 'ls /usr/palm/applications/'
novacom run 'ls /media/cryptofs/apps/usr/palm/applications/'

# Check what's running:
novacom run 'ps aux'

# Check disk usage:
novacom run 'df -h'

# Read a config file on the device:
novacom run 'cat /usr/palm/applications/com.example.myapp/appinfo.json'
```

### Luna Bus Interaction

```bash
# Send a Luna command directly from the host via novacom:
novacom run 'luna-send -n 1 palm://com.palm.applicationManager/listApps {}'
novacom run 'luna-send -n 1 palm://com.palm.connectionmanager/getStatus {}'

# Subscribe to ongoing Luna updates:
novacom run 'luna-send -i palm://com.palm.connectionmanager/getStatus {"subscribe":true}'
```

### Force-Pushing Bits (Advanced)

```bash
# Push a new version of a file directly (bypass packaging/install):
novacom put file:///usr/palm/applications/com.example.myapp/app/assistants/main-assistant.js \
  < app/assistants/main-assistant.js

# Then restart the app:
novacom run 'luna-send -n 1 palm://com.palm.applicationManager/close {"processId":"1234"}'
novacom run 'luna-send -n 1 palm://com.palm.applicationManager/launch {"id":"com.example.myapp"}'
```

> Force-pushing files is useful during development to avoid the full package/install cycle. Changes survive until the device is rebooted or the app is reinstalled. Be aware of Jails (see gotchas.md)

### Targeting Specific Devices

When multiple devices are connected:
```bash
# List connected devices:
novacom -l

# Run command on a specific device:
novacom -t -d <device-name> open tty://
```

## luna-send

`luna-send` is a command-line tool for making Luna service calls. It can be run on the device via novacom or (in some SDK configurations) directly on the host.

```bash
# Single call (returns one response):
luna-send -n 1 palm://com.palm.applicationManager/listApps {}

# Subscription (returns ongoing responses, Ctrl+C to stop):
luna-send -i palm://com.palm.connectionmanager/getStatus '{"subscribe":true}'

# Make this exact call as a specific LS2 service name (requires that name to
# be in the lunasend role file's allowedNames — see ls2-roles.md):
luna-send -t 1 -m com.example.myapp palm://com.palm.db/find '{"query":{"from":"…:1"}}'

# Average over N calls and print each response's timing (also useful as a
# blunt-force "wait for response" mode when -n 1 returns too eagerly):
luna-send -t 5 palm://com.palm.foo/bar '{}'
```

### `-t` vs `-n`

| Flag | What it does |
|---|---|
| `-n N` | Exit after N responses arrive. `-n 1` is the common "one-shot" idiom. |
| `-t N` | Time N successive responses and report averages. Useful as a "show me the response, with timing info" mode. |
| `-i` | Interactive subscription. Keeps printing responses until Ctrl-C. |
| `-m NAME` | Register as this LS2 service name. Subject to the calling binary's role file. |
| `-P` | Send over the public bus (default is private). |

### Stdout vs stderr (matters for scripting)

`luna-send` writes the actual response (the `Got response: … payload {…}` line) to **stderr**, not stdout. The `Total time …` summary and byte counts go to stdout. Naive redirection captures the wrong stream:

```bash
# WRONG — resp.json gets only the timing line, not the response payload:
luna-send -t 1 palm://com.palm.db/find '{…}' > resp.json

# RIGHT — merge stderr into stdout first:
luna-send -t 1 palm://com.palm.db/find '{…}' > resp.json 2>&1
# Now resp.json has the payload line; parse with: sed -n 's/.*payload //p' < resp.json | head -1
```

The "Got response" line is GLib's `g_message`, which always writes to stderr by design. This is the most common reason a `luna-send` capture script "returns nothing."

## Workflow: Typical Development Loop

```bash
# 1. Edit code
# 2. Launch and follow logs:
palm-run com.example.myapp/

# 3. Install:
palm-install com.example.myapp_1.0.0_all.ipk

# 4. Launch:
palm-launch com.example.myapp

# 5. Watch logs:
palm-log -f com.example.myapp

# --- or for rapid iteration, skip packaging and force-push changed files:
novacom put file:///usr/palm/applications/com.example.myapp/app/assistants/main-assistant.js \
  < app/assistants/main-assistant.js
palm-launch -c com.example.myapp
palm-launch com.example.myapp
```

## Workflow: Simulate typical distribution install

```bash
# 1. Package
palm-packaging com.example.myapp/

# 3. Install:
palm-install com.example.myapp_1.0.0_all.ipk

# 4. Launch:
palm-launch com.example.myapp

# 5. Watch logs:
palm-log -f com.example.myapp
```

See gotchas.md for a-typical distribution notes