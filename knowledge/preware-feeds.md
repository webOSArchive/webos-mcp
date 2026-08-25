# Preware Feeds & System Package Installs

## Overview

`postinst-packaging` covers building a single `.ipk` with root scripts. This file covers the layer
above it: **publishing packages through a Preware feed**, and the install-time hazards that only
show up when a package replaces or extends parts of the running system (services, shared libraries,
core apps, launchers).

The distinction matters because almost everything here is invisible until it breaks a device, and
several of the failure modes are **silent** — the package installs, reports success, and the device
is subtly or catastrophically wrong.

**Audience:** anyone shipping system-level packages (daemons, LS2 services, binary swaps, core-app
replacements) to real hardware through Preware.

---

## What a Preware feed is

A feed is a plain HTTP directory:

```
feeds/myfeed/ipkgs/
├── Packages              # the index — plain text, one stanza per package
├── Packages.gz           # gzip of the above; Preware fetches this when "Compressed" is on
├── com.example.thing_1.0.0_all.ipk
├── ...
└── assets/
    ├── icons/            # referenced by absolute URL from the index
    └── screenshots/
```

Users add it in Preware: **Manage Feeds → URL → Compressed (gzip) on**.

> **Serve it over plain HTTP.** A stock device's TLS stack is 2009-era and cannot complete a modern
> HTTPS handshake — and if your feed is what *delivers* the TLS fix, HTTPS is a bootstrap deadlock.
> Offer both, but publish the HTTP URL.

### The index is the authority, not the ipk

Preware reads **the index** for everything it displays and for dependency resolution. The `.ipk`'s
own `control` file is only consulted by `ipkg` at install time. These two can (and routinely do)
disagree, and that is often deliberate — see *Where to put `Depends`*, below.

Practical consequence: **metadata fixes are index-only and need no version bump.** Retitling,
re-icon-ing, re-categorizing, or tightening a version gate is a one-line edit to `Packages`,
regenerate `Packages.gz`, re-sync. Only a change to *ipk contents or its declared dependencies*
requires a new version.

### Stanza format

Field order (conventional, and worth keeping consistent):

```
Package: com.example.thing
Version: 1.0.0
Depends: com.example.other (>= 1.2.0)
Section: Applications
Architecture: all
MD5Sum: 6f1ed002ab5595859014ebf0951522d9
Size: 84210
Filename: com.example.thing_1.0.0_all.ipk
Description: One-line summary.
Maintainer: Your Name
Source: {"Type":"Application", ...}
```

`Packages.gz` must be a byte-faithful gzip of `Packages` (use mtime 0 for reproducibility), and
**always verify**: `cmp <(gunzip -c Packages.gz) Packages`. A stale `.gz` is the single most common
cause of "my update isn't showing up" — Preware reads the compressed copy.

---

## `Source:` — the Preware metadata blob

Preware largely ignores the standard opkg fields for display. Everything user-facing lives in a
JSON blob in the `Source:` field.

```json
{
  "Type": "Application",
  "Feed": "My Feed Name",
  "Category": "Utilities",
  "Title": "My Thing",
  "FullDescription": "Longer HTML description.<br><br>Second paragraph.",
  "Icon": "http://example.org/feeds/myfeed/ipkgs/assets/icons/thing.png",
  "Screenshots": ["http://example.org/.../assets/screenshots/thing1.png"],
  "MinWebOSVersion": "3.0.0",
  "MaxWebOSVersion": "3.9.9",
  "DeviceCompatibility": ["TouchPad"],
  "LastUpdated": 1782744397,
  "PostInstallFlags": "RestartLuna",
  "PostUpdateFlags": "RestartLuna",
  "PostRemoveFlags": "RestartLuna"
}
```

| Key | Notes |
|-----|-------|
| `Type` | `Application`, `OS Application`, `Linux Application`, `Patch`, `Theme`. Also `AppCatalog` (Preware rewrites it to `Application` and sets an app-catalog flag). |
| `Feed` | ⚠️ **Preware groups the UI by this string, not by the ipkg feed name.** Get it wrong and your package appears under some other group entirely — or creates a group of one. |
| `Category` | Sub-grouping within the feed. |
| `Title` | Display name. See the sort trick below. |
| `FullDescription` | HTML. `<br>` for line breaks. |
| `Icon` / `Screenshots` | Absolute URLs. Host them in the feed. |
| `LastUpdated` | Unix seconds. **Absent → Preware shows an "Unknown" date header.** |
| `PostInstallFlags` etc. | `RestartLuna` or `RestartDevice`. See *Restart flags*, below. |

Preware parses this with `.replace(/\\'/g, "'")` then `JSON.parse`, so `\'` is tolerated. Validate
with the same transformation before publishing — a single malformed blob makes that package
unreadable.

### Two non-obvious behaviors

**1. `ipkg` drops `Source` when it writes the status file.** An *installed* package is re-loaded
from `/media/cryptofs/apps/usr/lib/ipkg/status`, which has no `Source` at all — so it falls back to
using its `Description` as its display name, and the feed entry merging in afterwards is the only
place a real title exists. This is why Preware tracks a "title is a fallback" flag and lets the feed
title win. **Keep `Description` short and human-readable**, because it *is* the name of your package
for anyone whose feed entry hasn't loaded yet.

**2. A leading space in `Title` sorts a package to the top of the list.** Preware's default sort is
a raw `a.title.toLowerCase()` string compare with **no trim**, and the title is assigned from
`Source.Title` untrimmed. `" My Roll-up"` therefore sorts ahead of every letter and digit. The space
does not render in the list row, and search is unaffected (a substring match on the lowercased
title). This is the only lever over list order — Preware exposes no weight or priority field. If you
use it, **document it in your own repo**, because it looks exactly like a typo and will get "tidied"
away.

---

## Gating: keeping a package off the wrong device

This is the cheapest safety mechanism available and it is free. Use it on anything device-specific.

### Hard vs soft — the distinction that decides feed layout

| Field | Enforcement |
|-------|-------------|
| `MinWebOSVersion` | **HARD.** Filtered unconditionally in `loadPackage`; no user preference can bypass it. |
| `MaxWebOSVersion` | **SOFT.** The check sits behind `if (!prefs.get().ignoreDevices ...)`. |
| `DeviceCompatibility` | **SOFT.** Same preference. |

With Preferences → *Ignore Device Compatibility* enabled, `Max` and the device list are reduced to a
click-through "Incompatible Device" warning at install time. **`Min` is the only real lock.** Set all
three, but never rely on `Max` alone to keep a package off a device that must never see it.

Both bounds are **inclusive**: the comparison helper returns false on equality, and the call sites
are `versionNewer(platform, min)` and `versionNewer(max, platform)`. So `Min == Max == "3.0.5"`
admits exactly 3.0.5 — an exact pin is expressible, and is the right tool for a package that swaps a
component only known-good on one build.

### Absent fields are wide open

Defaults are `minWebOSVersion = '1.0.0'` and `maxWebOSVersion = '99.9.9'`. **Silence is not a safe
default.** A device-specific package with no gate will happily offer itself to every device on the
feed. This is the mistake that bricks phones with tablet patches.

### Gating also hides *installed* packages

The same filter runs over the installed list (status file → `loadPackage`). So adding a gate
retroactively **hides an already-installed wrong-device package from Preware**, and the user then
needs WOSQI or novacom to remove it. Gate before you publish, not after.

### `DeviceCompatibility` values

Matched as an **exact string** against `Mojo.Environment.DeviceInfo.modelNameAscii`. The values that
actually occur in the wild:

```
Pre   Pre2   Pre3   Pixi   Veer   TouchPad
```

Note `Pre2`/`Pre3` have **no space**. Anything else — a plausible-looking `"Touchpad Go"` with a
lowercase p, say — matches nothing and silently does nothing. Preware itself rewrites
`modelNameAscii` to `"Pre2"` when the machine name is `roadrunner`, since a Pre 2 does not report
that natively; the rewrite happens inside Preware, which is where the filter runs, so `"Pre2"` is
still the correct stanza value.

⚠️ **CPU architecture cannot separate these devices.** Pre 2, Pre 3, Veer and every TouchPad are all
`armv7`. The `all/armv6/armv7` split distinguishes the original Pre/Pixi era, not the later one.

### The hard gate: check the board in `postinst`

Feed metadata is not consulted by **WOSQI** or a direct `ipkg install`. The only guard that covers
those is a check at the *top* of `postinst`, before anything is modified:

```sh
# The same file Preware's own service reads for getMachineName.
BOARD=$(cat /etc/prefs/properties/machineName 2>/dev/null | tr -d ' \t\r\n')

case "$BOARD" in
  tenderloin|topaz) OFFSET=991784 ;;      # TouchPad
  mantaray)         OFFSET=987136 ;;      # Pre 3
  *)
    echo "Unsupported device '$BOARD' — refusing to patch." >&2
    exit 1
    ;;
esac
```

Board names: TouchPad `tenderloin`/`topaz`, TouchPad Go `shortloin`/`opal`, Pre 3 `mantaray`,
Veer `broadway`, Pre 2 `roadrunner`. Fall back to matching known board names in
`/etc/palm-build-info` if the prefs file is missing.

**A payload alone is inert; the wiring is what breaks things.** Refuse before the first
launcher edit or binary swap, and the worst case is a package that does nothing.

---

## Dependencies, versions, and updates

### Preware compares the version STRING only

Rebuilding an ipk **in place at the same version** — new contents, new md5 — will **never** show as
an update. The device sees `1.0.1 == 1.0.1` and ignores it, forever.

> **Rule: once anything might be on the server, never re-cut at the same version.** "It isn't
> published yet" is an assumption to verify, not to assume — and pushing is usually the only way to
> test on a device, so it usually *has* been published.

The flip side is occasionally useful: shipping a fixed build at the *same* version means new
installs get the new file while existing installs are left undisturbed. That is the right call for a
no-op change (a control-file tidy-up, a comment reword) where a forced re-download would cost every
user a download and a reboot for nothing.

### Version floors are the only way to drag a dependency up

An unversioned `Depends: foo` means "is *any* version of foo installed?" — satisfied, no upgrade. To
force an existing install forward you need `Depends: foo (>= 1.2.0)` **and** a bump to the depending
package's own version. Both, every time.

Preware also **does not recurse into an already-satisfied dependency node**. If `A → B → C` and B is
already installed, a new floor on `C` declared by `B` will not fire. Put the floor as a **direct
edge** on `A` as well when you need it to reach through.

### Meta ("roll-up") packages

A payload-free package whose only content is a `Depends` list is the standard one-tap installer.
Two rules:

- The meta's **`control` `Depends` must match the index stanza.** Preware resolves from the index,
  but `ipkg` reads the ipk's own control at install time. Drift between them means the on-device
  install silently pulls a different set.
- **Rebuild the meta by reusing `debian-binary` and `data.tar.gz` verbatim** and rewriting only
  `control.tar.gz`. Verify by unpack-diffing old against new: the *only* member that may differ is
  the control. The payload must not churn.

`Depends` order is the install order, which matters when one package's `postinst` needs another's
files already in place.

### One package per name — the ipkg dedupe trap

ipkg's dedupe key is `Package` + `Version` + `Architecture`, and for feed parsing it takes a "just
overwrite the old one" branch — **across all configured feeds**, which share one hash table.
Preware then installs *by name* and lets ipkg choose the file.

So **per-device builds that share a package name can never coexist in any feed layout.** A phone can
be handed the tablet's binary. If you build one package per board, give each build a **distinct
package name** (`thing` / `thing-phone`), or merge the boards into one ipk that selects at install
time from `machineName`.

Dead ends, all checked and all failures: a subdirectory in `Filename` (ipkg builds the download URL
correctly and the local cache path incorrectly), a per-board `Architecture:` (unknown architectures
are rejected unless every device's `ipkg.conf` declares them first — a bootstrapping problem), and
`Provides:` (ipkg supports it; Preware's JS has zero references to it, so Preware reports an unmet
dependency).

### The two-stanza trick: per-OS-version `Depends`

Sometimes one package needs a dependency on one OS version and **must not have it** on another — for
example a library that a newer OS build already ships. One `Depends:` line cannot say both. Two
stanzas can:

| order | gate | `Depends` |
|---|---|---|
| **FIRST** | `Min 3.1.0` / `Max 3.9.9` | *(none)* |
| SECOND | `Min 3.0.5` / `Max 3.0.9` | `com.example.thelib` |

Same `Package`, `Version`, `Architecture`, **same `Filename` and same `MD5Sum`** — one file, two
descriptions of it.

**Order is load-bearing.** Preware keeps the **first** stanza of a given name and discards the rest
(the merge path for "neither installed, same version" returns early, and the depends-union branch is
commented out in the source). Combined with hard-`Min` / soft-`Max`:

| device | preference | outcome |
|---|---|---|
| 3.0.5 | either | 3.1.0 stanza killed by the **hard Min** → 3.0.x stanza wins → dependency present ✓ |
| 3.1.0 | default | 3.0.x stanza killed by the Max filter → 3.1.0 stanza wins → no dependency ✓ |
| 3.1.0 | *ignore devices* ON | both survive → **first wins** → 3.1.0 stanza → no dependency ✓ |

Reverse the order and that last row inverts, force-installing the dependency where it must not go.
**The stanza whose only exclusion on the other device is a soft `Max` has to come first.**

This is safe against the dedupe trap *because both stanzas name the same file*. Whichever ipkg
keeps, it fetches the identical ipk — and since that ipk's control carries no `Depends`, ipkg never
consults the feed entry at all.

> Therefore your duplicate-stanza validation must test **"same name+version+arch AND *different
> file*"**. A bare name-triple check false-positives on this pattern.

### Where to put `Depends`: index vs control

| | index stanza | ipk `control` |
|---|---|---|
| Read by | Preware (resolution + display) | `ipkg` at install time |
| Can vary per OS version / device | ✅ (two stanzas) | ❌ (one file, one control) |

Preware installs by **local file**, so `ipkg` reads the ipk's own control and resolves *its* declared
dependencies from the feed. A dependency in the control is therefore unconditional and ungateable.

**Put dependencies in the index when they need to vary; keep the control's `Depends` empty in that
case.** Likewise never put `MinWebOSVersion`/`MaxWebOSVersion` in the control — the same filters run
over the installed list, so a gate baked into the control can hide the *already-installed* app from
Preware.

### Repackaging someone else's ipk: append `.N`

When you patch an upstream ipk whose version you do not control, ship it as `<upstream>.1`, then
`.2`. It sorts **above** the upstream version and **below** their next release, so their eventual fix
supersedes yours automatically, with no same-name-same-version collision.

---

## Restart flags, and the mid-batch restart trap

⚠️ **Never `killall LunaSysMgr` or reboot from inside a `postinst` or `prerm`.**

Preware itself runs *under* LunaSysMgr. Restarting it mid-install kills Preware and **aborts every
remaining package in the dependency chain** — so in a chain `A → B → C`, a restart in C's postinst
means A and B never install, and the user is left with a partial system.

Instead declare the need as metadata:

```json
"PostInstallFlags": "RestartDevice",
"PostUpdateFlags":  "RestartDevice",
"PostRemoveFlags":  "RestartLuna"
```

Preware collects the flags across the **whole batch** and applies the strongest one **once, at the
end** (`RestartDevice` > `RestartLuna`). The engine reload still happens — just cleanly, after the
chain completes.

**When you need `RestartDevice` rather than `RestartLuna`:** anything the LS2 hub or upstart only
reads at *its own* startup — new `/usr/share/ls2/roles/**` files, new dbus `system-services` files,
new `/etc/event.d/` jobs. A Luna restart does not re-read those.

> **WOSQI honours none of this.** It is not a feed client: it does not resolve `Depends` and does not
> read `Source` flags. A WOSQI install gives no automatic dependencies and no end-of-batch restart —
> install each ipk yourself and reboot manually. **The dependency-chain-plus-single-restart design is
> a Preware-from-the-feed behavior, so test it that way.**

---

## How install actually executes (and why cwd matters)

Preware has two install paths:

```c
useSvc  →  luna-send ... luna://com.palm.appinstaller/installNoVerify {...}
else    →  /usr/bin/ipkg -o /media/cryptofs/apps -force-overwrite install <path>
```

Afterwards Preware checks for `/media/cryptofs/apps/.scripts/<pkg-id>/pmPostInstall.script`. If the
App Installer service already ran one, Preware stops; **otherwise it runs the ipkg script itself**:

```sh
IPKG_OFFLINE_ROOT=/media/cryptofs/apps /bin/sh \
  /media/cryptofs/apps/usr/lib/ipkg/info/<pkg-id>.postinst
```

Four consequences worth internalizing:

1. **Offline-root packaging.** `data.tar.gz` is extracted under `/media/cryptofs/apps`, so it must be
   rooted at `./usr/palm/applications/<id>/...` — *not* include `media/cryptofs/apps/`. Get this
   wrong and the path doubles and `postinst` cannot find its own payload.
2. **`ipkg -o` DEFERS the postinst.** Installing by hand for testing prints "not running ...postinst".
   Run it manually: `sh /media/cryptofs/apps/usr/lib/ipkg/info/<pkg>.postinst`. Real Preware and
   WOSQI installs do run it.
3. **The App Installer runs `pmPostInstall.script` with cwd = the package's app directory**
   (`/media/cryptofs/apps/usr/palm/applications/<pkg-id>`). See hazard 2 below.
4. **The stored scripts are written at install time and are what run at the next removal.** See
   *Stored-script stickiness*.

---

## Six hazards for system-level packages

Every one of these was found on real hardware, and four of the six fail silently.

### 1. A blocking `luna-send` deadlocks the installer *and* the UI

```sh
luna-send -n 1 luna://com.palm.applicationManager/rescan '{}'    # ← DEADLOCK
```

`luna-send -n 1` waits for a reply. But the script is running *inside* LunaSysMgr's own request
handling, so the service that owes the reply is the one waiting for the script to exit. Nothing times
out.

**Symptom:** Preware stuck on "Updating…", device unresponsive, **no error anywhere**. The only
evidence is a blocked `luna-send` in `ps -ef`; killing that one process releases the whole chain.

```sh
( luna-send -n 1 luna://com.palm.applicationManager/rescan '{}' & ) >/dev/null 2>&1   # fire-and-forget
```

Applies to any service listed in LunaSysMgr's own `allowedNames` — check
`/usr/share/ls2/roles/prv/com.palm.luna.json`; `com.palm.applicationManager` and
`com.palm.appinstaller` are both there. Calls to *other* services (a separate JS service,
`com.palm.db`) may stay blocking, and should when the script parses the reply.

### 2. `rm -rf` on your own working directory

The App Installer sets cwd to the package's app directory. If your script's target path *is* that
directory — true for any ipkg-managed core app you are replacing — then deleting it removes the
script's own cwd. GNU tar then fails `getcwd()` **before it ever honours `-C`**, exits non-zero, and
your rollback restores an empty backup.

**Fix: `cd /` at the top of every postinst and prerm.** Free insurance even where the target is a
rootfs path.

### 3. A `/proc` cmdline sweep that kills its own installer

Scripts that nudge a service by sweeping `/proc/*/cmdline` for a name will match `ipkg`,
`ApplicationInstallerUtility`, and *the script itself* — all of which carry the package name or the
`.ipk` path in their command line. When the swept string is a substring of the package's own id, the
installer dies.

**Symptom:** the package installs *fine*, webOS reports `FAILED_IPKG_INSTALL`, Preware aborts the
batch — and retrying replays it forever, because Preware only refreshes its installed list on Update
Feeds.

```sh
nudge_kill() {
  needle="$1"
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    [ "$pid" = "$$" ] && continue
    cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null) || continue
    case "$cmd" in
      *pmPostInstall*|*pmPreRemove*|*ApplicationInstallerUtility*|*/usr/lib/ipkg/*|*.ipk*) continue ;;
    esac
    case "$cmd" in *"$needle"*) kill "$pid" 2>/dev/null ;; esac
  done
}
```

### 4. ⚠️ `cp` over a live shared library → SIGBUS

**The most destructive item on this list.** The kernel refuses writes to a file being *executed*
(`ETXTBSY`) but gives **no such protection to an mmap'd shared library**. A plain `cp` truncates and
rewrites the inode in place; any process faulting a page during that window — or past the truncation
point — takes **SIGBUS and dies**.

```sh
restore() { cp "$1" "$2"; }        # ← truncates a live inode; mappers die
```

**Symptom:** several unrelated processes die at once with signal 7. The crashing set identifies the
file exactly — it is precisely the set of processes that map it.

```sh
atomic_cp() {                       # write beside it, then rename
  src="$1"; dst="$2"
  [ -e "$src" ] || return 1
  cmp -s "$src" "$dst" && return 0  # skip identical — don't churn the inode on a reinstall
  tmp="$dst.tmp.$$"                 # MUST be the same directory: rename() can't cross filesystems
  cp "$src" "$tmp" || return 1
  chmod 755 "$tmp"                  # set the mode explicitly - busybox chmod has no --reference
  mv -f "$tmp" "$dst"               # rename is atomic; current mappers keep the old inode
}
```

`mv` also sidesteps `ETXTBSY` when replacing a **running executable**, which a `cp` cannot do at all.

**Rule: never `cp` over a file the running system has mapped or is executing — write beside it and
`mv`.** This covers fonts (mapped by every FreeType user), codec plugins (mapped by a mid-playback
media pipeline), web engine libraries, and every binary-swap package.

Two related traps in the same family:

- Do not conjure a file that was never there. Guard a restore with `[ -e "$2" ]` — otherwise a
  "restore" can drop a spare multi-megabyte library onto a rootfs with very little free space.
- A non-lazy `umount` of a busy mount returns `EBUSY` — it detaches nothing and signals nobody. If
  you catch yourself blaming a nearby `umount` for a crash, **proximity in a script is not
  causation.** Use `umount -l` anyway, so a straggler does not strand the mountpoint.

### 5. Restore-point hygiene in `prerm`

A backup that restores the wrong thing is worse than no backup at all.

- **Identify your own builds by *content*, not by md5.** An md5 of the current build mistakes a
  *previous* version's already-modified binary for the stock one and saves it as the restore point —
  after which uninstalling "restores" a modified binary and deletes the libraries it needs. Grep for
  a string only your builds contain (an RPATH fragment, a marker file). Content detection covers
  every earlier version and every board with no build-time bookkeeping.
- **Refuse to save an empty-directory backup**, and re-create one that is already empty. A tar of
  nothing is a restore point that restores nothing.
- **Assume `prerm` may be called twice.** WOSQI does. Clear the marker on success, or the second call
  deletes the component the first call just restored — whose backup the first call already removed.
- **Require an absolute path before any `rm -rf`.** If a variable resolves empty, `rm -rf "$DST/"`
  becomes `rm -rf /`.
- **No backup is safer than a wrong one.** When in doubt, `prerm` should leave the system as-is and
  say so.

⚠️ **A `prerm` that locates its work through a file the `postinst` deleted never restores anything —
silently.** If postinst cleans up its staging directory, persist what prerm needs somewhere durable
(a marker directory keyed by package id) and make prerm fall back to it.

### 6. Stored-script stickiness — a fix cannot repair its own upgrade

`/media/cryptofs/apps/.scripts/<pkg-id>/pmPreRemove.script` is written at **install** time, and that
stored copy is what runs at the **next** removal. Preware updates by remove-then-install.

**So a device carrying a broken `prerm` runs the broken one exactly once more — while installing the
package that fixes it.** If that broken prerm deletes a system directory, pushing the fix *is* the
trigger.

Two implications:

1. Test the **uninstall** path of any system package before shipping, not just the install path.
2. A prerm bug needs a **device-local repair**, not just a feed update. Either rewrite the stored
   script in place, or re-create the marker files the old script looks for so it takes its correct
   branch:

```sh
# Rewrite a blocking luna-send in every stored script, in place:
sed -i "s|^luna-send -n 1 luna://com.palm.applicationManager/rescan .*|( & \& ) >/dev/null 2>\&1|" \
  /media/cryptofs/apps/.scripts/*/pmPreRemove.script \
  /media/cryptofs/apps/.scripts/*/pmPostInstall.script
```

Syntax-check each file afterwards with `sh -n`.

---

## Two more things that surprise people

### New LS2 services are invisible until the hub restarts

`ls-hubd` scans `/usr/share/dbus-1/system-services/*.service` only at **its own** startup. A freshly
installed service sits on disk unseen — the symptom is `Service not listed in service files:
com.example.thing`. Either declare `PostInstallFlags: RestartDevice`, or ask the hub to rescan:

```sh
ls-control scan-services
```

Same story for `/var/palm/ls2/{roles,services}/{pub,prv}` registrations from a JS service — the map
is read at startup, so the app cannot reach its own service until a reboot.

### A ROM app wins regardless of version

Installing a higher-versioned replacement for a built-in app to `/media/cryptofs` does **not**
override it. The launcher tile, `getAppInfo`, and the running card all still resolve to
`/usr/palm/applications/<id>`. To actually replace a ROM app the `postinst` must move the original
aside:

```sh
mount -o remount,rw /
cp -a /usr/palm/applications/com.palm.app.thing /var/luna/com.palm.app.thing.orig
rm -rf /usr/palm/applications/com.palm.app.thing
```

Guard it: only move a copy that is **not already ours** (detect by content), only on the OS build you
tested against, and never overwrite an existing restore point. `prerm` puts it back.

**Recovery for a missing core app: uninstall the package, then REBOOT.** Once your higher version is
no longer registered, webOS's own boot-time `app-install` service reinstalls the stock ipk from
`/usr/palm/ipkgs/<id>/`. That is also why a half-broken device *stays* broken — while your package is
still registered, the service logs "already installed. skipping...".

---

## Building and repacking (macOS host)

```bash
printf '2.0\n' > debian-binary
export COPYFILE_DISABLE=1     # suppress macOS ._ resource-fork files
( cd control && tar --uid 0 --gid 0 --uname root --gname root -czf ../control.tar.gz . )
( cd data    && tar --uid 0 --gid 0 --uname root --gname root -czf ../data.tar.gz . )
ar rc out.ipk debian-binary control.tar.gz data.tar.gz     # this member order
```

- webOS `opkg` accepts BSD `ar` output — no GNU binutils needed to *write*.
- `control.tar.gz` holds `./control` plus `./postinst`/`./prerm` at mode **0755**.
- Some ipks carry **five** ar members — the usual three plus `pmPostInstall.script` and
  `pmPreRemove.script` for the Palm installer. **Keep them**, in order.
- **Reading** an ipk is harder than writing one: incoming files may be GNU ar (member names ending
  `/`, plus a `//` long-name table), which macOS BSD `ar x` chokes on ("File exists"). A small ar
  parser handling `#1/N` (BSD), `/N` + `//` (GNU), and plain names is worth keeping around.

**Repacking someone else's ipk:** rebuild **only** `control.tar.gz`, preserving member order, modes,
uid/gid, and mtimes; keep every other ar member byte-identical. Then verify by unpacking both and
diffing — the only member that may differ is the one you meant to change. This single check catches
payload churn, accidental re-compression, and macOS metadata leaking in.

---

## Validation before publishing

Automate all of these; each has caught a real bug.

- [ ] 1:1 between the `.ipk` files present and the index `Filename` entries
- [ ] Every `MD5Sum` and `Size` matches the actual file on disk
- [ ] Every `Source` blob parses as JSON (after the `\'` replacement Preware does)
- [ ] `Packages.gz` decompresses byte-identically to `Packages`
- [ ] The full dependency closure resolves, **including version floors**, against what the feed
      actually ships
- [ ] No two stanzas share `Package`+`Version`+`Architecture` **while pointing at different files**
- [ ] Every meta's ipk `control` `Depends` matches its index stanza
- [ ] **Simulate `loadPackage` per device** — one run per target (e.g. TouchPad 3.0.5, Pre3 2.2.4)
      and assert every visible package's dependencies are also visible on that device
- [ ] Run that sweep at **both** settings of the `ignoreDevices` preference, since `Max` and
      `DeviceCompatibility` vanish under it and only `Min` survives

That last pair is the one people skip. A dependency that is gated tighter than the package depending
on it produces a package that is visible and uninstallable — and it only appears on the specific
device where the gates disagree.

---

## Debugging

**"My update isn't showing."** Check the server first:

```bash
curl -s http://example.org/feeds/myfeed/ipkgs/Packages.gz | gunzip | grep -A2 '^Package: com.example.thing'
```

Confirm the version really is greater than what is installed, **and** that the `.gz` decompresses to
the current `Packages`. A stale `.gz` from a partial sync is the usual culprit. If the server is
right, the stale copy is the device's own feed cache: Update Feeds → remove and re-add the feed →
reboot. webOS caches hard.

**Driving a device over novacom:**

```bash
novacom -t open tty:// < script.sh          # pipe a script; end it with `exit`
novacom put file:///tmp/thing < local-file
```

- Write scripts locally and pipe them. `novacom run` has its own getopt and **eats dash-flags meant
  for the remote command** — `novacom run file://bin/grep -rl ...` loses the `-r` and `-l`.
- **The pty appends `\r` to every line.** Any parsing of the output needs `tr -d '\r'`, or numeric
  comparisons fail silently and you will misdiagnose a healthy device.
- `ps` without `-ef` lists only the calling tty.
- `luna-send -f` / `--subscribe` wedges the tty — it never returns.

**Checking an install:**

```bash
ipkg -o /media/cryptofs/apps list_installed | wc -l
cat /media/cryptofs/apps/usr/lib/ipkg/status | grep -A3 '^Package: com.example.thing'
ls /media/cryptofs/apps/.scripts/com.example.thing/     # the stored pm*.script copies
dmesg | grep -iE 'received (7|11)'                       # SIGBUS / SIGSEGV
```

---

## Summary checklist for a system-level package

- [ ] `cd /` at the top of `postinst` **and** `prerm`
- [ ] Board check from `/etc/prefs/properties/machineName` before anything is modified
- [ ] Every `luna-send` to a service inside LunaSysMgr is backgrounded
- [ ] No `killall LunaSysMgr`, no reboot — declare `PostInstallFlags` instead
- [ ] Any `/proc` sweep skips `$$`, the installer, and `.ipk` paths
- [ ] Every replacement of a mapped or executing file uses temp + `mv`, never `cp`
- [ ] `prerm` identifies your own builds by content, refuses empty backups, tolerates a second call,
      and requires an absolute path before `rm -rf`
- [ ] `prerm` does not depend on anything `postinst` deleted
- [ ] The **uninstall** path is tested on hardware, not just the install path
- [ ] `ls-control scan-services` (or `RestartDevice`) after adding an LS2 service
- [ ] Gates set: `Min` (hard), `Max`, `DeviceCompatibility` — and `Min` alone is what actually locks
- [ ] Version bumped if the ipk changed at all; floors added if dependencies must move
- [ ] Index validated and the per-device visibility sweep run at both `ignoreDevices` settings

---

## See Also

- `webos://knowledge/postinst-packaging` — building the ipk itself: `postinst`/`prerm` basics, setuid
  helpers, the jailed-app-plus-root-daemon pattern, the busybox `tr` bug
- `webos://knowledge/patches` — AUSMT scripted patches for modifying system files in place
- `webos://knowledge/ls2-roles` — LS2 role files and service-name registration
- `webos://knowledge/system-internals` — boot event graph, binary patching, the encrypted `/var/db`
- `webos://knowledge/tls-and-networking` — the TLS chain these feeds most often deliver
