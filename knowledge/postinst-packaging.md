# Advanced Packaging: postinst/prerm Scripts

## Overview

webOS `.ipk` packages follow the Debian package format and support `postinst` (post-install) and `prerm` (pre-remove) shell scripts that run **as root** during installation and removal. This enables apps to:

- Install setuid root helper binaries to `/usr/bin`
- Register upstart jobs in `/etc/event.d/` (auto-start on boot)
- Start system daemons immediately after install
- Clean up system files and stop daemons on uninstall
- Do anything a root shell script can do on a Linux system

**Reference implementation:** [ACL Manager](https://github.com/webOSArchive/acl-manager) — a PDK app that installs a setuid helper and an upstart daemon.

---

## Critical: Preware / WebOS Quick Install Required

**`palm-install` does NOT run postinst/prerm scripts.** It runs as a non-root user, so even if the scripts are present they cannot do anything requiring root privileges.

Apps that use postinst/prerm **must** be installed via:
- **Preware** (on-device package manager)
- **WebOS Quick Install** (desktop tool that installs via ipkg)

Both of these use `ipkg` which runs the control scripts as root. Document this prominently for users — a common support issue is that users install via `palm-install` and the app's daemon/helper is never set up.

---

## The `.ipk` Format

An `.ipk` is an `ar` archive containing exactly three members:

```
debian-binary     — contains "2.0\n"
control.tar.gz    — package metadata + install/remove scripts
data.tar.gz       — the actual files to install onto the filesystem
```

### What goes in `control.tar.gz`

```
./control     — package metadata (name, version, description, depends, etc.)
./postinst    — (optional) shell script run after install
./prerm       — (optional) shell script run before removal
./postrm      — (optional) shell script run after removal
./preinst     — (optional) shell script run before install
```

`palm-package` generates a minimal `control.tar.gz` that contains only the `control` file. To add `postinst`/`prerm`, you must manually repack.

---

## The Repack Pattern

`palm-package` creates the base `.ipk`. A build script then extracts, adds scripts, and repacks:

```bash
#!/bin/bash
# After palm-package creates the .ipk, inject postinst/prerm

PALM_PACKAGE="/opt/PalmSDK/Current/bin/palm-package"
"$PALM_PACKAGE" .     # Creates com.example.myapp_1.0.0_all.ipk

IPK=$(ls -t *.ipk | head -1)

# Work in a temp directory
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Extract the ar archive
(cd "$WORK_DIR" && ar x "$IPK")

# Extract the existing control.tar.gz
mkdir -p "$WORK_DIR/ctrl"
tar -xzf "$WORK_DIR/control.tar.gz" -C "$WORK_DIR/ctrl"

# Add postinst and prerm
cp postinst "$WORK_DIR/ctrl/postinst"
cp prerm    "$WORK_DIR/ctrl/prerm"
chmod 755 "$WORK_DIR/ctrl/postinst" "$WORK_DIR/ctrl/prerm"

# Repack control.tar.gz
(cd "$WORK_DIR/ctrl" && tar -czf "$WORK_DIR/control.tar.gz" .)

# Rebuild the ar archive (don't 'ar r' an existing archive — use 'ar rc' fresh)
(cd "$WORK_DIR" && ar rc repacked.ipk debian-binary control.tar.gz data.tar.gz)
mv "$WORK_DIR/repacked.ipk" "$IPK"

echo "Done: $IPK"
echo "Install via Preware or WebOS Quick Install — NOT palm-install"
```

### Verify the repack

```bash
# Should list: debian-binary, control.tar.gz, data.tar.gz
ar t com.example.myapp_1.0.0_all.ipk

# Should include postinst and prerm:
tar -tzf <(ar p com.example.myapp_1.0.0_all.ipk control.tar.gz)
```

---

## `postinst` Script

```sh
#!/bin/sh
#
# postinst — runs as root via Preware/ipkg after the package is installed.
# Will NOT run correctly if installed with palm-install (non-root).
#

set -e

# The app bundle is always installed here (substitute your app ID):
APP_DIR="/media/cryptofs/apps/usr/palm/applications/com.example.myapp"

echo "myapp: installing device components..."

# Install a setuid root helper binary.
# MUST go to /usr/bin (or another non-nosuid filesystem).
# /media/cryptofs is mounted nosuid — setuid bits there are silently ignored.
cp "$APP_DIR/my-helper" /usr/bin/my-helper
chmod 4755 /usr/bin/my-helper      # 4 = setuid bit; 755 = rwxr-xr-x
echo "  installed /usr/bin/my-helper (setuid root)"

# Install a daemon script.
cp "$APP_DIR/my-daemon.sh" /usr/bin/my-daemon
chmod 755 /usr/bin/my-daemon

# Install an upstart job (auto-starts on boot).
cp "$APP_DIR/my-daemon.conf" /etc/event.d/my-daemon
chmod 644 /etc/event.d/my-daemon
echo "  installed upstart job"

# Start the daemon immediately (without waiting for reboot).
start my-daemon 2>/dev/null && echo "  started my-daemon" \
    || echo "  my-daemon will start on next boot"

echo "myapp: install complete."
exit 0
```

### Key points

- `set -e` — fail fast on errors; ipkg will report failure and may rollback
- `APP_DIR` is always `/media/cryptofs/apps/usr/palm/applications/<app-id>`
- Files from the app bundle are copied to system locations — they cannot simply be linked because the app directory is on a nosuid, user-owned filesystem
- `start <job>` uses webOS's upstart to start the job immediately; errors are soft-suppressed because the job may legitimately start on next boot if upstart is in an odd state

---

## `prerm` Script

```sh
#!/bin/sh
#
# prerm — runs as root before the package files are removed.
#

echo "myapp: removing device components..."

# Stop the daemon gracefully.
stop my-daemon 2>/dev/null && echo "  stopped my-daemon" || true

# Clean up system files.
rm -f /usr/bin/my-helper
rm -f /usr/bin/my-daemon
rm -f /etc/event.d/my-daemon

# Remove state/control files (leave user data alone).
rm -f /media/internal/.my-app-control
rm -f /media/internal/.my-app-state

echo "myapp: removal complete."
exit 0
```

**Leave user data intact.** Remove control/state files created by your daemon, but do not remove files the user created (documents, saves, etc.) in `/media/internal/`.

---

## The Daemon Pattern: Jailed App + Root Daemon

PDK apps run inside a **security jail**:
- Non-root user
- `/usr/bin` is mounted `nosuid` (setuid bits have no effect)
- Separate `/tmp` from the system

To perform privileged operations (kill other processes, manage services, write to system directories), use a two-process architecture:

```
[PDK App in jail]                    [Root Daemon outside jail]
      |                                        |
      | writes command to                      | polls control file
      | /media/internal/.my-app-control        | every 1 second
      |------------------------------------→   |
                                               | reads and removes file
                                               | calls setuid helper
                                               ↓
                                    [setuid root helper]
                                    performs privileged operation
```

### Why `/media/internal/` for IPC

`/media/internal/` (USB mass storage, visible to PC when connected) is accessible from both:
- Inside the PDK jail (app can write here)
- Outside the jail (daemon reads from outside)

The jail's `/tmp` is **different** from the system's `/tmp` — don't use `/tmp` for IPC between jailed and non-jailed processes.

### Upstart Job: `my-daemon.conf` (→ `/etc/event.d/`)

```
# /etc/event.d/my-daemon
# Upstart job for my-app's background daemon

description "My App daemon"

start on started luna
stop on stopping luna

respawn
respawn limit 5 30

exec /usr/bin/my-daemon
```

- `start on started luna` — starts when Luna (the webOS window manager) starts
- `stop on stopping luna` — stops when Luna stops (device shutdown/restart)
- `respawn` — automatically restarted if it crashes (up to 5 times in 30 seconds)

### Daemon Script: `my-daemon.sh`

```sh
#!/bin/sh
# Daemon that monitors control file and performs privileged operations.
# Runs as root outside the PDK jail via the upstart job.

CONTROL_FILE="/media/internal/.my-app-control"
HELPER="/usr/bin/my-helper"
LOGFILE="/tmp/my-daemon.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') my-daemon: $*" >> "$LOGFILE" 2>&1
}

log "started (pid $$)"

while true; do
    if [ -f "$CONTROL_FILE" ]; then
        # Read and immediately remove — don't re-execute on daemon restart
        # CRITICAL: Use explicit whitespace chars, NOT [:space:]
        # The TouchPad's busybox tr does NOT support POSIX character classes.
        # [:space:] is treated as the literal set of characters [, :, s, p, a, c, e, :]
        # which would delete those letters from "stop" → "to", making commands unrecognized.
        cmd=$(tr -d ' \t\r\n' < "$CONTROL_FILE" 2>/dev/null)
        rm -f "$CONTROL_FILE"

        case "$cmd" in
            do-something)
                log "executing: my-helper do-something"
                "$HELPER" do-something >> "$LOGFILE" 2>&1
                ;;
            do-other-thing)
                log "executing: my-helper do-other-thing"
                "$HELPER" do-other-thing >> "$LOGFILE" 2>&1
                ;;
            "")
                : # empty file, ignore
                ;;
            *)
                log "unknown command: $cmd"
                ;;
        esac
    fi
    sleep 1
done
```

**The TouchPad busybox `tr` bug:** webOS TouchPad uses BusyBox `tr` which does **not** support POSIX character class syntax (`[:space:]`, `[:alpha:]`, etc.). `tr -d '[:space:]'` will treat `[:space:]` as a literal set containing those characters and delete `s`, `p`, `a`, `c`, `e`, `[`, `]`, `:` from the input. Always use explicit characters: `tr -d ' \t\r\n'`.

### Triggering the Daemon from the PDK App (C code)

```c
// Write a command to the control file:
static void write_control(const char *cmd) {
    FILE *f = fopen("/media/internal/.my-app-control", "w");
    if (f) {
        fputs(cmd, f);
        fclose(f);
    }
}

// Usage:
write_control("do-something");
write_control("do-other-thing");
```

---

## Setuid Root Helper Binary

The setuid helper runs as root regardless of who executes it, allowing it to perform privileged operations:

```c
// my-helper.c — installed as /usr/bin/my-helper with chmod 4755 (setuid root)
// Build with the Linaro toolchain for TouchPad glibc 2.8 compatibility.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <dirent.h>
#include <unistd.h>

// Read /proc to find processes by name and send signals:
static void kill_by_name(const char *name, int sig) {
    DIR *proc = opendir("/proc");
    struct dirent *ent;
    while ((ent = readdir(proc)) != NULL) {
        int pid = atoi(ent->d_name);
        if (pid <= 0) continue;
        char cmdline_path[64];
        snprintf(cmdline_path, sizeof(cmdline_path), "/proc/%d/cmdline", pid);
        FILE *f = fopen(cmdline_path, "r");
        if (!f) continue;
        char cmdline[256] = {0};
        fread(cmdline, 1, sizeof(cmdline)-1, f);
        fclose(f);
        if (strstr(cmdline, name)) {
            kill(pid, sig);
        }
    }
    closedir(proc);
}

int main(int argc, char *argv[]) {
    if (argc < 2) { fprintf(stderr, "Usage: my-helper <command>\n"); return 1; }

    if (strcmp(argv[1], "do-something") == 0) {
        // Runs as root — can kill processes, modify system files, etc.
        kill_by_name("target-process", SIGKILL);
        return 0;
    }

    fprintf(stderr, "Unknown command: %s\n", argv[1]);
    return 1;
}
```

**Compiler requirements for TouchPad:**
- Must use **Linaro GCC 4.9.4** (for glibc 2.8 compatibility)
- Modern GCC links against glibc 2.34+ which is not available on the TouchPad
- Download: https://releases.linaro.org/components/toolchain/binaries/4.9-2017.01/arm-linux-gnueabi/
- Install to `/opt/gcc-linaro-4.9.4-2017.01-x86_64_arm-linux-gnueabi/`
- The Makefile should fall back to system `arm-linux-gnueabi-gcc` if Linaro is absent (build verification only — will not run on device)

```makefile
LINARO_GCC := /opt/gcc-linaro-4.9.4-2017.01-x86_64_arm-linux-gnueabi/bin/arm-linux-gnueabi-gcc

ifeq ($(wildcard $(LINARO_GCC)),)
    CC := arm-linux-gnueabi-gcc
    $(warning Linaro GCC not found — falling back to system toolchain)
else
    CC := $(LINARO_GCC)
endif

CFLAGS := -std=gnu99 -Wall -I/opt/PalmPDK/include

my-helper: my-helper.c
    $(CC) $(CFLAGS) -o $@ $^
```

---

## Filesystem Layout

| Location | Notes |
|----------|-------|
| `/media/cryptofs/apps/usr/palm/applications/<id>/` | App bundle install location (nosuid, non-root owned) |
| `/usr/bin/` | System binaries — writable by root, setuid works here |
| `/etc/event.d/` | Upstart jobs — readable by all, writable by root |
| `/media/internal/` | User storage — writable from jail and system, accessible via USB |
| `/tmp/` | System temp — **not the same as the jail's `/tmp`** |
| `/media/internal/.appname-control` | Good location for app→daemon IPC |
| `/media/internal/.appname-state` | Good location for persistent state flags |

---

## Debugging

### Verify postinst ran correctly

```bash
# Via novaterm or ssh on device:
ls -la /usr/bin/my-helper    # should show setuid (-rwsr-xr-x)
ls -la /usr/bin/my-daemon
ls -la /etc/event.d/my-daemon

# Check daemon status:
status my-daemon
# Expected: my-daemon start/running, process <pid>
```

### Check daemon logs

```bash
cat /tmp/my-daemon.log
```

### Inspect the .ipk before distributing

```bash
ar t com.example.myapp_1.0.0_all.ipk
# Should list: debian-binary  control.tar.gz  data.tar.gz

tar -tzf <(ar p com.example.myapp_1.0.0_all.ipk control.tar.gz)
# Should include: ./control  ./postinst  ./prerm
```

### Test without Preware (manual setup for development)

```bash
# Push files directly via novacom:
novacom put file:///usr/bin/my-helper < my-helper
novacom run -- file://bin/chmod 4755 /usr/bin/my-helper

novacom put file:///usr/bin/my-daemon < my-daemon.sh
novacom run -- file://bin/chmod 755 /usr/bin/my-daemon

novacom put file:///etc/event.d/my-daemon < my-daemon.conf
novacom run -- file://sbin/start my-daemon
```

---

## Summary Checklist

- [ ] `postinst` and `prerm` are shell scripts with `#!/bin/sh` and `set -e`
- [ ] Scripts are `chmod 755` inside `control.tar.gz`
- [ ] Build script runs `palm-package` first, then repacks the `.ipk` to inject scripts
- [ ] Verify with `ar t` and `tar -tzf` before distributing
- [ ] Setuid binaries are copied to `/usr/bin/`, not left in the app bundle
- [ ] Upstart job installed to `/etc/event.d/`; `start <job>` called in `postinst`
- [ ] Daemon uses `tr -d ' \t\r\n'` not `tr -d '[:space:]'` (busybox bug)
- [ ] IPC between jailed app and root daemon uses `/media/internal/` (not `/tmp`)
- [ ] `prerm` stops daemon, removes system files, resumes any suspended state
- [ ] Documentation tells users: **install via Preware or WebOS Quick Install, NOT `palm-install`**
- [ ] PDK apps targeting TouchPad use Linaro GCC 4.9.4 (glibc 2.8 compatibility)

---

## See Also

- `webos://knowledge/patches` — for patching system files via Preware/AUSMT rather than installing a new app
- `webos://knowledge/preware-feeds` — distributing through a Preware feed, and the extra hazards a package faces when it touches the running system (restart flags, atomic file replacement, prerm restore points)
