# webOS System Internals

The platform's internal plumbing — the parts you usually don't see from the SDK. This is the file to reach for when you're recovering a device, migrating data between TouchPads, reverse-engineering a stock app, or building a system-level helper. None of it is needed to write a normal Mojo or Enyo app.

The notes here apply to webOS 3.0.5 on the TouchPad (`topaz`); most of the architectural shapes are the same on phone webOS (`mantaray`/`castle`/`pixie`) but exact paths and event names sometimes differ.

---

## The encrypted `/var/db` partition

mojodb's data directory is **not** a plain folder on the rootfs — it's a separate dm-crypt volume that gets unlocked at boot.

```
LV /dev/mapper/store-mojodb (encrypted)        LV /dev/mapper/store-filecache (encrypted)
                ↓                                              ↓
    /usr/bin/mountcrypt unwraps                  /usr/bin/mountcrypt unwraps
    using NDUID-derived key from                  using NDUID-derived key from
    /var/palm/data/store-cryptodb.key             /var/palm/data/store-cryptofilecache.key
                ↓                                              ↓
    /dev/mapper/store-cryptodb                    /dev/mapper/store-cryptofilecache
                ↓                                              ↓
    mount → /var/db (ext3)                        mount → /var/file-cache (ext3)
```

The unlock happens in `/etc/event.d/finish-poststart.d/001-mountcrypt` after `started finish`. The script:

1. Calls `/usr/bin/mountcrypt /dev/mapper/store-mojodb store-cryptodb …`. Mountcrypt reads the wrapped key blob from `/var/palm/data/store-cryptodb.key`, derives the unwrap key from the device's real NDUID, and sets up the dm-crypt mapping.
2. If the mapping was created successfully, mounts `/var/db` and `/var/file-cache` from the new mappers.

You can see this on a healthy device:

```sh
mount | grep -E '/var/(db|file-cache)'
# /dev/mapper/store-cryptodb       on /var/db       type ext3 (rw,noatime,…)
# /dev/mapper/store-cryptofilecache on /var/file-cache type ext3 (rw,noatime,…)
```

If you see *neither* line, mountcrypt failed and `/var/db` is just a regular subdirectory of the unencrypted `/var` (`/dev/mapper/store-var`). The symptom is silent and severe — see next section.

### What "mountcrypt failed silently" looks like

When mountcrypt can't unwrap the key:

- `mountcrypt` logs `error reading key: Incorrect PIN/Password: IV mismatch` to `/var/log/messages` and exits non-zero — but **the system keeps booting**.
- `/var/db` exists, is writable, lives on the small (~62 MB) `/var` partition.
- `mojodb-luna` starts, opens BDB env files in `/var/db/main/`, and accepts requests.
- Every `putKind`, `put`, `merge`, `del`, etc. logs `bdb: transaction aborted` and silently fails to commit. No new data is durable.
- `find` returns `kind not registered: '<anything>'` for every kind, including system kinds like `com.palm.account:1`, `com.palm.browserhistory:1`, `com.palm.palmprofile:1`.
- Apps start in confused states because no one's Db8 calls work.

If you ever see system-wide "kind not registered" errors, **check the mount table first.** No amount of `palm://com.palm.configurator/run` will help if mojodb is writing to a partition that won't keep its writes.

### The NDUID dependency

The wrapped key blob can only be unwrapped by the NDUID that wrapped it. If you change what the kernel reports as the NDUID — by patching the kernel module, by `mount --bind`-ing a regular file over `/proc/nduid`, by LD_PRELOAD on `mountcrypt` — and then reboot, **mountcrypt will fail to unlock `/var/db`** and you fall into the silent-fail state above.

This is the single biggest landmine when doing identity-spoofing work on a TouchPad. Anything that overrides NDUID must:

- Fire **after** `mountcrypt` has run (use `start on started LunaSysMgr` in an upstart job — see below).
- Not be visible to `mountcrypt` itself if it runs at all (don't put NDUID-touching code in `/etc/profile`, `/etc/environment`, or anything else that affects every process).
- Be easy to reverse, in case you need a normal boot to recover.

If you've already booted once with a bad NDUID override in place and `/var/db` is on the wrong partition, the recovery is: remove the override, reboot, verify the encrypted mount comes back; the data on `store-cryptodb` was untouched (it was never mounted) so the original state returns.

---

## The boot event graph

webOS uses upstart 0.5 as init. You can sequence your own jobs against the platform's events. The full list lives in `/etc/event.d/` — read the jobs there to see what fires when. The most useful waypoints, earliest to latest:

| Event | Approximate timing | Useful for |
|---|---|---|
| `startup` | initramfs hands off | Pre-mount kernel-module setup. Avoid — too early for anything filesystem-y. |
| `stopped bootmisc` | After basic mounts (`/proc`, `/sys`, tmpfs's, `/var`) | mojodb-luna starts here. **Too early for NDUID overrides** — mountcrypt hasn't run. |
| `started finish` | All of `/etc/event.d/finish-poststart.d/*` runs after this | Sequence things that depend on `store-cryptodb`/`store-cryptofilecache` being mounted. |
| `started LunaSysMgr` | Window manager is up | Reliable "after most things are up" marker. Good for app-affecting overrides. |
| `first-use-finished`, `first-use-profile-created` | User completed Palm Profile setup (once, ever) | The configurator job hooks these to register Db8 kinds. |
| `datastore-initialized` | Configurator has finished registering kinds | A few system services subscribe to this before doing first reads. |

A minimal upstart job that fires once on boot, runs a script, and exits:

```
# /etc/event.d/my-boot-hook
description "Do something once mountcrypt has done its work"

start on started LunaSysMgr

script
    /usr/bin/logger -t my-boot-hook "running"
    # ... your work ...
end script
```

Notes:

- A bare `script … end script` block (no `respawn`) is one-shot: upstart runs it, the job state becomes `stop waiting`, and that's it for this boot.
- The job re-fires on the *next* boot when the event fires again. Mounts and other kernel-state side effects don't persist across reboots, so this is also how you make a runtime change "stick."
- `start on stopped finish` is the next event after `mountcrypt` runs. Use it for things that absolutely must precede every running service. `started LunaSysMgr` is later and safer for app-facing changes.
- Don't `start on startup` unless you have a very good reason. Almost nothing is set up that early.

### The "I can't reload the LS2 hub" corollary

LS2 role files (see `ls2-roles.md`) are read once at hub startup. Modifying them at runtime doesn't take effect; SIGHUP is ignored; SIGUSR1 kills the hub and the watchdog may not respawn it cleanly. The pragmatic answer is "make role changes durable on disk and reboot." Boot-time event hooks are how you make platform changes appear safely.

---

## Jails are partial namespaces

Apps that include a service, and most PDK apps, run inside a "hybrid jail" at `/var/palm/jail/<appid>/`. Outside the jail this is a real directory; inside the jailed process, it's the root of a near-complete view of the filesystem with selective bind-mounts and a *separate* `/proc` mount.

Things that are surprising:

- **`/proc` is independent.** `mount --bind /tmp/fake /proc/nduid` on the host has no effect on what jailed processes read from `/proc/nduid`. You have to also `mount --bind /tmp/fake /var/palm/jail/<appid>/proc/nduid`. The same applies to any other procfs override (`/proc/cpuinfo`, `/proc/version`, …).
- **Capabilities are stripped.** `/proc/<pid>/status` for a jailed process shows `CapEff: 0000000000000000`. Even root on the host **cannot ptrace** the jailed process — `strace -p $PID` returns `Operation not permitted`. Plan your observability around log analysis, tcpdump, and SQLite snooping instead.
- **The jail's `/tmp` is its own tmpfs**, separate from the system's `/tmp`. IPC between a jailed process and a host script via `/tmp` doesn't work. Use `/media/internal/` (which is bind-mounted into the jail).
- **The jail rootfs is mostly read-only.** Most directories are bind-mounted from `/dev/mapper/store-root` with `ro,nosuid,relatime`. Writable spots are `/tmp` (tmpfs), `/var/luna/preferences`, `/var/file-cache`, `/var/palm/tokens`, and any explicitly read-write bind mount the jailer adds.

`ls /var/palm/jail/<appid>/` from the host shows you the jail's root as the process sees it. `mount | grep <appid>` shows you every bind that was set up. This is the fastest way to understand what a particular jail can and can't touch.

> See also `nizovn-packages.md` for the related `jail_qt5.conf` mechanism that mounts Qt5/glibc into the jail for Nizovn-style apps.

---

## Where persistent state lives

Different services persist to different filesystems with different durability properties. A summary of the homes you'll meet most often:

| Path | Owner | Notes |
|---|---|---|
| `/var/db/main/` | mojodb-luna (Db8) | **Encrypted** (`store-cryptodb`). BDB env: `kinds.db`, `objects.db`, `indexes.db`, `log.0000000NNN`. Inspect with `db_dump`/`db_stat` from a BDB toolchain. |
| `/var/file-cache/` | filecache service | **Encrypted** (`store-cryptofilecache`). Holds downloaded artifacts. |
| `/var/palm/data/keys.db` | keymanager | Plain SQLite. `keytable(ownerID, keyID, data, …)`. Per-app key rows; some blobs are app-wrapped further. |
| `/var/palm/data/cookies.db` | webkit's network stack | Plain SQLite (table `Cookies`). Browser cookies — used by `BrowserServer`, not by PDK plugins. |
| `/var/palm/data/store-cryptodb.key`, `…cryptofilecache.key` | mountcrypt | NDUID-wrapped LUKS-ish key blobs. Don't move these between devices. |
| `/var/palm/data/<various>.db` | system services | Each service generally has its own SQLite. `vpnframework.db`, `Databases.db`, etc. |
| `/var/luna/preferences/` | system manager | Lightweight prefs and flags: `ran-first-use`, `first-use-profile-created`, `personal-data-encrypted`, `systemprefs.db`. |
| `/var/palm/ls2/roles/{prv,pub}/` | install scripts | App-installed role files — see `ls2-roles.md`. |
| `/var/palm/ls2/services/{prv,pub}/` | install scripts | App-installed dynamic service descriptors. |
| `/etc/event.d/` | postinst | Upstart jobs. Edit-able to add boot hooks. |
| `/etc/palm/db/{kinds,permissions}/` | OS image | System Db8 kind/permission templates the `configurator` registers. |
| `/media/internal/` | user | VFAT. **Visible as USB mass storage** when plugged in. **Survives a webOS Doctor reflash.** Best place to stash backups, scripts, and anything you want to be able to grab from the workstation directly. |
| `/media/cryptofs/apps/` | app installer | Installed `.ipk` contents (encrypted via the filecache mount). |
| `/var/palm/jail/<appid>/` | jailer | A given app's jail root — see jail section. |

**Recovery survivability:**

- Soft reset / reboot: everything above persists.
- `palm-uninstall` and `palm-install`: app's `/var/palm/data/*`, `/media/cryptofs/apps/<appid>/`, and Db8 rows under its kinds get wiped; the keymanager rows it stored don't (those live in `keys.db` and aren't auto-cleaned).
- webOS Doctor (full reflash): `/var/*`, `/etc/*`, `/media/cryptofs/*` all wiped. `/media/internal/` (FAT user partition) is untouched.

When you're doing recovery work, drop your backups under `/media/internal/.something/` — you can browse the partition from your workstation while the device is plugged in, and you'll still find your files if you accidentally Doctor the device.

---

## The configurator: how kinds get registered at boot

`/usr/bin/configurator` is the privileged service that reads `/etc/palm/db/kinds/` and `/etc/palm/db/permissions/` at boot and calls `palm://com.palm.db/putKind` / `putPermissions` for each. It's listed as a `db.role` `admin` caller in `/etc/palm/mojodb.conf`, which lets it `putKind` for any owner.

The corresponding upstart job is `/etc/event.d/configurator`, which fires on `stopped finish` (one-shot system kinds + filecache + permissions) and on `first-use-finished` / `first-use-profile-created` (post-first-use activities). The script does roughly:

```sh
luna-send -n 1 palm://com.palm.configurator/run '{"types":["dbkinds","filecache"]}'
luna-send -n 1 palm://com.palm.configurator/run '{"types":["dbpermissions"]}'
luna-send -n 1 palm://com.palm.configurator/run '{"types":["activities"]}'
```

App-private Db8 kinds (the ones under `<app>/configuration/db/kinds/` and `…/permissions/`) are registered by the app installer at install time using the same mechanism. The configurator is also what gets called when those run.

When kinds appear "lost":

- If only **some** system kinds are missing, the configurator likely failed mid-run — check `/var/log/messages` for its output and re-run `palm://com.palm.configurator/run '{"types":["dbkinds","dbpermissions"]}'`.
- If **all** kinds (including app kinds you just put) vanish across a reboot, you're in the silent mountcrypt-failure state above. Fix the mount first; the kinds will come back on the next clean boot, or you can re-run the configurator.

---

## The keymanager service

`palm://com.palm.keymanager/` exposes three methods: `store`, `fetchKey`, `remove`. Backed by `/var/palm/data/keys.db` (plain SQLite).

```sql
CREATE TABLE keytable(
    id        INTEGER PRIMARY KEY,
    ownerID   TEXT,    -- the caller's LS2 service name
    keyID     TEXT,    -- the keyname argument
    data      BLOB,    -- the stored value (may be further-wrapped by the app)
    keysize   INTEGER,
    type      INTEGER,
    scope     INTEGER,
    hash      BLOB
);
CREATE TABLE keytableconfig(id INTEGER PRIMARY KEY, data BLOB, dataLength INTEGER, iv BLOB, ivLength INTEGER);
```

Important properties:

- **Owner-isolated.** `fetchKey` only returns rows where `ownerID = <calling service name>`. There is no admin override at the service level. The way to read another app's keys is to call as that app via the LS2 role trick.
- **Apps may wrap their own values.** Synergy connectors store plaintext base64. Some apps (e.g. Kindle's ADP token) store an already-wrapped envelope. Always decode and inspect — what comes out of `fetchKey` is *whatever bytes the app put in*.
- **Initialization is gated on `com.palm.palmprofile:1`.** On first call, keymanager queries that Db8 kind for an account token. If the kind is registered but empty (no Palm Profile), every subsequent `fetchKey` returns `"library not initialized"`. Counterintuitively, if the kind is **not registered at all**, the dependency query "errors" in a way the keymanager treats as benign and `fetchKey` proceeds — this is why a freshly-booted target with no configurator run can read keys, but the same device after a configurator pass starts failing. Watch for the `library not initialized` symptom; it has *nothing* to do with crypto.

If you need to inspect or repair `keys.db` directly:

```sh
# Read-only browse:
sqlite3 /var/palm/data/keys.db \
    "SELECT id, ownerID, keyID, length(data) FROM keytable;"

# Mass-delete an app's keys after a clean uninstall:
sqlite3 /var/palm/data/keys.db \
    "DELETE FROM keytable WHERE ownerID='com.example.myapp';"
# (Stop the keymanager service first or the in-memory cache may be stale.)
```

---

## ARM ELF binaries on webOS are debug-info-rich

Most of the platform's native binaries (`plugin_kcf`, `KindlePluginUtil`, `mojodb-luna`, `keymanager`, `ls-hubd`, `configurator`, …) were shipped with **DWARF debug info intact** and were not stripped. The Hudson/Jenkins build artifacts even left source paths in `.rodata` (`/Users/<somebody>/.hudson/jobs/Bld/workspace/...`).

What this means for reverse engineering:

- `nm <binary>` returns demangled C++ symbol names. The class/method structure of the entire program is visible.
- `strings <binary>` reveals log messages that mention every class and method as they fire — `KeyManager::handleFetchKey`, `KindleDRMInfoProvider::getDeviceSerialNumber SN:%s`, `AmazonDevice::Authentication::RequestSigner::signRequest`, etc.
- `objdump -h` shows section layout; `objdump -s -j .rodata <binary>` dumps initialized constants. Static `std::string`s are constructed at startup from `.rodata` literals — grep for the literal text (often something like `device_name`, `private_key`, `token`) to find a key the program will use.
- DWARF lets a real ARM toolchain match addresses to source lines via `.debug_aranges`. macOS `objdump` *reads* the ELF but can't disassemble ARM; install Capstone (`pip3 install --break-system-packages capstone`) for that. Keystone covers assembly.
- The first LOAD segment is r-x and typically maps `vaddr 0x8000` → `file offset 0`. So **file offset = VMA − 0x8000** for code/rodata.

This makes platform RE much more tractable than you'd expect for a 13-year-old OS. Before bisecting behavior the hard way, grep the binary for the function or log line you expect to fire and follow the symbol names.

---

## `.rodata` is executable

The binaries have a single r-x LOAD segment containing `.text`, `.init`, `.plt`, `.rodata`, `.ARM.extab`, `.ARM.exidx`, `.eh_frame`. There's no W^X separation. Zero-padding gaps between `.rodata` literals — which are common, sometimes hundreds of bytes long — sit in executable memory and are usable as code.

This makes binary patching with a trampoline practical even when the original function doesn't have room for the replacement inline:

1. Find a long run of zeros inside `.rodata` (e.g. `python3 -c "open('bin','rb').read().find(b'\\x00'*128)"` and walk forward).
2. Place a small ARM stub there. Use `objdump -d` (with Capstone) or hand-assembled instructions — ARM `bl` has ±32 MB range, plenty for a single binary.
3. Replace the original `bl <library_call>` (4 bytes) with a `bl <stub_address>` — same instruction, different target.
4. The stub does whatever it needs to (write a constant string into a buffer, return a fixed value, etc.), then `bx lr` back.

The Kindle migration in this archive has an example: `extracted/patch_plan.json` + `extracted/KindlePluginUtil.patched` in `com.palm.app.kindle` show a 92-byte trampoline that replaces a `PDL_GetUniqueID` call with one that writes a hardcoded NDUID. Plan B for any case where you can't override behavior at the procfs or LD_PRELOAD level.

---

## novacom and the NDUID

`novacom -l` reports each connected device's NDUID as its identifier. The host's novacomd reads `/proc/nduid` on the device to populate that field — so if you `mount --bind` a regular file over `/proc/nduid`, novacom starts reporting the bound value too.

Consequences:

- After NDUID spoofing, `novacom -l` shows the spoofed value. USB enumeration still works fine — the device pairing is at the USB level, not at NDUID level — but if you ever have two spoofed devices plugged in at once, novacom can't tell them apart by ID. Use `hostname` to distinguish.
- Tools that rely on `novacom -d <nduid>` for targeting will need the *current* (spoofed) NDUID, not the underlying hardware one.
- `palm-install -d <nduid>` and other SDK tools use the same identifier and inherit the same behavior.

Setting hostnames on each device (`hostname YourLabel`; persistent via `/var/luna/preferences/sysmgr-args`) is the simplest way to keep things straight when you're doing dual-device work.

---

## TLS 1.0 still works, sometimes, directly

The TouchPad's stock OpenSSL only speaks up to TLS 1.0 with SHA-1/RC4-era cipher suites. `tls-and-networking.md` covers the SSL-bump proxy workaround that's the right answer for the modern web in general.

But a useful empirical observation from real-world RE work: **some servers still accept TLS 1.0 directly** without a proxy. We've seen this on:

- `*-ta-g7g.amazon.com` (Amazon's old kindle backend) — modern DigiCert/GeoTrust cert chain, but the server still negotiates TLS 1.0 with the device's ciphers. `openssl s_client -connect …:443` from the device handshakes cleanly.
- A handful of other legacy provider endpoints originally targeted at low-end mobile clients.

So before assuming an old service is dead, try `openssl s_client` directly on the device. If you get a real cert chain back and `Verify return code: 0 (ok)`, the only remaining question is whether the application layer above is happy. (`www.amazon.com` itself requires TLS 1.2+ — the legacy kindle endpoints are an exception.)

---

## Operational tips that save hours

- **`palm-log -f <appid>`** filters `/var/log/messages` to just one app's `LunaSysMgrJS` console output. Way quieter than tailing the full system log.
- **`luna-send` splits its output between stdout and stderr.** The `payload {...}` line goes to **stderr**; the `Total time` summary goes to **stdout**. Redirect with `2>&1 > file` (or `> file 2>&1`, mind the order) when scripting around it, or you'll think the call returned nothing.
- **BusyBox `head` lacks `-c`.** Use `dd bs=1 count=N` to grab leading bytes from a file on-device. Same for `tr` — `tr -d '[:space:]'` is *not* a POSIX class on BusyBox; it deletes the literal characters `[`, `:`, `s`, etc. Use `tr -d ' \t\r\n'`.
- **`luna-send` over `novacom -t run`** is the easiest way to script bus calls from your workstation. Heredocs work fine.
- **`/media/internal/.<something>/`** is the right place for any backup, staging, or in-flight migration artifact. It's vfat (so case-insensitive, no symlinks), but it survives reboots, reflashes, and uninstalls. You can also `cd` into it from your workstation's file manager when the USB drive is mounted, which makes inspection trivial.

---

## See Also

- `webos://knowledge/ls2-roles` — the role-file model that gates service-name registration
- `webos://knowledge/db8` — Db8 from the application angle (kinds, queries, permissions)
- `webos://knowledge/postinst-packaging` — how to ship upstart jobs and role files in a package
- `webos://knowledge/nizovn-packages` — `jail_qt5.conf`, the jailer wrapper, and modern Qt under the jail
- `webos://knowledge/tls-and-networking` — the SSL-bump proxy answer for the modern web
- `webos://knowledge/sdk-tools` — `novacom`, `luna-send`, and the rest of the workstation-side tooling
