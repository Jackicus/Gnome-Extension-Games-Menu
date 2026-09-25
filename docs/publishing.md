# Publishing to extensions.gnome.org

How to build the upload, what goes in it, and how the extension stands against
the EGO review guidelines. Web sources are named where they are used; the
guidelines are gjs.guide's
[Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and [Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html),
with [Anatomy of an Extension](https://gjs.guide/extensions/overview/anatomy.html)
for `metadata.json`, as fetched on 2026-09-25. Where the shell's own code is
cited, it is GNOME Shell 50.5.

In short: two things are likely to stop the first upload as the code stands.
They are the Python scanner in `backend/` ([Scripts and
binaries](#scripts-and-binaries-does-not-meet-as-it-stands)) and the staging of
`lib/` in `extension.js` ([the development
path](#the-development-path-in-extensionjs)). A third is a risk rather than a
rule: a fresh install shows nothing until the library is scanned ([Extensions
must be functional](#extensions-must-be-functional-a-risk-worth-knowing)). The
rest are small fixes.

## Building the zip

```sh
make pack
```

This runs `scripts/dev.sh pack` (`cmd_pack`), which:

1. compiles the schema into `src/schemas/gschemas.compiled`, as `link` and
   `install` do. That file is gitignored and does not reach the zip (step 3);
2. copies `src/` into a temporary directory and strips the copy
   (`strip_unshipped`): `__pycache__/`, `*.pyc` and the `CLAUDE.md` notes under
   `backend/`. `gnome-extensions pack` has no exclude flag, so the copy is what
   keeps them out;
3. runs `gnome-extensions pack --force --extra-source=lib --extra-source=backend`
   in the copy, writing to `dist/`. On its own, `gnome-extensions` adds
   `extension.js`, `metadata.json`, `prefs.js`, `stylesheet.css` (and
   `stylesheet-dark.css`/`stylesheet-light.css`, which do not exist here) and
   every `schemas/*.gschema.xml`. It adds nothing else (`command-pack.c` at
   `50.5`). `lib/` and `backend/` have to be named. So would a licence file,
   and it would also have to be inside the copy;
4. deletes the copy. The output is `dist/games-menu@jackt.shell-extension.zip`.

It does not check what went in, so a stray file under `lib/` or `backend/`
(an editor backup, a note) ships.

What it contains today (26 entries, 302 kB unpacked, 103 kB zipped):

```
metadata.json
extension.js
prefs.js
stylesheet.css
schemas/org.gnome.shell.extensions.games-menu.gschema.xml
lib/actions.js  lib/anim.js  lib/app.js  lib/controls.js  lib/detailDialog.js
lib/detailView.js  lib/lazyList.js  lib/library.js  lib/libraryWindow.js
lib/mediaGrid.js  lib/mediaMenu.js  lib/panel.js  lib/sectionButtons.js
lib/shape.js  lib/widgets.js
backend/games_scanner.py  backend/metadata.py  backend/scan_library.py
```

`backend/scan_library.py` keeps its executable bit in the zip. Nothing relies
on that, since the preferences run it as `python3 <path>`.

What it leaves out: `src/schemas/gschemas.compiled`, bytecode,
`src/backend/CLAUDE.md`, `scripts/`, `docs/`, `README.md`, `CLAUDE.md`, the
`Makefile` and `.claude/`. A new module under `lib/` or `backend/` is picked up
without changes here, because both directories are packed whole.

### Why the schema ships as XML only

- gjs.guide, [Port Extensions to GNOME Shell 44](https://gjs.guide/extensions/upgrading/gnome-shell-44.html):
  "GNOME Shell 44 can compile the GSettings Schemas file(s) while installing the
  extension package. In case you are using your own GSettings Schemas, you MUST
  only include the schemas/org.gnome.shell.extensions.<schema-id>.gschema.xml
  file(s) and avoid shipping the gschemas.compiled in the package (if your
  extension is only supporting GNOME Shell 44 and later)."
- The review guidelines' own GSettings rule asks only that "The Schema XML file
  MUST be included in the extension ZIP file".
- In the shell, `extensionDownloader.js` runs
  `glib-compile-schemas --strict <extension>/schemas` after unzipping an EGO
  download, and `gnome-extensions install` does the same
  (`command-install.c`). `--strict` means a schema warning is an install
  failure, so run `glib-compile-schemas --strict --dry-run src/schemas` before
  uploading. It passes today.

Every claimed version (48 and later) compiles on install, so the zip carries no
compiled schema.

### Testing the zip before uploading

```sh
make uninstall
make pack
gnome-extensions install dist/games-menu@jackt.shell-extension.zip
# log out and back in, then enable it
```

Always run `make uninstall` first. Never use `install --force` over the
development link. `make link` makes the extension directory a symlink to
`src/`. `--force` deletes the existing directory with
`file_delete_recursively` (`main.c` in the extensions tool), which enumerates
it without `NOFOLLOW_SYMLINKS`. It follows the link, deletes every file in
`src/`, and then deletes the link. `make link` restores the link afterwards.

`make install` is not the same test. It copies `src/` with rsync, so it never
runs what `make pack` put in the zip. The installed copy also runs its own
`backend/`, so press Rescan in its preferences once.

## metadata.json

| Key | Now | Verdict |
|---|---|---|
| `uuid` | `games-menu@jackt` | Valid characters and not `gnome.org`. It is the extension's identity on EGO and cannot change after the first upload |
| `name` | `Games Menu` | Generic, no brand in it. No extension on EGO has this name (searched 2026-09-25) |
| `description` | one sentence | Should say more (below) |
| `shell-version` | 48, 49, 50 | All released, so allowed, but only 50 has been booted |
| `settings-schema` | set | Correct. `getSettings()` is called without arguments (`GamesMenuApp`'s constructor, `fillPreferencesWindow`), which is what Best Practices asks |
| `url` | absent | **Required**: "It is required for extensions submitted to https://extensions.gnome.org/ to have a valid URL" (Anatomy) |
| `version` | `1` | **Remove it** (below) |
| `version-name` | absent | Worth adding |
| `session-modes` | absent | Correct ("MUST be dropped if you are only using `user` mode") |
| `donations`, `gettext-domain` | absent | Correct |

**`version`** is EGO's field. The Anatomy page says: "This field SHOULD NOT be
set by extension developers. The GNOME Extensions website will override this
field and GNOME Shell may automatically upgrade or downgrade an extension if the
version field is set." The review guidelines' table lists it as "Deprecated:
This field is set for internal use by extensions.gnome.org". The same rule asks
that `metadata.json` reflect the extension "without using any unnecessary
keys". Delete the line.

**`url`**: the repository,
`https://github.com/Jackicus/Gnome-Extension-Games-Menu` (the `origin`
remote). It is public, which it has to be: it is where users report problems
and where a reviewer checks that the zip is what the repository holds.

**`version-name`** is the version users see. Without it EGO shows its own
counter. The Anatomy page says it "MUST be a string that only contains letters,
numbers, space and period with a length between 1 and 16 characters", matching
`/^(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}$/`. So `"1.0"` or `"1.0 beta"` is fine, but
`"v1.0-beta"` is not, because of the dash. Recommendation: add
`"version-name": "1.0"` and bump it with each upload.

**`shell-version`**: the guideline is that it "MUST only contain stable releases
and up to one development release. Extensions must not claim to support future
GNOME Shell versions." 48 to 50 are all released, so the list is allowed. It is
also a promise: "if an extension is tested and found to be fundamentally broken
it will be rejected". 48 and 49 are claimed from an audit of the shell's
sources, not from running them ([compatibility.md](compatibility.md)). The
safest first upload claims what has been run (50). Add versions as they pass the
checklist in [compatibility.md](compatibility.md). A new upload can widen the
list.

**`description`** is the only place a user or reviewer learns what the
extension needs and where their data goes. It is also the only place that
explains what could look like a bug. Worth saying:

- it adds a Games button beside Show Apps, in the dash or in Dash to Panel's
  panel;
- the library is empty, and there is no button, until Rescan is pressed in the
  preferences. It finds games through Steam's own library files and the
  folders `PCSX2.ini` names. Without either, there is nothing to show. While
  the scanner is Python, it needs `python3`;
- Rescan looks games up online unless that is switched off. Steam's store and
  artwork CDN get the ids of installed Steam games. IGDB gets the titles of PS2
  discs, and only when the user has entered their own free Twitch key. Answers
  are cached in `~/.cache/games-menu`;
- API keys are stored in GSettings (dconf) in plain text;
- Play starts a Steam game through Steam and a PS2 disc through PCSX2, and
  neither is included;
- game controllers are read through libmanette, when it is installed, and only
  while the library is on screen. The exception is the Guide button, which
  opens it.

Multi-paragraph descriptions use `\n` literals, and `*` makes a bullet list
(review guidelines, `metadata.json` table).

## The review guidelines, item by item

### Only use initialization for static resources: meets

`src/extension.js` has no constructor and imports only Gio, GLib and
`Extension`. Everything under `lib/` is loaded with `await import()` inside
`enable()`, so no module of the extension's own runs before it.

Once `lib/` is imported statically (see [the development
path](#the-development-path-in-extensionjs)), its module scope will run at load
time instead, and all of it is allowed: `GObject.registerClass` calls, constant
tables, `BaseAppView` read off `AppDisplay`'s prototype, two `Cogl.Color`
constants in `panel.js` (a boxed value, not a GObject instance), `shape.js`
building its radius strings, and a few `let` holders. `GamesMenuApp` calls
`getSettings()` and constructs `Controls` in its constructor, and it is
constructed inside `enable()`. The virtual keyboard is created in
`Controls.enable()`.

`controls.js`'s `current` is cleared in `disable()`. `shape.js`'s `styles`,
`mediaGrid.js`'s `gridAlign` and its `pendingGrid` keep the last build's few
strings and numbers. A reviewer who applies "all dynamically stored memory must
be cleared or freed in disable()" literally could ask about them.

### Destroy all objects: meets

`GamesMenuApp.disable()` does the following, in order:

- removes the shortcut keybinding;
- drops the theme-context and settings connections;
- cancels the file monitor on `library.json`;
- removes the rebuild timer;
- calls `_teardown()`. The browser's `disable()` destroys the grids or the
  modal panel and the button beside Show Apps, takes back the wrappers on the
  overview layout and on Dash to Panel, and drops its overview connections.
  The `DetailDialog` is popped down and destroyed;
- calls `Controls.disable()`: settings, pads, repeat timers and the virtual
  keyboard.

Each class tears down what it built, which is what "Avoid Spaghetti Cleanup"
asks for.

Two things outlive `disable()`:

- **The staged copy of `lib/`** in `$XDG_RUNTIME_DIR/games-menu/lib-<stamp>/`.
  It is kept on purpose, and the next `enable()` sweeps it if it is stale. It
  goes away with [the development path](#the-development-path-in-extensionjs).
- **The two method wrappers**, `_getAppDisplayBoxForState` on the overview's
  layout and `_updateGroupedElements` on Dash to Panel's primary panel, but only
  when another extension wrapped the same method after this one. Removing ours
  then would unhook theirs, so ours stays as an inert link in their chain. It
  checks that it is still hooked before doing anything, and the comments where
  it is put on say why. Expect the question anyway.

`extension.js` wraps `this._app.disable()` in a try/catch that only logs. See
[AI-generated](#extensions-must-not-be-ai-generated-know-the-code) and the open
list.

### Disconnect all signals: meets, with one to tidy

Connections to the settings and to anything of the shell's (the theme context,
Show Apps, the overview and its controls, `Main.extensionManager`, Dash to
Panel, the dash) use `connectObject()`/`disconnectObject()` and are dropped in
the owner's `disable()`. The stage's `captured-event::key` handler in
`MediaMenu._force()` keeps its id and is disconnected in `_unforce()`, which
`disable()` calls. Plain `connect()` calls are on the extension's own actors,
or on objects they hold, so they go when those actors are destroyed.

The exception is the `Gio.FileMonitor` on `library.json` in
`GamesMenuApp.enable()`, which no actor holds. Its `changed` handler is
connected with plain `connect()`. `disable()` cancels the monitor and drops it,
which stops the handler, but never disconnects it. A reviewer reading line by
line will ask. `connectObject(..., this)` and `disconnectObject(this)` fix it.

The preferences connect their settings handlers per window and never disconnect
them on `close-request`. The rules concern `disable()`, not the preferences, so
this is tidying.

### Remove main loop sources: meets

Each source is removed, or checked for, right before a new one is created, and
removed again on the way out, as "Keep Timeout Removal Next to Creation" asks:

| Source | Where | Removed |
|---|---|---|
| rebuild timer | `GamesMenuApp._scheduleRebuild()` | right before creation; `disable()` |
| repeat timers for a held direction | `Controls._hold()` | `_release(id)` right before creation; `_stopPads()` from `disable()` |
| second-column idle | `DetailView.populate()` (`_deferredMain`) | `_cancelDeferred()` at the top of `populate()`; `_addMain()`; `_cancelDeferred()` from `destroy()` |
| list timer | `DetailView._fillList()` | guarded before creation; `_cancelDeferred()` from `destroy()` |
| top-up idle | `lazyList.js` `fillOnScroll()` `topUp` | guarded before creation; on the scroll view's `destroy` |
| reopen idle | `MediaMenu`'s `hidden` handler (`_reopenId`) | guarded before creation; `disable()` |

The blur's `Clutter.Timeline` (`anim.js` `easeProps()`) is not a GLib source.
The panel stops it in `_onDestroy()`. Nothing in `extension.js` or `prefs.js`
adds a source.

### Do not use deprecated modules: meets

There is no `ByteArray`, `Lang`, `Mainloop` or `imports.*`, and no
`run_dispose()`. Text is decoded with `TextDecoder`.

### No GTK in the shell, no shell libraries in the preferences: meets

The shell side imports Gio, GLib, GObject, Clutter, Cogl, Meta, Mtk, Shell, St,
Pango and Atk, plus Manette when it is installed. It imports no Gtk, Gdk or
Adw. `prefs.js` imports Adw, Gtk, Gdk, Gio, GLib and Pango, plus Manette when
it is installed. It also imports `lib/library.js` (Gio and GLib only) and
`lib/actions.js` (no imports; its header says it is shared and "nothing but
data"). Neither imports Clutter, Meta, St or Shell.

Best Practices suggests a `prefs/` directory for modules only the preferences
load. There are none yet, but `prefs.js` is 1,232 lines, and splitting it into
`prefs/` modules would also answer "Modules are Better Than a Single File".
That is optional.

### Avoid interfering with the extension system: does not meet as it stands

The rule: "Extensions which modify, reload or interact with other extensions or
the extension system are generally discouraged. While not strictly prohibited,
these extensions will be reviewed on a case-by-case basis and may be rejected
at the reviewer's discretion." Two things fall under it.

1. **`extension.js` stages `lib/`.** On every `enable()` it hashes `lib/`,
   copies it into `$XDG_RUNTIME_DIR/games-menu/lib-<stamp>/`, deletes every
   other stage there, and imports `app.js` from the copy with
   `await import('file://...')`. The purpose is to defeat GJS's module cache.
   That is the extension system's own behaviour, and working around it is what
   the rule describes. Reviewers will also see synchronous file copying and
   recursive deletion in `enable()`, and code imported from outside the
   extension directory. In every install EGO produces it is dead code, because
   nobody edits an installed copy. Hard to defend; move it out of what ships
   ([below](#the-development-path-in-extensionjs)).
2. **Dash to Panel.** `sectionButtons.js` reads `global.dashToPanel`, listens
   for its `panels-created` and for `Main.extensionManager`'s
   `extension-state-changed`, and wraps `_updateGroupedElements` on Dash to
   Panel's primary panel so the Games button sits after Show Apps. That is
   interacting with another extension. It is defensible. It serves a common
   setup, the wrapper chains and comes off only while it is outermost, and
   without Dash to Panel the button goes into the dash. Anything unexpected in
   `_attach()` is caught and warned about. Expect a question, and answer it in
   the description ("adds its button to Dash to Panel's panel when that is
   enabled"). [private-api.md](private-api.md) has the details.

### Code must not be obfuscated: meets

This is plain ES modules, unminified. Three lines in `prefs.js` exceed Best
Practices' 200-character limit. They are the long description strings for the
Games page's Files group and the Controls page's key and controller groups.
Split them.

### No excessive logging: needs a trim

"The log should only be used for important messages and errors." Three lines
are written when nothing is wrong:

- `Enabled from <stage dir>` in `extension.js` `enable()`. It is logged at every
  login and unlock, and every time the shell re-enables the extension because
  one enabled before it was disabled (`_callExtensionDisableWithRebase` in
  `extensionSystem.js` disables and re-enables every extension after the one
  turned off).
- `Rebuilt` in `GamesMenuApp._scheduleRebuild()`. It is logged after every burst
  of setting changes, every rescan landing, and every scale-factor change.
- `libmanette is not installed; game controllers are not read.` in
  `Controls._startPads()`. It is logged at every enable on a machine without
  libmanette, because `gamepad-enabled` defaults to true. That is an expected
  state, not an error.

Every other `console.*` call is on a failure path. Drop the first two lines.
Say the third once, or leave it to the preferences.

### Extensions should not force dispose a GObject: meets

There is no `run_dispose()`.

### Scripts and binaries: does not meet as it stands

This is the item most likely to stop the first upload. The rule:

> Use of external scripts and binaries is strongly discouraged. [...]
> Scripts MUST be written in GJS, unless absolutely necessary [...] Scripts
> must be distributed under an OSI approved license.
> Reviewing Python modules, HTML, and web JavaScript dependencies is out of
> scope for extensions.gnome.org. Unless required functionality is only
> available in another scripting language, scripts must be written in GJS.

The zip ships `backend/`, three Python modules of about 1,500 lines
(`scan_library.py`, `games_scanner.py`, `metadata.py`). The preferences' Rescan
button (`prefs.js` `_scanButton()`) runs
`python3 <extension>/backend/scan_library.py --from-settings` with
`Gio.Subprocess`. The scanner runs `gsettings` to read the settings, credentials
included, and goes online. The shell process never runs it; it only reads the
`library.json` the scanner writes.

Against each part of the rule:

- **No binaries or libraries:** meets. It is source only. Pillow is used if it
  happens to be installed, and nothing installs it, which is also what "MUST
  require explicit user action" for pip asks.
- **"Processes MUST be spawned carefully and exit cleanly":** mostly. It is an
  argv array with no shell, awaited with `communicate_utf8_async()`, and
  `gsettings` has a 10-second timeout. There is no cancellable, though, so a
  scan outlives a preferences window closed halfway through. It writes
  atomically under `flock`, so nothing is left half-written. A
  `Gio.Cancellable` and `force_exit()` on `close-request` would close that gap.
- **GJS unless absolutely necessary:** does not meet. The scanner parses
  Valve's text VDF/ACF files and `PCSX2.ini`, speaks HTTPS and JSON, and scales
  images. GJS can do all of that, with `Soup` 3 for HTTPS and `GdkPixbuf`
  for scaling, and the scanner already falls back to GdkPixbuf. A reviewer
  cannot review the Python, by the rule's own words, and will ask for a port.
- **OSI licence:** there is no licence at all ([Licensing](#licensing-needs-a-file)).

The fix is a GJS port. It can be a script under `backend/` run by the
preferences as now (`gjs -m <path>`). Or it can run in the preferences process
itself, asynchronously, which avoids a subprocess altogether, as the Best
Practices section on subprocesses prefers. The `flock` that keeps two scans
apart becomes a lock file created exclusively (`Gio.File.create()`), or goes
away if the preferences are the only writer. The alternative is to ship
without `backend/` and have users install the scanner separately. That leaves
the extension doing nothing on its own, which runs into [Extensions must be
functional](#extensions-must-be-functional-a-risk-worth-knowing).

### Clipboard, privileged subprocesses, telemetry: meets

There is no clipboard access, nothing runs through `pkexec` or with more
privilege than the user's, and there is no analytics or tracking. Going online
is covered next.

### Network, input and user data: meets; say it in the description

There is no rule against going online. The rule is "Extensions MUST NOT use any
telemetry tools to track users and share the user data online", and nothing
here tracks anyone. The shell process makes no network requests. The scanner
does, and only when Rescan is pressed (or `make scan`) with `games-online` on,
which is the default. It sends:

- to Valve, the app id of each installed Steam game not already cached
  (`store.steampowered.com/api/appdetails`). For games whose library art the
  Steam client has not cached itself, it fetches that art from
  `cdn.cloudflare.steamstatic.com`. No key is sent;
- to Twitch and IGDB, only when the user has entered a key: the key itself to
  `id.twitch.tv` for a token, the cleaned-up title of each PS2 disc not already
  cached to `api.igdb.com`, and requests for cover art to `images.igdb.com`.

Every request carries the User-Agent `GamesMenu/1.0`. None of it is telemetry,
but it is the user's game list going to third parties, so the description
should say so.

**Credentials.** No guideline covers storing API keys. They sit in the
`credentials` setting (`a{ss}`), in dconf, in plain text. The README and a
comment in the schema say so. The preferences do not, although their entries
are `Adw.PasswordEntryRow`s. Reviewers sometimes suggest libsecret for secrets,
but nothing requires it. A sentence under the Sources group would put the
warning where the key is typed. Two smaller points:

- `_igdb_access_token_locked()` in `metadata.py` puts the client secret in the
  token URL's query string. Twitch's token endpoint takes the same fields as a
  form-encoded body, which keeps the secret out of any URL.
- `prefs.js` `_keyDropFile()` looks for `~/Documents/keys/IGDB/CLIENT ID.txt`
  and `CLIENT SECRET.txt` and offers an Import button when they exist. It is
  harmless: the button appears only if the file does, and nothing is read
  until it is clicked. But it is a personal convention in shipped code, and a
  reviewer may ask why the preferences read files in Documents. Drop it from
  the shipped preferences, or make it a file chooser.

**Input.** `Controls` reads every game controller through libmanette. It acts on
one only while the library is on screen, except for Guide, and never while a
modal grab is up. It also creates a Clutter virtual keyboard
(`create_virtual_device`), which it uses to replay the arrow keys, Enter and
Escape for a remote or a pad while the library holds the keyboard. Synthesised
input draws a reviewer's eye. The header of `controls.js` explains it, and the
description should mention controllers.

**Launching.** Play calls `Util.spawn(argv)` in the shell (`app.js`
`openPath()`), with the argv read from `library.json`. It is either
`xdg-open steam://rungameid/<appid>` or a PCSX2 binary with
`-fullscreen -- <disc>`. The binary can be an AppImage the scanner found in
`~/Downloads`, among other places. There is no shell, and it runs only on the
user's press. But `normalizeGame()` checks only that it is an array of
non-empty strings, so whatever writes `~/.cache/games-menu/library.json`
decides what Play runs. That is the user's own privilege, not an escalation,
but a reviewer reading `Util.spawn(path)` fed from a JSON file will ask. Two
small changes settle it:

- build the argv in the shell, from the platform, a digits-only app id and the
  disc path;
- open `steam://` with `Gio.AppInfo.launch_default_for_uri_async()`, as Show
  in Files already does, instead of spawning `xdg-open`. Best Practices asks
  to "Avoid spawning external shell commands where possible".

### Extensions must be functional: a risk worth knowing

"Extensions which serve no purpose or have no functionality will also be
rejected." On a fresh install, this extension shows nothing at all. No
`library.json` exists until Rescan is pressed in the preferences. A library with
no games gets no button (the `MediaMenu` and `LibraryWindow` constructors
filter empty sections out), and with no button the shortcut does nothing
either. A reviewer's virtual machine is unlikely to have Steam or PCSX2 with
games in it. So even after Rescan they see no change, and may report it as
doing nothing.

Mitigations, in order of cost:

- say what it needs in the description (Steam or PCSX2 with games installed,
  Rescan in the preferences), and put a screenshot on the EGO page;
- show the button with an empty library, opening onto "Nothing indexed yet",
  which `libraryCountLabel()` already says, and pointing at the preferences.
  This changes the rule that an empty library gets no button, so it is a
  decision, not a fix;
- run the first scan when the preferences are first opened.

### Extensions must not be AI-generated: know the code

The rule is that the developer "should be able to justify and explain the code
they submit, within reason". Submissions with "large amounts of unnecessary
code, inconsistent code style, imaginary API usage, comments serving as LLM
prompts, or other indications of AI-generated output will be rejected". Best
Practices lists the patterns reviewers look for. None of the notices it
describes ("Generated with AI…") is in the code. The style is consistent. What
a reviewer would find:

- **Comments.** 1,231 of the 4,794 non-blank lines in the shipped JavaScript
  (26%) are comments, and file headers run 10 to 30 lines. They explain why
  rather than what, which is what the guidelines want. But the volume is
  unusual, and several cite the shell's source by file and line number (in
  `mediaGrid.js`, `mediaMenu.js`, `panel.js`, `widgets.js`, `sectionButtons.js`
  and `libraryWindow.js`). Those numbers go stale with every GNOME release and
  read as generated. Keep the reason and drop the line numbers.
- **Optional chaining on guaranteed APIs** ("Avoid Unnecessary Checks"):
  - `scroll.vadjustment ?? scroll.get_vadjustment?.()` in `lazyList.js`
    `fillOnScroll()`: `St.ScrollView` has `vadjustment` in every claimed
    version;
  - `surface?.inhibit_system_shortcuts?.(null)` and
    `restore_system_shortcuts?.()` in `prefs.js` `_captureShortcut()`: both
    are `Gdk.Toplevel` methods in GTK 4;
  - `this._device?.notify_keyval()` in `Controls._press()`: the device exists
    whenever `Controls` is enabled;
  - `actor.ensure_style?.()` in `anim.js` `ensureStyleDeep()` is correct,
    since plain `Clutter.Actor` children have no `ensure_style`, but
    `if (actor instanceof St.Widget)` says so.

  The rest are acceptable. Some are on private shell paths and Dash to Panel,
  where they are how the code degrades ([private-api.md](private-api.md)).
  Some are on parts `disable()` may find missing, or on optional callbacks
  (`beforeLaunch?.()`, `onActivate?.()`, `onComplete?.()`, `this._prepare?.()`).
  The `Clutter.ClickGesture` test in `MediaPanel._addClickAway()` is a real
  48-versus-49 branch, and goes if 48 is dropped.
- **try/catch that only swallows** ("Avoid Unnecessary try-catch Wrappers"):
  - `extension.js` `enable()` catches everything and logs it. In 50.5,
    `_callExtensionEnable()` awaits `enable()` and marks the extension ACTIVE
    unless it throws. So any failure to load or build becomes an extension that
    reports itself as running and does nothing, and the Extensions app shows no
    error;
  - `extension.js` `disable()` hides whatever `GamesMenuApp.disable()` throws;
  - the `release` of `SectionButtons._attachToDash()` wraps
    `dash.disconnectObject(this)` and `destroy()` in an empty catch. That is
    Best Practices' own example of a wrapper that is not needed.

  Those that remain handle real failures: reading `library.json`, listing the
  art folders, creating the file monitor, opening a folder, loading libmanette,
  reading a key file, starting the scanner, and Dash to Panel's
  `updateElementPositions()` on a panel that may be going away.
- **Lifecycle flags** ("Lifecycle and Destruction State"). `this._enabling`
  exists only because the staging makes `enable()` async, and it goes with it.
  `Controls._starting` guards the async libmanette import against a
  `disable()` that lands during it; that is a real race, so keep it.
  `released` in `SectionButtons._attachToPanel()` is set by the box's
  `destroy` so the box is not destroyed twice when Dash to Panel has already
  taken it down. It is close to the `this._destroyed` pattern the page warns
  about, so be ready to explain it.
- **A Unicode star as an icon.** `DetailView` shows the rating as
  `` `★ ${item.rating}` `` in a pill. Best Practices ("Icons vs. Emojis") asks
  for `St.Icon` rather than Unicode symbols; `starred-symbolic` is the shell's.

### metadata.json must be well-formed: needs two fixes

Remove `version` and add `url`. See [the table above](#metadatajson).

### Session modes: meets

There is no `session-modes`, so the extension runs in `user` only. On lock it
is disabled. The keybinding is removed, controllers are let go, and the library
and the pop-up close. Nothing of it runs on the lock screen, so a controller's
Guide button does nothing there. On unlock it is enabled again. The
alternative, `unlock-dialog`, "MUST be necessary for the extension to operate
correctly", and it is not.

### GSettings schemas: meets

The ID `org.gnome.shell.extensions.games-menu` and the path
`/org/gnome/shell/extensions/games-menu/` use the required bases. The file is
named `<schema-id>.gschema.xml`, the XML is in the zip, and no compiled schema
ships. `glib-compile-schemas --strict --dry-run src/schemas` passes.

The `<schemalist>` carries `gettext-domain="gnome-shell-extensions"`. That is
the domain of GNOME's own extensions package, not this extension's. Nothing is
translated, so it does no harm, but a reviewer may read it as copied. Drop it,
or use `games-menu`.

### Licensing: needs a file

GNOME Shell is GPL-2.0-or-later and "derived works like extensions MUST be
distributed under compatible terms". The Python scripts also need "an OSI
approved license" while they ship. The repo has no licence file, and no source
file carries a licence header. Add one (for example GPL-2.0-or-later) as
`LICENSE` at the top of the repo.

`make pack` will not pick it up on its own: `cmd_pack` packs a copy of `src/`,
and `gnome-extensions pack` adds no licence file by itself. Copy it into the
stage and add `--extra-source=LICENSE`.

`panel.js` says it is the shell's `AppFolderDialog` with the folder taken out.
Whatever came from `appDisplay.js` is GNOME Shell's GPL-2.0-or-later code, which
a compatible licence covers. Naming GNOME Shell as the source in that file's
header is the attribution.

### Copyrights and trademarks: meets, with care over screenshots

"Extensions MUST NOT include copyrighted or trademarked content without proof
of express permission from the owner", and the examples are brand names, logos
and artwork, and multimedia.

- **The name** is generic.
- **Brand names.** The description and the UI name Steam, PlayStation 2, PCSX2,
  IGDB, Twitch and Xbox, to say what the extension reads and which pads work.
  That use describes compatibility rather than branding the extension. EGO
  already lists extensions with Steam in their names (Add to Steam). Expect at
  most a request to reword. Keep logos out.
- **Artwork.** The zip ships none: its files are code, the schema and the
  stylesheet, which has no `url()`. The one icon is the theme's
  `applications-games-symbolic`, and placeholders are drawn in `widgets.js`.
  Covers and backdrops arrive at runtime on the user's machine, copied from the
  Steam client's own cache and PCSX2's covers folder or downloaded from Valve's
  CDN and IGDB. The Code of Conduct section allows for that ("extensions may be
  used to download, access or operate on external content"). What it governs is
  what is "distributed from GNOME infrastructure": the zip, the name, the
  description and the screenshots.
- **Screenshots** are therefore the one place EGO would distribute commercial
  cover art, since a screenshot of a real library is a grid of publishers'
  artwork. The ones in `docs/screenshots/` avoid the question: they are of a
  made-up library, invented games with artwork drawn by
  `scripts/demo_library.py`, taken with `./scripts/nested.sh start --clean
  --demo`. Use those, or new ones taken the same way.

### Don't include unnecessary files: meets

The zip holds what runs: the entry points, `lib/`, the stylesheet, the schema
and `backend/`. Bytecode and notes are stripped. `make pack` does not check the
contents, though, so a stray file would ship
([Building the zip](#building-the-zip)).

### Use a linter: recommended

There is no ESLint configuration in the repo. GNOME Shell's rules are on
GitLab, as the guideline says, and running them once before the first upload is
cheap.

## Private API

Everything the extension reaches into, what it is for, and what happens when a
future GNOME changes it is in [private-api.md](private-api.md). Reviewers accept
private API with a reason. What they look for is that it fails safely. Most of
it does:

- `MediaMenu.enable()` checks for the overview's controls, the app display and
  its `_box`, and warns and draws nothing without them;
- `_foldWorkspaces()` checks that `_getAppDisplayBoxForState` is a function;
- `SectionButtons._attach()` falls back from Dash to Panel to the dash, and
  catches a failed attach;
- `panel.js` `folderLook()` falls back to the stock shade.

The part that is not checked is `mediaGrid.js`, which subclasses `BaseAppView`
(read as `AppDisplay`'s prototype), `AppGrid`, `AppViewItem`, `IconGridLayout`
and `BaseIcon` at module scope. A change there makes the import of `lib/` throw.
Today that becomes an extension reporting itself ACTIVE and doing nothing. With
the shipped `extension.js` fixed, it becomes an error shown in the Extensions
app, which is what reviewers want.

## The development path in extension.js

**Still open.** GJS caches a module by URL for the life of the shell. So an
edit under `lib/` is not picked up without logging out, unless `lib/` is
imported from a new URL each time. `extension.js` does that staging in the file
that ships. It copies `lib/` into a directory named after a checksum of its
contents, sweeps the others, and imports from the copy. See CLAUDE.md, "How it
fits together", item 2. A reviewer reads this as working around the extension
system ([above](#avoid-interfering-with-the-extension-system-does-not-meet-as-it-stands)),
and in an EGO install it does nothing useful. The shape of the fix:

- `src/extension.js`, the entry point that ships, imports `./lib/app.js`
  statically. Its `enable()` and `disable()` are synchronous and carry no
  try/catch:
  ```js
  enable() {
      this._app = new GamesMenuApp(this);
      this._app.enable();
  }

  disable() {
      this._app.disable();
      this._app = null;
  }
  ```
- `GamesMenuApp.enable()` undoes itself when it throws. It calls `disable()`
  and rethrows, because the shell never calls `disable()` for an extension
  whose `enable()` threw. `_callExtensionDisableWithRebase()` returns unless
  the state is ACTIVE. Rethrowing keeps the shell's error state, so the failure
  shows in the Extensions app.
- `scripts/dev-extension.js` becomes the development entry point: today's
  staging, the async `enable()` with its `_enabling` guard, and the
  `Enabled from` line.
- `scripts/dev.sh link` builds the extension directory as a real directory of
  links. There is one link for each entry in `src/` except `extension.js`,
  which links to `scripts/dev-extension.js`. Today `link` makes the whole
  directory one symlink to `src/`. `make reload` goes on picking up edits.

After that, what is in the repository is what ships, apart from `scripts/`,
which never ships. The development link never runs `src/extension.js`, so test
the shipped entry point from an installed zip
([Testing the zip](#testing-the-zip-before-uploading)). CLAUDE.md's "`src/` is
an exact mirror of the installed extension directory", its item 2, and the
staging gotcha describe the current arrangement and would change with it.

The alternative is to swap in a plain `extension.js` at pack time. That would
ship a file that is not in the repository its `url` points at, and two entry
points would drift.

## Things a reviewer will notice, and the minimal fix

### Done

1. **Settings.** The schema ID is in `metadata.json` only, and `getSettings()`
   is called without arguments in both processes.
2. **The schema** ships as XML only and passes a strict compile.
3. **Nothing unshipped in the zip.** `make pack` strips bytecode and the
   `CLAUDE.md` notes from a copy before packing.
4. **Main-loop sources** are removed next to where they are created and again
   on the way out ([the table](#remove-main-loop-sources-meets)).
5. **No shortcut is taken by default.** `games-shortcut` is empty, grabbed with
   `Main.wm.addKeybinding()` when set, and removed in `disable()`.
6. **Controllers are optional and scoped.** libmanette is loaded on demand. The
   extension works without it, and pads are acted on only while the library is
   up (Guide excepted, never over a modal grab).
7. **Wrappers on shell and Dash to Panel methods chain.** They come off only
   while they are outermost, so disabling this extension never unhooks
   another's.
8. **Keys stay out of command lines and logs.** The scanner reads `credentials`
   out of GSettings itself. The key-file reader logs a path on failure, never
   a value.

### Still open

1. **The Python scanner.** Port it to GJS
   ([Scripts and binaries](#scripts-and-binaries-does-not-meet-as-it-stands)).
   This is the likeliest rejection.
2. **The development path in `extension.js`.** Move the staging to
   `scripts/dev-extension.js` and ship a static, synchronous entry point
   without the try/catch. `GamesMenuApp.enable()` undoes itself on a throw
   ([above](#the-development-path-in-extensionjs)).
3. **`metadata.json`.** Remove `version` and add `url`. Add `version-name`, write
   a fuller description (the points in [metadata.json](#metadatajson)), and
   narrow `shell-version` to what has been run.
4. **A licence.** Add `LICENSE` at the top of the repo, and have `cmd_pack`
   copy it into the stage and name it with `--extra-source`.
5. **First run.** Say in the description what it needs, add a screenshot (from
   `docs/screenshots/`), and
   decide whether an empty library should still get its button
   ([Extensions must be functional](#extensions-must-be-functional-a-risk-worth-knowing)).
6. **Logging.** Drop `Enabled from` (it goes with item 2) and `Rebuilt`. Say
   the missing libmanette once, or leave it to the preferences.
7. **Checks and wrappers.** Remove the `?.` on `vadjustment`,
   `inhibit_system_shortcuts`, `restore_system_shortcuts` and `_device`, and
   use `instanceof St.Widget` in `ensureStyleDeep()`. Remove the empty catch
   around `disconnectObject()`/`destroy()` in `_attachToDash()`. Trim the
   comments and drop the shell line numbers from them.
8. **Play.** Build the argv in the shell from the platform, the app id and the
   disc. Open `steam://` with `Gio.AppInfo.launch_default_for_uri_async()`
   rather than spawning `xdg-open`.
9. **The file monitor.** Use `connectObject()`/`disconnectObject()` for its
   `changed` handler.
10. **Small ones:**
    - replace the `★` with an `St.Icon`;
    - split the three over-long strings in `prefs.js`;
    - drop the schema's `gettext-domain`;
    - send the IGDB secret in the POST body;
    - say in the preferences that keys are stored in plain text;
    - drop or rework the `~/Documents/keys` import;
    - give the Rescan subprocess a cancellable;
    - disconnect the preferences' settings handlers on `close-request`;
    - replace `Gtk.show_uri()`, deprecated since GTK 4.10, with
      `Gtk.UriLauncher`;
    - add a content check to `cmd_pack`;
    - optionally, split `prefs.js` into a `prefs/` directory.

## Uploading

- **Web:** log in at https://extensions.gnome.org/upload/, choose
  `dist/games-menu@jackt.shell-extension.zip`, and accept the terms.
- **Command line** (gnome-extensions 49 and later; gjs.guide,
  [Port Extensions to GNOME Shell 49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html)):
  `gnome-extensions upload --accept-tos dist/games-menu@jackt.shell-extension.zip`.
  It prompts for the EGO username and password. `--user`, `--password` and
  `--password-file` exist for CI. gjs.guide warns that "Using the password in
  a command option risks exposing it in logs, the environment or the
  filesystem."

Each upload is reviewed before it is published, and review comments arrive on
the extension's EGO page. EGO numbers each upload in `version`, which is why
the file should not set it.

Before every upload:

1. Bump `version-name`.
2. Run `glib-compile-schemas --strict --dry-run src/schemas`.
3. Run `make pack`, and read `unzip -l dist/games-menu@jackt.shell-extension.zip`.
4. Run `make uninstall`, install that zip, log out and back in, press Rescan in
   its preferences, and go through the checklist in
   [compatibility.md](compatibility.md) on each version you claim.
5. Confirm `make logs` is quiet through enable, use, lock, unlock and disable.
