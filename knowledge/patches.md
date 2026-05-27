# webOS Patches

## Overview

webOS patches are community-created modifications to system files — launcher configs, built-in app settings, and system UI — distributed through the AUSMT (webOS Internals Update Script Management Technology) framework. Patches are managed by **Preware** on-device and **WebOS Quick Install (WOSQI)** on desktop.

**Reference repository:** [webOSArchive/webos-patches](https://github.com/webOSArchive/webos-patches)

---

## Two Distribution Formats

### 1. Raw `.patch` File (simplest)

A unified diff with a metadata header. Can be side-loaded directly into WOSQI without packaging. **Cannot be installed via Preware.**

```
Name: Hide App Catalog
Version: 2.2.4-1
Author: webOS Archive
Description: Hide HP App Catalog from Launcher

--- .orig/media/cryptofs/apps/usr/palm/applications/com.palm.app.findapps/appinfo.json
+++ /media/cryptofs/apps/usr/palm/applications/com.palm.app.findapps/appinfo.json
@@ -3,6 +3,8 @@
    "type": "web",
    "main": "index.html",
    "id": "com.palm.app.findapps",
+   "removable": true,
+   "visible": false,
    "icon": "icon.png",
```

**Header fields:** `Name`, `Version` (format: `webos-version-patch-revision`, e.g. `2.2.4-1`), `Author`, `Description`. These appear in WOSQI's UI.

**Path format:** The diff uses `.orig/path/to/file` as the original and `/path/to/file` as the destination (absolute path from root). The `--strip=1` flag in the AUSMT `patch` command removes the leading `.orig` component.

### 2. Packaged `.ipk` (distributable via Preware and WOSQI)

Wraps the patch in a standard ipkg package with proper metadata, backup tracking, and reversibility. **Required for Preware distribution.** Two sub-patterns:

| Pattern | When to use |
|---------|-------------|
| **Script-only** | Moves/hides app directories; no `.patch` file needed |
| **Scripted-patch** | Applies a unified diff to system files via AUSMT |

---

## Prerequisites on Device

Both patch types require these packages installed via Preware first:
- `org.webosinternals.patch` — GNU patch binary
- `org.webosinternals.lsdiff` — lists files affected by a patch

These are in the webOS Internals feed. Declare them as dependencies in the `control` file.

---

## The `.ipk` Structure

```
my-patch/
├── control/
│   ├── control       ← package metadata
│   ├── postinst      ← runs on install (applies patch)
│   └── prerm         ← runs on remove (reverts patch)
└── data/
    └── my-patch.patch    ← for scripted-patch only; absent for script-only
```

> **Note:** For script-only patches, `data/` is an empty directory — IpkPackager still requires it.

---

## The `control` File

```
Package: org.webosarchive.patches.hide-catalog
Version: 1.0.0
Architecture: all
Maintainer: webosarchive
Description: Hide App Catalog from Launcher
Section: Launcher
Priority: optional
Depends: org.webosinternals.patch, org.webosinternals.lsdiff
Source: { "Feed":"WebOS Patches", "Type":"Patch", "Category":"Launcher", "LastUpdated":"1319519830", "Title":"Hide App Catalog", "FullDescription":"Hides HP App Catalog icon from the Launcher. The app remains installed.", "Homepage":"http://www.webosarchive.org/patches/", "Icon":"http://www.webos-internals.org/images/f/f9/Icon_WebOSInternals_Patch.png", "License":"MIT License Open Source", "PostInstallFlags":"RestartLuna", "PostUpdateFlags":"RestartLuna", "PostRemoveFlags":"RestartLuna" }
```

**Key fields:**

| Field | Notes |
|-------|-------|
| `Package` | Reverse-DNS ID — `org.webosarchive.patches.<name>` |
| `Depends` | Always include `org.webosinternals.patch, org.webosinternals.lsdiff` |
| `Section` | Appears as category in Preware: `Launcher`, `Mojo`, `System`, etc. |
| `Source` | JSON blob with Preware feed metadata |
| `PostInstallFlags` | `RestartLuna` — causes Preware/WOSQI to restart Luna after install |
| `PostUpdateFlags` | `RestartLuna` |
| `PostRemoveFlags` | `RestartLuna` |

`RestartLuna` is almost always needed — most patches modify files that Luna caches at startup. Without it, changes don't take effect until the next reboot.

---

## The Root Filesystem

The root filesystem (`/`) is **mounted read-only** by default. Any patch that modifies system files must first remount it writable:

```sh
mount -o rw,remount /
```

The AUSMT postinst/prerm templates call this in a `remount_rw()` function at the start of every operation. **Always do this first** — writing to a read-only mount silently fails or errors.

---

## Pattern 1: Script-Only (Move/Hide)

For removing or hiding apps without modifying file content. The `postinst` moves app directories to a backup location; `prerm` moves them back.

**`postinst`:**
```sh
#!/bin/sh

mkdir -p /var/home/root/cleanup-backup/usr-palm-applications
mkdir -p /var/home/root/cleanup-backup/media-cryptofs-apps

# Move system apps (pre-installed to /)
mv -f /usr/palm/applications/com.palm.app.backup/ \
      /var/home/root/cleanup-backup/usr-palm-applications/
mv -f /usr/palm/applications/com.palm.app.vpn/ \
      /var/home/root/cleanup-backup/usr-palm-applications/

# Move user-space apps (installed to /media/cryptofs)
mv -f /media/cryptofs/apps/usr/palm/applications/com.palm.app.maps \
      /var/home/root/cleanup-backup/media-cryptofs-apps/

# Reload Luna without a full reboot (HUP = reload)
/usr/bin/killall -HUP LunaSysMgr 2>&1

exit 0
```

**`prerm`:**
```sh
#!/bin/sh

# Restore everything
mv -f /var/home/root/cleanup-backup/usr-palm-applications/com.palm.app.backup/ \
      /usr/palm/applications/
mv -f /var/home/root/cleanup-backup/usr-palm-applications/com.palm.app.vpn/ \
      /usr/palm/applications/
mv -f /var/home/root/cleanup-backup/media-cryptofs-apps/com.palm.app.maps \
      /media/cryptofs/apps/usr/palm/applications/

rm -rf /var/home/root/cleanup-backup/usr-palm-applications
rm -rf /var/home/root/cleanup-backup/media-cryptofs-apps

exit 0
```

**Backup location:** `/var/home/root/` is the root user's home directory — persistent, writable, and not visible to regular users. A good safe location for temporarily moved system files.

**Luna HUP vs RestartLuna:** `killall -HUP LunaSysMgr` reloads the launcher without a full Luna restart — faster but less reliable for major changes. For packaged patches, set `PostInstallFlags: RestartLuna` in `control` to let Preware/WOSQI do a clean Luna restart instead.

---

## Pattern 2: Scripted-Patch (AUSMT)

For patching file content. The postinst/prerm scripts use the full AUSMT machinery — md5sum tracking, backup files, OTA detection, dry-run verification.

### The `.patch` File

Standard unified diff with a header block:

```
Name: Remove YPMobile
Version: 2.2.4-1
Author: webOSArchive
Description: Remove the Yellow Pages Mobile app from the Launcher

--- .orig/usr/palm/applications/com.yellowpages.ypmobile.preload/appinfo.json
+++ /usr/palm/applications/com.yellowpages.ypmobile.preload/appinfo.json
@@ -8,6 +8,8 @@
     "icon": "icon.png",
     "splashicon": "splashicon.png",
     "build": "256",
+    "removable": true,
+    "visible": false,
```

Note the `.orig/` prefix on the source path — AUSMT strips it with `patch -p1`.

### The AUSMT postinst

The full AUSMT postinst is ~250 lines. Key variables to set at the top:

```sh
APP_DIR=/media/cryptofs/apps/usr/palm/applications/org.webosarchive.patches.my-patch
PATCH_NAME=my-patch.patch
BSPATCH_FILE=       # path to binary file being patched (leave empty for text-only patches)
```

**What it does, in order:**
1. `remount_rw` — makes root filesystem writable
2. Locate `lsdiff`, `patch`, `file` utilities (checks two possible paths each)
3. Verify all required files exist and tools are present
4. `verify_text_patch` — dry-run with `patch --dry-run`; if patch already applied, sets `patch_applied=yes` and skips apply step (idempotent)
5. `binary_patch` — apply `.bspatch` binary diff if `BSPATCH_FILE` is set
6. `verify_additional_files` — validate md5sums of any files in `additional_files/`
7. Create `.webosinternals.orig` backups of every file that will be changed
8. Record file list + md5sums in `PATCH_CONTROL_DIR/file_list`
9. `install_patch` — apply the unified diff with `patch -p1`
10. `install_tweaks` — install companion `.json` for WebOS Tweaks if present
11. `install_additional_files` — copy files from `additional_files/` to their destinations

### The AUSMT prerm

**What it does, in order:**
1. `remount_rw`
2. `check_for_ota` — compares current file md5sums against stored originals; if Palm updated the file via OTA, skip reverting (the OTA already has the stock version)
3. Dry-run `patch -R` (reverse patch); if fails, tries forward to detect if already unapplied
4. `remove_patch` — apply `patch -R` to revert changes
5. `remove_tweaks` — remove companion `.json`
6. `remove_additional_files` — restore `.webosinternals.orig` backups
7. Clean up backup files and update tracking lists

### Key AUSMT filesystem locations

| Path | Purpose |
|------|---------|
| `/var/usr/lib/.webosinternals.patches/` | Patch tracking: `file_list`, stored `.patch` copies, md5sum backups |
| `/media/internal/.webosinternals.patches.packages` | List of installed patch packages |
| `/media/internal/webos-patches.log` | Install/remove log — first place to look on failure |
| `/usr/lib/ipkg/info/*.md5sums` | Stock file checksums used for OTA detection |
| `$file.webosinternals.orig` | Backup of each patched file, lives alongside the original |

### Dry-run idempotency

AUSMT always does a `patch --dry-run` first. If the patch is already applied (e.g., re-installing without removing), the dry-run fails but the reverse dry-run (`patch -R --dry-run`) succeeds — AUSMT detects this and skips the apply step. This makes patch install idempotent and safe to re-run.

---

## The Most Common Patch: Hiding Launcher Icons

The most frequent patch type adds two fields to an app's `appinfo.json`:

```json
"removable": true,
"visible": false,
```

- `"visible": false` — hides the app from the Launcher grid
- `"removable": true` — allows the app to be uninstalled (some pre-installed apps block removal without this)

The app remains installed and functional — it can still be launched by other apps via `applicationManager/open`. This is how the community hides carrier/HP-bundled apps that cannot actually be deleted.

**Two app locations to know:**
- `/usr/palm/applications/` — system apps, baked into the root filesystem (read-only by default)
- `/media/cryptofs/apps/usr/palm/applications/` — user-installed apps and some later HP apps

Check both locations — an app may be in either depending on the webOS version and whether it was pre-installed or delivered via OTA.

---

## Creating Patches

### Step 1: Create the `.patch` file

**Using UnifiedDiffCreator.jar (GUI tool):**
1. Find the file's path on the device
2. Copy it off: `novacom get file:///path/to/file > file.orig`
3. Duplicate and edit the copy
4. Run UnifiedDiffCreator — provide original file, edited copy, and the on-device path
5. Click "Create Patch"

**Manual (command line):**
```bash
# On a system with GNU diff:
diff -u --label '.orig/usr/palm/applications/com.example.app/appinfo.json' \
         --label '/usr/palm/applications/com.example.app/appinfo.json' \
         appinfo.json.orig appinfo.json > my-patch.patch

# Prepend the header manually:
cat > header.txt << 'EOF'
Name: My Patch
Version: 3.0.5-1
Author: Your Name
Description: What this patch does

EOF
cat header.txt my-patch.patch > my-patch-with-header.patch
```

### Step 2: Package as `.ipk`

**Using IpkPackager.jar (GUI tool):**
- **Folder:** click `data/` parent (the folder containing the `data/` directory, not `data/` itself)
- **Destination on device:** `/media/cryptofs/apps/usr/palm/applications/org.webosarchive.patches.my-patch`
- **ID:** `org.webosarchive.patches.my-patch` (matches destination folder name)
- **Version:** `1.0.0`
- **Depends:** `org.webosinternals.patch`, `org.webosinternals.lsdiff`
- **Postinst script:** select your `postinst` from `control/postinst`
- **Prerm script:** select your `prerm` from `control/prerm`

**Manual packaging** (same ar-repack method as `postinst-packaging.md`):
```bash
# Build control.tar.gz from control/ directory
(cd control && tar -czf ../control.tar.gz .)
# Build data.tar.gz from data/ directory  
(cd data && tar -czf ../data.tar.gz .)
# Assemble the .ipk
echo "2.0" > debian-binary
ar rc org.webosarchive.patches.my-patch_1.0.0_all.ipk debian-binary control.tar.gz data.tar.gz
```

---

## Adapting Templates

### Script-only patch (no `.patch` file)

1. Copy `source/script-only/control/` from the repo
2. Edit `control`: update `Package`, `Description`, `Source` JSON
3. Edit `postinst`: replace the `mv` commands with your operations
4. Edit `prerm`: reverse the operations exactly
5. Create an empty `data/` directory
6. Package with IpkPackager

### Scripted-patch (with `.patch` file)

1. Copy `source/scripted-patch/control/` and `source/scripted-patch/data/` from the repo
2. Edit `control`: update `Package`, `Description`, `Source` JSON
3. Edit `postinst`: update `APP_DIR` and `PATCH_NAME` variables (lines 3–4)
4. Edit `prerm`: update `APP_DIR` and `PATCH_NAME` variables (lines 3–4)
5. Replace `data/remove-ypmobile.patch` with your `.patch` file; update `PATCH_NAME` to match
6. Package with IpkPackager

**The only lines you normally change in postinst/prerm are:**
```sh
APP_DIR=/media/cryptofs/apps/usr/palm/applications/org.webosarchive.patches.YOUR-PATCH-NAME
PATCH_NAME=your-patch-name.patch
```
Everything else is the generic AUSMT machinery.

---

## Debugging

**Patch log:** Always check `/media/internal/webos-patches.log` first — every AUSMT operation is logged there with timestamps, dry-run output, md5sum comparisons, and "SUCCESS" or "*** FAILED ***".

**Dry-run failure:** If the patch fails dry-run, the target file has already been modified (by another patch or an OTA). Either remove conflicting patches first or update your patch to apply against the current file content.

**Luna not restarting:** Set `PostInstallFlags: RestartLuna` in `control`. The `killall -HUP LunaSysMgr` approach in the script is faster but less reliable — let Preware/WOSQI do it via the flag.

**Wrong path:** System apps (`/usr/palm/applications/`) vs. user apps (`/media/cryptofs/apps/usr/palm/applications/`). Check both on device with `ls` to confirm which location the target app is in.

**File is read-only:** If `postinst` fails silently without modifying files, the `remount_rw` step may have failed. Test manually: `mount -o rw,remount /` — if it fails, the device is in a read-only state for security reasons (some webOS builds do this).

---

## See Also

- `webos://knowledge/postinst-packaging` — for apps that need to run privileged scripts at install time (as opposed to patching system files)
