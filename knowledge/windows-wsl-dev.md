# Developing from WSL with the Device on a Windows Host

If you run your toolchain — Claude Code, editors, build scripts — inside **WSL** but your
webOS device (TouchPad, Pre, Pixi, etc.) is USB-attached to the **Windows** host, novacom lives
on the wrong side of the boundary. WSL can't see the USB device directly, and there's no on-device
console or emulator in the loop. Everything you do to the device — installing builds, tailing
logs, opening a shell — has to be driven through the Windows devkit binaries from inside WSL.

This file covers that specific setup. The novacom/`palm-*` tools themselves are documented in
`sdk-tools.md`; this is about reaching them across the WSL→Windows boundary and the one hard
constraint that boundary makes easy to trip over.

> This only matters for WSL. If you run the SDK tools natively on Windows, macOS, or Linux, the
> device attaches to the same OS your tools run on and you can call the binaries directly — see
> `sdk-tools.md`.

## The setup

- The device must be in **Developer Mode** (see `gotchas.md` → "novacom Requires Device in
  Developer Mode").
- The devkit tools (`novacom.exe`, `palm-install`, `palm-log`, `novaterm`, etc.) are **Windows**
  binaries under your webOS SDK install, e.g. `C:\path\to\devkit\SDK\bin`. Multiple webOS projects
  can share one devkit install — you don't need a copy per project.
- Because the device is attached to Windows, shell out to the devkit tools from WSL via
  PowerShell:
  ```sh
  powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\palm-log.exe' -f com.example.myapp"
  ```
  Use **single-quoted** paths inside the PowerShell command. `cmd.exe /c` has proven unreliable
  through the WSL→Windows interop path — prefer `powershell.exe -Command`.

## Two ways to watch live activity, in order of preference

1. **`palm-log -f <app-id>`** — tails just that app's log lines live (`console.log` / `enyo.log` /
   `this.log()` calls). Fastest way to watch taps as they happen, *if* the tapped code already
   logs.
   ```sh
   powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\palm-log.exe' -f com.example.myapp"
   ```

2. **Raw device shell**, when you need system-wide context `palm-log` won't show:
   ```sh
   powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\novacom.exe' -t open tty://"   # or: novaterm
   tail -f /var/log/messages                       # everything
   tail -f /var/log/messages | grep com.example.myapp   # filtered to your app
   ```

**If the tap/function you care about isn't showing up in either**, it's almost certainly because
that code path has no logging yet. Add `this.log(...)` / `console.log(...)` at the handler in
question, then tail again — sprinkle logging at the suspected function first rather than guessing
from source alone. For issues that need to survive without a live tail (something that happens when
you're not watching), have the app write to a persistent on-device log file and pull it after the
fact:
```sh
powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\novacom.exe' get file:///media/internal/mylog.txt" > mylog.txt
```

## Installing a build with palm-install

`palm-install` pushes an `.ipk` onto the device over the same novacom USB link, so it's subject to
the same one-session-at-a-time rule below.

1. **List attached devices** (confirm the device is visible; disambiguate if more than one is
   plugged in):
   ```sh
   powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\palm-install.exe' -list"
   ```
2. **Install / update the package** (reinstalls in place if already installed — no separate
   uninstall needed for a normal iterative build):
   ```sh
   powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\palm-install.exe' -i 'C:\path\to\build\com.example.myapp_1.0.0_all.ipk'"
   ```
3. **Uninstall**, for a clean slate:
   ```sh
   powershell.exe -Command "& 'C:\path\to\devkit\SDK\bin\palm-install.exe' -r com.example.myapp"
   ```
4. **Target a specific device** when several are attached: add `-d <device-name>` (from the
   `-list` output).

As with `palm-log`, use single-quoted paths inside the PowerShell command and prefer
`powershell.exe -Command` over `cmd.exe /c`.

## The hard constraint: one novacom session at a time

Only one novacom attachment to the device can exist at once — a `novacom -t open tty://`,
a `palm-log -f`, and a `palm-install` all need exclusive access. If a background tail/log session
is still holding novacom, an install (via `palm-install` or webOS Quick Install) will be blocked.
This is a novacom truth, not a WSL one (see `gotchas.md` → "Only One novacom Session at a Time"),
but WSL makes it easy to hit because backgrounded `powershell.exe` calls keep the Windows-side
process alive.

Rules to follow, especially when an agent is driving the loop:

- Never leave a `palm-log` / `tail` / `novaterm` session running in the background "just in case"
  while a build is pending install.
- Kill any running novacom-related process **before** announcing a new build/IPK is ready to
  install.
- Wait for explicit confirmation that the install finished (e.g. "installed", "testing now")
  before starting any new novacom session, one-shot or live-tail.

## See Also

- `webos://knowledge/sdk-tools` — full novacom / `palm-*` reference (the tools this doc drives across the boundary)
- `webos://knowledge/gotchas` — the one-novacom-session constraint and Developer Mode requirement, framed for all setups
- `webos://knowledge/js-services` — `console.log` from Node services also surfaces through `palm-log`
