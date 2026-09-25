---
name: drive-extension
description: Run Games Menu in a throwaway nested GNOME Shell, mirrored live on the user's desktop — click through it, screenshot it, then shut it down. Use whenever a change must be SEEN (layout, spacing, colour, animation end-states, the library button, the overview grid, the modal panel, the detail pop-up), or needs a fresh shell start (extension.js, metadata.json, a new UUID).
---

# Driving Games Menu in a nested shell

Games Menu draws into the overview and into shell-chrome panels, not into a
window, so the only way to verify a visual change is to look at it. The nested
shell is a complete second GNOME Shell with its own session bus and virtual
monitor, reading the same installed extension; if the code throws during
`enable()` it takes down the *nested* shell, never the user's.

It runs headless, and `start` opens a **live mirror window on the user's real
desktop** so they can watch. Two people are looking: you through screenshots, the
user through that window. Drive it so both can follow.

## The loop

```bash
S=/tmp/claude-1000/...scratchpad        # your scratchpad; keep shots out of the repo
./scripts/nested.sh start               # ~2 s; Games Menu is ACTIVE when it returns
./scripts/nested.sh do "say Baseline" "overview on" "shot $S/before.png" "overview off"
# ... edit src/ ...
./scripts/nested.sh reload
./scripts/nested.sh do "say After the stylesheet change" "click 90 875" "wait 1" \
  "overview on" "shot $S/after.png" "overview off"
./scripts/nested.sh stop                # closes the mirror window too
```

Then **Read the PNGs** and say what actually differs. If nothing visibly changed,
say so; do not assume the edit worked.

## Batch with `do` — one call per interaction

`do` runs every step over a single connection and input session, so a whole
walkthrough is **one** tool call, and it stops at the first failing step:

```bash
./scripts/nested.sh do \
  "say Opening the library" "click 90 875" "wait 1" "overview on" \
  "say Picking the first game" "click 330 300" "wait 0.6" \
  "shot $S/detail.png" "overview off"
```

| Step | Does |
|---|---|
| `say TEXT` | Banner in the nested shell (≤ ~40 chars). Put one before every click or check. |
| `click X Y` / `move X Y` | Click / hover at desktop coordinates |
| `key KEYSYM` | `Escape`, `Return`, arrows, `F1`–`F12`, a remote's `XF86OK`/`XF86Back`/`XF86ChannelUp`…, one character, or a chord like `Super+Page_Down` |
| `wait SECS` | Let an animation land: ~1 s after anything that opens or closes the overview, ~0.6 s after a pop-up opens or closes |
| `shot [FILE [X Y W H]]` | Screenshot, or **just a region** — crop to what you are checking (a header strip, one tile) rather than reading 1600×900 every time |
| `overview on\|off` | Show/hide the overview. While on, shots and clicks act on it; nothing dismisses it until `off`. |

The same steps exist as single commands (`./scripts/nested.sh click X Y`, …) for a
one-off; prefer `do`. Other commands: `status`, `reload`, `logs [N] [--all]`,
`mirror on|off`, `run CMD…` (against the nested bus), `start --headless [WxH]`.

## Closing what you open

**`stop` when the task is finished — including when a check failed.** It closes the
mirror window, the shell, its bus and the screencast. Keep one shell up while
iterating and `reload` into it; `start` reuses a running one.

Backstops, so a forgotten `stop` never strands a window on the user's desktop:
- the mirror window closes by itself when the nested shell stops or crashes;
- a shell started from a Claude Code session stops itself after 10 minutes with no
  `nested.sh` command (`GAMES_MENU_NESTED_IDLE=<seconds>` at `start`, `0` = never);
- the project's SessionEnd hook stops it when that session ends.

Do not rely on them — they are for accidents. If the idle stop hit mid-task,
`start` again (~2 s).

**`stop` + `start` at least once before calling a change done.** `reload` keeps
the old dconf snapshot and whatever the previous build left on screen; only a
fresh start exercises `extension.js`, the enable path and first-frame layout the
way a login does. Edits to `extension.js` or `metadata.json` *need* one.

## Other nested shells

Other extensions' repos have their own copies of this tooling and their own
nested shells, and they can run at the same time as this one: this one is
Wayland display `games-menu-dev`, run dir `$XDG_RUNTIME_DIR/games-menu-nested`,
and every stray it looks for is matched by this repo's paths. **Never** stop,
kill or `pkill` any nested shell, mirror or run dir but this one's from here —
another session may be using it. They all share dconf (below), so two at once
is also two `dconf-service`s over one database.

## Reading the screen (1600×900)

Measure from a fresh screenshot if the columns setting, the other extensions
loaded, the accent or geometry changed. Roughly:

- **The library button** sits beside Show Apps. The nested shell loads the real
  session's extensions, so with Dash to Panel on it is in its bottom panel:
  Show Apps ≈ (30, 875), and Games at ≈ (90, 875) — unless another
  extension's buttons are there too, in which case whichever attached last sits
  next to Show Apps; screenshot the strip first (`shot F 0 850 400 50`).
  Without Dash to Panel it is in the overview's dash, just right of Show Apps
  ≈ (727, 850).
- **The `menu` library** (`library-opens-in` `menu`): the button opens the
  overview straight onto the games grid, with the row of workspaces folded
  away. A second press, or Escape, goes back to the desktop.
- **The `modal` library** pops a panel out of the button — with Dash to Panel,
  over the desktop — roughly `210,78` to `1390,800`, with the library's title
  and count as its header. `click 20 450` on the shade closes it, as does `key
  Escape` or a second press of the button.
- **Grid**, 2:3 posters: row 1 centres y ≈ 250, row 2 y ≈ 540 in the overview;
  6 columns by default.
- **A picked game** zooms a panel out of its tile over a shade (`detail-opens-in`
  `menu`), or fades one in centred over the desktop (`modal`); the shade's edge
  is 48px in from the work area, so `click 20 450` closes it, as `key Escape`
  does. Play and Show in Files are under the artwork; the details list (install
  folder, playtime, serial) is on the right.
- **No button at all** means the library is empty — nothing has been scanned
  into `~/.cache/games-menu/library.json` yet — or the logs have an error.

`reload` does not recompile the schema; after editing the `.gschema.xml` run
`glib-compile-schemas src/schemas` and `stop` + `start`. A `say` text must not
contain an apostrophe — steps are shell-split.

## When it looks wrong

`logs` first. A JS exception during enable leaves the previous UI on screen, which
reads as "no change". `logs` hides D-Bus activation and portal chatter; `logs 200
--all` shows everything. `[Games Menu]` lines are the extension's own; the
rest are from other extensions, loaded alongside.

## Gotchas

- **Never press Play in the nested shell.** It is a real launch on the real
  machine: `xdg-open steam://rungameid/…` reaches the user's running Steam
  client, and PCSX2 opens a real window. Stop at the detail pop-up.
- **dconf is shared with the real session, and the nested one can clobber it.** The
  nested `dconf-service` caches the database at start and rewrites the whole file
  on its first write, so a setting changed from the real session while a nested
  shell runs is silently lost once anything in the nested one writes a key.
  Change settings **before** `start` or **after** `stop`, then re-check with
  `gsettings --schemadir src/schemas list-recursively org.gnome.shell.extensions.games-menu`.
- **`start` enables Games Menu** if dconf doesn't list it — which writes
  `enabled-extensions`, so the real session will load it at the next login too.
- **`library-opens-in` and `detail-opens-in` are dconf settings**, so set them
  before `start` — or with `run gsettings` to watch a live switch. A `shot` or
  `click` outside `overview on` dismisses the overview, so wrap any overview
  walkthrough in `overview on` … `overview off`, and if a run starts with the
  overview in an unknown state, `overview off` then `overview on` first.
- **`overview on` is a flag, not only a command.** It writes the
  "overview wanted" marker in the run dir and *then* sets `OverviewActive`
  only if it is not already set — so it is also the way to photograph an
  overview the **extension** opened (the library button pressed from the
  desktop): `do "overview on" "shot $S/x.png"` marks it wanted and leaves the
  open overview alone, where a bare `shot` would dismiss it. `run python3
  scripts/nested_driver.py …` carries the same environment as `do` (`NESTED_RUN_DIR`
  and friends), so the driver called that way sees the flag too.
- **Keep a keyboard walk to one unbroken run of `key` steps in one `do`.**
  Each `do` makes a fresh virtual keyboard, and anything that drops key focus
  to the stage in between hands it back to the pop-up panel rather than to the
  tile or row that had it (`panel.js` watches for that), so a walk split across
  calls can start over. Put the banner before the first key and the screenshot
  after the last.
- **Never click or hover at the top-left.** It is the Activities hot corner and
  throws the shell into the overview. Pointer motion is absolute (the input session
  is linked to a screencast of the monitor), so a point only lands there if asked
  to; coordinates outside the monitor are rejected.
- **A screen-sharing indicator in the top bar** is the input/screencast session, not
  an extension bug.
- **`Eval` is blocked** (unsafe mode off): no arbitrary-JS escape hatch. Drive it
  through input and D-Bus properties like a user would.
- **Screenshots and banners borrow a bus name** (`org.gnome.SettingsDaemon.MediaKeys`,
  unclaimed on the throwaway bus) because the shell refuses unknown callers. Never
  try that against the real session.
- **Other extensions load too** (the nested shell reads the same extension list), so
  their log lines and top-bar icons appear alongside Games Menu — which is
  also the way to see it beside another library with a button of its own: both
  buttons beside Show Apps, and a press of one with the other's grid up in the
  overview closing and reopening the overview onto the one pressed.
- **The mirror needs GStreamer's PipeWire plugin.** If `mirror on` fails, use
  `start --headless` and screenshots, and tell the user.
- **Driving the prefs window:** `./scripts/nested.sh run gnome-extensions prefs games-menu@jackt &`
  opens it inside the nested session, where `shot` and the mirror both show it.
  The Extensions app outlives its window and keeps the `prefs.js` it first
  imported, so after editing it kill *the nested one* before reopening — the
  process whose environment has `WAYLAND_DISPLAY=games-menu-dev`, never a
  bare `pkill -f`, which also matches the real session's, your own shell and
  any other repo's nested one.
- **Never press Rescan in the nested prefs window.** It runs the scanner with
  `--from-settings` against the real GSettings, keys included, and goes online.
- **A game controller is `scripts/vpad.py`**, a virtual Xbox 360 pad on
  uinput driven through a FIFO (`tap A`, `tap GUIDE`, `hat down`, `stick right
  1.0`). It is a real device for the whole machine while it runs — every
  extension in the real session that reads pads sees it too — so `quit` it when
  done. Controller input is acted on only while the library is up, except Home
  (Guide, here), which opens it when no window has the focus; drive it with the
  prefs window closed.
- **The shell's "Allow inhibiting shortcuts" prompt writes the real permission
  store**, which the nested session shares. If a test has to answer it, delete
  the entry afterwards (`PermissionStore.DeletePermission gnome
  shortcuts-inhibitor org.gnome.Shell.Extensions.desktop`) so the real
  session still asks.
