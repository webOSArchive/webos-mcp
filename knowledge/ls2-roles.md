# LS2 (Luna Service Hub) Role Files

The Luna service hub (`ls-hubd`, also called "LS2") gates **which executable** is allowed to register **which service name** on the bus. Service-side access control on webOS is built on top of this: when a service stores per-caller data (keymanager, mojodb owners, accountservices, etc.), what it remembers is the *service name the caller registered as*, and that is rooted in a role file mapping.

Most application development never has to think about this. It matters when:

- You want to read another app's stored data for recovery, debug, or migration.
- You're writing a system-level helper that needs to talk to a privileged service.
- A service call fails with `Invalid permissions for <name>` even though you're root.
- A `palm://com.palm.db/find` for a kind you can see exists returns `db: permission denied`.

---

## How roles work

A role file declares a binary and the set of service names it may claim:

```json
{
    "role": {
        "exeName": "/usr/bin/luna-send",
        "type": "privileged",
        "allowedNames": ["", "com.palm.lunasend"]
    },
    "permissions": [
        {
            "service": "com.palm.lunasend",
            "inbound":  ["*"],
            "outbound": ["*"]
        }
    ]
}
```

- **`exeName`** is the *canonical* path of the executable, as seen via `/proc/<pid>/exe`. Symlinks resolve before this check, so symlinking `/tmp/foo` → `/usr/bin/luna-send` does **not** make `/tmp/foo` pass — `/proc/<pid>/exe` reports the real path.
- **`allowedNames`** lists every service name that binary is allowed to register. `""` means "anonymous calls allowed". You will see system service names here (`com.palm.audio`, `com.palm.db`, …) and occasionally a list like `["com.palm.app.kindle", "", "com.palm.cplite"]` for apps with multiple service hats.
- **`permissions`** lists each service-name-it-claims and what it's allowed to talk to (`outbound`) or be called by (`inbound`). `"*"` is wildcard.
- **`type: "privileged"`** allows the binary to register names containing wildcards and is needed for system-level binaries; regular apps use `"regular"`.

The hub reads every role file at startup, builds a `path → role` map, and uses it to admit or reject every `LSRegister` call.

---

## Where role files live

The hub scans two directory pairs, configured in `/etc/ls2/ls-private.conf` and `/etc/ls2/ls-public.conf`:

```
[Security]
Directories=/usr/share/ls2/roles/prv;/var/palm/ls2/roles/prv;/var/mft/palm/ls2/roles/prv
```

So role files for the private bus may live under:

| Directory | Typical contents |
|---|---|
| `/usr/share/ls2/roles/prv/` | System services shipped with the OS (`com.palm.lunasend.json`, `com.palm.db.json`, …) |
| `/var/palm/ls2/roles/prv/` | Roles added by app installs (`com.palm.app.kindle.json`, `com.example.myapp.json`) |
| `/var/mft/palm/ls2/roles/prv/` | Roles from MFT-installed content (rarely used in practice) |

And the same three under `…/pub/` for the public bus. The private bus is the high-privilege side that talks to system services like `com.palm.db` and `com.palm.keymanager`; the public bus is what most apps use for things like the application manager.

> **Precedence — the trap.** Directories are scanned in order and **the first role file whose `exeName` matches wins**. `/usr/share/` is checked before `/var/palm/`. If `/usr/bin/luna-send` already has a role in `/usr/share/ls2/roles/prv/com.palm.lunasend.json`, dropping a new role file under `/var/palm/ls2/roles/prv/` that *also* names `/usr/bin/luna-send` will be **silently ignored** for that exe — the shadowing winner is the one already in `/usr/share`. This is the single most common reason a role edit "doesn't take effect."

---

## Inspecting roles on a device

```sh
# Which binary owns this service name?
grep -l '"com.palm.app.kindle"' /usr/share/ls2/roles/prv/*.json /var/palm/ls2/roles/prv/*.json

# What does luna-send's role currently allow?
cat /usr/share/ls2/roles/prv/com.palm.lunasend.json

# What roles exist at all?
ls /usr/share/ls2/roles/prv /var/palm/ls2/roles/prv
```

When debugging a `Invalid permissions for X` error, identify the binary actually calling (`/proc/<pid>/exe`), then look up the role file that the hub will match against that path — remembering precedence.

---

## ls-hubd does not reload on SIGHUP

The hub caches its `path → role` map at startup. Common signals do **not** work:

- `SIGHUP` — ignored (no reload).
- `SIGUSR1` — **kills** the hub. The upstart watchdog *may* respawn it, but it's a risky way to reload. Don't do this on a running device.
- Modifying a role file while the hub is up — change is on disk but the running hub keeps using the old map.

The only safe ways to apply a role change:

1. **Clean reboot.** Always works. Slow.
2. **`initctl stop ls-hubd_private && initctl start ls-hubd_private`** (and the public pair). Risky — every connected client loses its bus connection at once, sysmgr can wedge, and on TouchPad we've seen this cascade into a reboot anyway. Don't unless you know exactly what state every connected client is in.

In practice, every workflow that touches a role file ends with `sync; reboot` and waiting for the device to come back. Plan for two reboots per change (one to apply, one to revert).

---

## The luna-send impersonation pattern

`/usr/bin/luna-send` has its own role file at `/usr/share/ls2/roles/{prv,pub}/com.palm.lunasend.json`. By default it can only claim the names `""` and `"com.palm.lunasend"`. If you extend `allowedNames` to include another service's name, `luna-send -m <that-name> …` lets you make calls *as if you were that service*. This is the most reliable way to:

- Read keymanager values stored by another app.
- Insert/merge rows into a Db8 kind owned by another app.
- Putkind for an app that's not currently running.

The pattern:

```sh
# 1. Back up the stock role (only if no backup exists — never overwrite
#    a real stock file with a previously-patched version on a re-run).
mkdir -p /media/internal/.my-bak
[ -e /media/internal/.my-bak/lunasend.prv.orig ] || \
    cp /usr/share/ls2/roles/prv/com.palm.lunasend.json /media/internal/.my-bak/lunasend.prv.orig
[ -e /media/internal/.my-bak/lunasend.pub.orig ] || \
    cp /usr/share/ls2/roles/pub/com.palm.lunasend.json /media/internal/.my-bak/lunasend.pub.orig

# 2. Replace with a patched role that adds com.target.app to allowedNames.
PATCH='{"role":{"exeName":"/usr/bin/luna-send","type":"privileged","allowedNames":["","com.palm.lunasend","com.target.app"]},"permissions":[{"service":"com.palm.lunasend","inbound":["*"],"outbound":["*"]},{"service":"com.target.app","inbound":["*"],"outbound":["*"]}]}'
echo "$PATCH" > /usr/share/ls2/roles/prv/com.palm.lunasend.json
echo "$PATCH" > /usr/share/ls2/roles/pub/com.palm.lunasend.json
sync; reboot

# 3. After reboot, you can speak as com.target.app:
luna-send -t 1 -m com.target.app palm://com.palm.keymanager/fetchKey '{"keyname":"token"}'
luna-send -t 1 -m com.target.app palm://com.palm.db/find '{"query":{"from":"com.target.app.something:1"}}'

# 4. Restore and reboot back to a stock-permission state:
cp /media/internal/.my-bak/lunasend.prv.orig /usr/share/ls2/roles/prv/com.palm.lunasend.json
cp /media/internal/.my-bak/lunasend.pub.orig /usr/share/ls2/roles/pub/com.palm.lunasend.json
sync; reboot
```

Why edit `lunasend.json` rather than the target app's role?

- Apps' role files bind to *their* exe path, e.g. `/media/cryptofs/apps/usr/palm/applications/com.target.app/binary_name`. Even if you broaden their `allowedNames`, you can't easily run from that exe (it's a real PDK plugin, not something you can invoke from a shell).
- `/usr/bin/luna-send` is already in the hub's allowlist as a privileged binary — only `allowedNames` needs widening.
- The change is in a single file pair, easy to revert.

> **Anti-pattern.** Modifying `com.target.app.json` to add `/bin/sh` or `/usr/bin/luna-send` as a *second* `exeName` does **not** work — `exeName` is a single string, not a list. The hub silently uses whichever role file mentions the executable first.

---

## Sanity checks

**After applying the patch:**

```sh
# Impersonation should succeed:
luna-send -t 1 -m com.target.app palm://com.palm.keymanager/fetchKey '{"keyname":"anything"}'
# - If you get "Key does not exist" or actual data: ✓ the hub accepted you as com.target.app
# - If you get "Invalid permissions for com.target.app": ✗ role file did not load (precedence issue or no reboot)
```

**After restoring:**

```sh
# Impersonation should fail:
RESULT=$(luna-send -t 1 -m com.target.app palm://com.palm.keymanager/fetchKey '{"keyname":"x"}' 2>&1)
echo "$RESULT" | grep -q "Invalid permissions" && echo "OK, restored" || echo "WARNING, still patched"
```

If "WARNING" — your restore didn't replace the file in the right directory (precedence again) or the hub didn't reload (no reboot). Verify the file contents match the original and reboot.

---

## Service-name isolation

Once a binary registers a service name, several system services use that name as a **stable per-caller identity**:

- **`com.palm.keymanager`** — `keys.db` rows have an `ownerID` column. `fetchKey` only returns rows where `ownerID = caller`. There is no override flag.
- **`com.palm.db` (mojodb)** — kinds and rows are owned by a service name. Cross-app reads require an explicit `putPermissions` grant (see `db8.md`). Anonymous calls (`-m` not set) get `db: permission denied` for almost everything.
- **`com.palm.accountservices`** and the Synergy stack — credentials in keymanager and rows in `com.palm.account:1` are keyed on the calling service's name.

This is why impersonation by service name (not by uid) is the lever that opens all the per-app stores at once.

---

## Building your own role file

If you ship a Node.js service or PDK helper that needs to talk to system services, install a role file in `postinst`. The path goes into `/var/palm/ls2/roles/prv/` (and `…/pub/` if you also need the public bus):

```json
{
    "role": {
        "exeName": "/var/palm/jail/com.example.myservice/usr/bin/node",
        "type": "regular",
        "allowedNames": ["com.example.myservice", ""]
    },
    "permissions": [
        {
            "service": "com.example.myservice",
            "inbound":  ["*"],
            "outbound": ["com.palm.db", "com.palm.connectionmanager"]
        }
    ]
}
```

A few practical points:

- For a Node service, `exeName` is the **node binary** that actually runs, not your `.js` file. Inside the jail this is usually `/usr/bin/node`. Different runtimes (e.g. nizovn Qt apps) use different exe paths.
- `outbound` should be the minimum set you actually call — easier to debug than `"*"` when you mis-spell a service name.
- Reboot after install. The hub's role map is cached.
- Uninstall by removing the role file in `prerm`. The hub will only forget about it on next boot.

See `postinst-packaging.md` for the full app-install plumbing this lives inside.

---

## Related debugging tips

- **Errors come from the hub, not the target service.** `Invalid permissions for X` originates in `_LSTransportRequestNameLocal` in the hub. It means "you can't *register* as X," not "service X rejected your method." A service-level rejection looks like `{"errorText":"db: permission denied"}` in the response payload instead.
- **`/proc/<pid>/exe` is the source of truth.** When debugging "why does role X not match this process?", read `/proc/<pid>/exe`. The hub uses exactly that path.
- **Roles aren't `chroot`-aware.** A jailed process's `/proc/<pid>/exe` still points to the *host's* canonical path, so the role file uses that same host path.

---

## See Also

- `webos://knowledge/services` — the apps-eye-view of calling built-in services
- `webos://knowledge/db8` — owner/permission semantics for mojodb kinds
- `webos://knowledge/postinst-packaging` — installing role files alongside a daemon
- `webos://knowledge/system-internals` — the broader system context (`/var/db` encryption, jail `/proc`, boot event graph)
- `webos://knowledge/synergy` — credentials stored in keymanager from the Synergy framework angle
