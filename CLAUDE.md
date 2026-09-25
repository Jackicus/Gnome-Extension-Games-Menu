# Games Menu

A GNOME Shell extension (UUID `games-menu@jackt`) that puts your installed games
— Steam, including libraries on other drives, and PlayStation 2 discs through
PCSX2 — in a library beside Show Apps: in the overview's app-grid slot, or in
a panel that pops out of its button. No window, no titlebar, nothing on the
wallpaper. Shell versions 48 to 50 (48 and 49 by audit against the shell's
sources, not by boot — see the compat note in Gotchas).

**It shares the shell with other extensions that reach the same places** —
docks, Dash to Panel, Blur my Shell, and other libraries with a button beside
Show Apps and a grid in the app-grid slot, several of which the user runs at
once. See "Running next to other extensions" below before touching anything
global.

## Seeing it

The UI renders into the overview and into shell-chrome panels, not into a
window, so a visual change can only be verified by looking at it. `make nested`
starts a **headless nested GNOME Shell**, loads the extension into it, and opens
a **live mirror window on the real desktop** (a PipeWire screencast of the nested
monitor) so the user can watch along without logging out. `make preview`
screenshots it. It can be clicked through (`./scripts/nested.sh click X Y`) to
test button → library → game, and `./scripts/nested.sh say "..."` flashes a
banner in it so the watcher knows what is about to happen.

Read the **`drive-extension` skill** before driving it; it covers the lifecycle and
the traps. Keep one nested shell up across edits and `reload` into it; `make
nested-stop` tears it down — always do that when finished. Other extensions'
repos have nested shells of their own; never stop or kill any of those from
here. `./scripts/nested.sh start --clean --demo` is how `docs/screenshots/`
is taken: settings of its own, no other extensions, and a made-up library.

All `make` targets delegate to `scripts/`: `dev.sh` for the extension itself and
`nested.sh` for the nested-shell targets (`nested`, `nested-stop`, `preview`, …).
Put new logic in those, not in the Makefile.

## Layout

`src/` is an **exact mirror of the installed extension directory**. Installing is a
plain copy or symlink, so there is no file list to keep in sync — add a file to
`src/` and it ships.

- `extension.js` — stages `lib/` and imports `app.js` (below).
- `lib/app.js` — `GamesMenuApp`: settings, rebuilds, the browser, the detail
  pop-up, controls, the shortcut, and launching.
- `lib/library.js` — `SECTIONS` (the one, `games`), reading `library.json`,
  the game normaliser.
- `lib/mediaMenu.js` — the `menu` library, in the overview's app-grid slot.
- `lib/libraryWindow.js` — the `modal` library, in the folder's panel.
- `lib/sectionButtons.js` — the library's button beside Show Apps.
- `lib/panel.js` — the shell's `AppFolderDialog`, with the folder taken out.
- `lib/detailDialog.js`, `lib/detailView.js` — a picked game, popped up.
- `lib/mediaGrid.js` — the shell's app grid, holding posters.
- `lib/controls.js`, `lib/actions.js` — remotes, controllers and bound keys.
- `lib/widgets.js`, `lib/shape.js`, `lib/anim.js`, `lib/lazyList.js` — the
  small pieces: widgets, the one radius, the one motion vocabulary, lists
  filled as they scroll.
- `prefs.js` — General, Controls and Games pages.
- `backend/` — the Python scanner; see `src/backend/CLAUDE.md`.

The section's identity — its key, its `games-` settings, its title, its icon —
is `SECTIONS` in `lib/library.js`, and nothing else restates it: `prefs.js`
imports that list and merges in only what its page says.

Runtime data: `~/.cache/games-menu/` — `library.json`, `posters/`, `backdrops/`,
`metadata/` (one `index.json` of every cached record). The JS never scrapes; it
only reads `library.json` that Python wrote.

**Every artwork path in `library.json` is a file in that cache, already scaled
to what the desktop ever draws, HiDPI included** (posters 512×768, backdrops
960×540; `metadata.py POSTER_BOX`/`BACKDROP_BOX` hold the caps, sized off
`mediaGrid.js`'s tile and `detailView.js HERO_MAX_HEIGHT`). St decodes a
background image at full size on the compositor thread and keeps it, so the
scanner shrinks on the way in, copies Steam's own library art and PCSX2's
covers in with the rest, and prunes the cache on each scan — only when it is
writing the real `library.json`, though: a run sent somewhere else with `--out`
shares the one cache, and would prune artwork the real library still names.
The JS treats an art path outside the cache as missing.

## How it fits together

1. `scan_library.py` reads Steam's and PCSX2's own bookkeeping
   (`games_scanner.py`), enriches each game online (`metadata.py`) and writes
   `~/.cache/games-menu/library.json` atomically, under an `flock` so two scans
   cannot write over each other. It reads the preferences itself with
   `--from-settings`, so which setting becomes which flag is decided in one
   place and both the Rescan button and `dev.sh scan` just run it.
   Enrichment runs on a small thread pool — it is nearly all waiting on other
   people's servers. Where a game looks is `games-sources`, an ordered list,
   but a game's platform picks the source (Steam apps: Steam's keyless store
   and CDN; PS2 discs: IGDB); the order only decides which IGDB credential is
   tried first. `games-online` switches the network off. Each cache entry
   records the source that wrote it, so a game already answered is not
   fetched again. See `src/backend/CLAUDE.md`.

   A list entry is a source name with a **credential slot** — `igdb` is
   `igdb@1`, `igdb@2` is a second key to fall back to when the first is
   rate-limited or has never heard of the game. Slots live in one
   `credentials` setting (`a{ss}`, IGDB's Twitch client id and secret
   tab-separated in one slot). A slot with nothing in it makes the sources
   that name it skip themselves, which is why IGDB sits unkeyed in the default
   list rather than being an error. The scanner reads `credentials` out of
   GSettings itself under `--from-settings`, so neither the Rescan button nor
   `dev.sh scan` hands it a key; only a standalone run falls back to
   `$GAMES_MENU_IGDB_CLIENT_ID` / `$GAMES_MENU_IGDB_CLIENT_SECRET`.
2. `extension.js` copies `lib/` into `$XDG_RUNTIME_DIR/games-menu/lib-<stamp>/`
   and imports `app.js` from there, where `<stamp>` is a checksum of `lib/`'s
   file contents (name, size, mtime), not a timestamp of the build. GJS caches
   modules by URL for the life of the shell, and static imports between
   sibling modules would resolve to the cached copies, so a directory that
   changes name when the content changes is what lets a disable/enable pick up
   edits **without restarting the shell** — that matters on Wayland, where you
   can't `Alt+F2 r`. A screen lock disables the extension and unlocking
   re-enables it (`session-modes` defaults to `['user']`), which is not an
   edit: it stages the same checksum, skips the copy, and re-imports the same
   URL, which GJS serves from its module cache rather than re-executing — so
   an unlock re-enables into the same module graph the previous session used,
   and only an edit's changed checksum ever builds a new one.
3. `GamesMenuApp` reads `library.json` and builds two things: a **browser** —
   `MediaMenu` or `LibraryWindow`, per `library-opens-in` — and the
   **`DetailDialog`** a pick pops up in. A file monitor on `library.json`
   rebuilds both when a rescan lands; so does a change of any style setting,
   of either place, or of the scale factor. A rebuild tears the browser down
   and makes another, and puts the library back up if it was showing
   (`state`/`restore` on the browser), so the change shows where it is being
   looked for rather than on the next press.

Navigation is two levels: the **library** (a grid) and the **detail** pop-up
(artwork, Play and Show in Files under it; title, facts, synopsis and a
details list — install folder, playtime, serial — beside it, since a game is
one thing to play, not many). **Play** runs the game's own command line
(`app.js` `openPath`'s array branch): `xdg-open steam://rungameid/<appid>`,
which keeps Steam's own launch options, compatibility tool and overlay, or
PCSX2 with `-fullscreen -- <disc>`. A launch closes whatever was up — the
pop-up holds a grab the game's window cannot get past — and with
`play-on-new-workspace` it moves to an empty workspace first so the game maps
there. Show in Files and the install-folder row open the folder.

**The library grid is the shell's own app grid** (`mediaGrid.js`): a subclass of
the class `AppDisplay` is built on, holding posters instead of apps, so pages,
swipe, the page dots, the hover arrows and scroll-wheel paging come with it.
One grid serves both places — the overview's slot and the modal library's
panel — and a tile is an `AppViewItem` around a `BaseIcon` styled
`overview-tile`, which is where its hover, focus ring and label come from. Ours
is only the shape: the icon asks for its artwork's proportions rather than a
square, the layout places cells of that shape the theme's own gap apart, and a
view builds the pages in reach of the one showing rather than a tile per game.

**The keyboard is St's.** Each grid registers itself as a focus group
(`global.focus_manager.add_group`), as the shell's dialogs and menus are — the
*nearest* group around what is focused is the one the arrow keys walk, and the
shell registers its own app grid the long way round, as a Ctrl+Alt+Tab target,
which ours is not. The pop-up panels are focus groups too. Nothing is focused
until a navigation key asks for it, as in the app grid; then Tab and the
arrows move, Enter opens, and Escape backs out. A pop-up panel holds the
keyboard itself as it opens, and an arrow from the panel finds nothing to move
to, so its first navigation key lands where Tab would (`panel.js`
`_focusFirst`) — without it a remote with only arrows could not get into one.

**Remotes and controllers are the keyboard too** (`lib/controls.js`, the
actions in `lib/actions.js`, the Controls page in the prefs). Nine actions —
the four directions, Select, Back, Home, a page each way — each with a list of
keys (`keys-<action>`, `a(uu)` of keyval and modifiers: numbers, because
Clutter's keysym table lacks half of what a remote sends, `XF86OK` among them)
and a list of controller inputs (`pad-<action>`, `"button:304"`, `"axis:1-"`).
The first six stand for a key and are replayed as it through a Clutter virtual
keyboard, so they do exactly what the arrows, Enter and Escape do wherever the
keyboard is; paging (`mediaGrid.js` `pageBy`, since the shell's grid turns no
page for a key) and Home are done directly. A bound key is handed over by the
view it reached — a grid's own key handler, a panel's `vfunc_key_press_event`
— so a binding means nothing outside the library and a remote's Back stays the
browser's Back. Controllers are read with libmanette (loaded on demand; the
extension runs without it) and acted on only while `_controlsActive()`, except
Home, which opens the library when no window has the focus and nothing holds a
modal grab. The arrows, Enter and Escape are never offered for binding: they
always work.

## Where it opens

Where each of the two things opens is a setting, and the two are read
**independently of each other**: `library-opens-in` for the grid,
`detail-opens-in` for the pane of a picked game. Both take the same two
values, meaning the same two places — `menu` and `modal` — and nothing follows
from the pair. There is no desktop or workspaces place: a game is one thing to
launch, not a collection to leave standing on the wallpaper.

Both places are opened from **one button beside Show Apps** (in the dash, or in
Dash to Panel's panel). `sectionButtons.js` builds it — a `Dash.ShowAppsIcon`
subclass for its icon and label — and it is the only way in besides the
shortcut and a controller's Home. A library with no games in it gets no
button. It behaves as a dock's Show Apps does: pressed on the desktop it opens
the overview itself, so a second press or Escape closes it again and lands on
the desktop; pressed with the overview already up, back to the window picker.
Every way out of an overview our button opened goes all the way down, Show
Apps included: a dock keeps a `forcedOverview` flag of its own that ours never
sets, so an overview left standing settled on the window picker and every
Show Apps press after that came back there instead of to the desktop. Show
Apps itself is left alone — it leaves the grid as it always has, and the grid
shows the apps again next time because a view only lives as long as the grid
is up.

**The shortcut** is `games-shortcut` (`as`, empty by default so nothing of the
system's is taken), grabbed with `Main.wm.addKeybinding` the way the shell
grabs its own — mutter follows the setting, so one set in the preferences
works at once, and it is not listed in GNOME Settings. A press is the button
(`app.js` `_onShortcut`): `toggle` on the browser. It is grabbed in `POPUP`
mode too, but only so the modal library's own panel can be closed with it;
over any other popup — another extension's included — it does nothing. The
preferences set it the way GNOME Settings does (`prefs.js` `_captureShortcut`):
system shortcuts are inhibited while the dialog listens — the shell asks once
whether the Extensions app may — and a key the window manager, the shell, the
media keys, a custom shortcut or one of our remote bindings already has is
refused, not taken over.

In the **`menu` library** `mediaMenu.js` puts the grid into the overview's
app-grid slot, and folds the overview's row of small workspaces away to give
the posters its room. How far it is folded is read from the overview's own
state adjustment, never timed: a fade of our own is out of step with the
shell's transition, and one started as the overview unmaps stalls until it is
next shown. In the **`modal` library** (`libraryWindow.js`) the grid goes
inside the folder's panel (`panel.js`) instead — pressing the button zooms
that panel out of it, exactly as the shell zooms an app folder's panel out of
its icon; a second press, Escape, or a click on the shade closes it, and the
panel dies the moment the button it came from unmaps (the overview closing, on
stock GNOME). Every place draws a poster with `createArtwork` (`widgets.js`);
only what holds it differs.

`detail-opens-in` `menu` pops the pane up the way the shell opens an app
folder (`detailDialog.js`, built on `panel.js` — the same `AppFolderDialog`
host the modal library's panel also subclasses): the tile fades, the panel
zooms out of its artwork over a shade, and a click on the shade or Escape
zooms it back. That class is the shell's `AppFolderDialog` with three things
changed and nothing else — the panel is sized around a poster rather than a
720px square, it holds a `DetailView` where the folder holds its grid, and
there is no name to edit — so the panel is styled `app-folder-dialog` and
follows the shell's theme.

The pane sits **inside** that panel rather than filling it, by `shape.js`
`PANE_INSET`, so the folder's own frame shows around the artwork the way it
shows around a folder's grid; the pane's radius is the panel's less the inset
(`paneInner`), which is what keeps the two curves concentric. The inset comes
out of the pane's own padding rather than being added to it, so what shows
between the panel's edge and the artwork is 32px either way — `detailView.js`
`PADDING` and the stylesheet's `.gm-pane-content` padding are the two halves
of that and must agree, or the pane overhangs the panel and the clip cuts the
backdrop's bottom corners square.

And what goes **behind and around** it is the folder's too, asked rather than
assumed (`panel.js` `folderLook`). Stock GNOME shades to `DIALOG_SHADE_NORMAL`
and paints the panel from its theme, and so does this; but an extension can
take that over — Blur my Shell drops the shade and blurs the background
instead, and makes the panel itself translucent with a class of its own on the
folder's box — and a panel that went on shading at 80% black behind an opaque
box reads as a different kind of thing entirely beside the folders it is
modelled on. So a folder's own dialog is looked at once per open: any
`Shell.BlurEffect` on it is matched here with the shade dropped, and any class
on its box beyond `app-folder-dialog` goes on ours, so the same stylesheet
paints both and nothing of the look is computed here. With Blur my Shell off
the folder carries neither, and with no folders on the desktop there is
nothing to ask, so the shade and the theme's panel stand.

It opens in **two moves**, so the first is the folder's own: the panel zooms
out of the tile as the artwork and its buttons alone — poster-shaped, as the
folder's square panel is icon-shaped, so the zoom is near enough uniform — and
then opens out sideways onto the title, facts and list, which were built on an
idle while it zoomed. Closing mirrors it. The pane is laid out once at the open
width inside a clip that *is* the panel, so widening reveals the second column
instead of reflowing every label under it per frame, and the panel's size is
asked of the side column (`get_preferred_height`) rather than added up from the
numbers the pane used — after `ensureStyleDeep`, see Gotchas.

It hosts itself where the pick was made: in `overviewGroup` when the overview
is up, in `uiGroup` otherwise — a tile in the modal library's own panel
included, since that panel hosts itself the same way — so either library goes
with `detail-opens-in` `menu`. Its `GrabHelper` is what takes Escape and the
keyboard; the tile going unmapped (the overview dismissed, the library panel
closing) is its cue to go at once, as it is the folder's.

`detail-opens-in` `modal` is the same `DetailDialog` with two flags turned: it
is hosted in `uiGroup` always rather than wherever the pick was made, so a pick
made in the overview hides the overview first — which unmaps the tile, so the
panel fades in centred instead of zooming out of it — and a pick made from the
modal library's panel closes that panel first; and it does not die when its
source tile unmaps, so a workspace change or a closed library panel leaves it
up. Either way, its `GrabHelper` keeps the modal grab the whole time it is up,
so Super and the workspace-switch keys are inert until Escape or a click away
closes it. The grab is `Shell.ActionMode.POPUP`, the tier the app folder and
the shell's popup menus use — not `SYSTEM_MODAL`, which is `modalDialog.js`'s
alone and would buy nothing but the loss of the message tray and
quick-settings shortcuts. Neither place is a window: both are shell chrome
holding a stage grab, and a real `Meta.Window` would mean a second process,
since the shell links no GTK.

Everything that runs in `app.js` and below runs **inside the compositor**, so a
long synchronous block is a dropped frame for the whole desktop. Two rules come
out of that. **Nothing builds an actor per thing you own**: the details list
fills through `lazyList.js` as it scrolls, and a grid builds the pages within
reach of the one showing, so a library of hundreds costs a screenful. **And
nothing is built on a frame that is animating**: the detail pane puts up its
artwork alone and builds its second column on the next idle, so the zoom that
opened it has the first frames to itself — and the list waits for the opening
move to finish altogether (`detailView.js` `_fillList`, a timer rather than
an idle, because an idle lands in the middle of an animation, which is the
whole of what it avoids). And **nothing stats per item**: `library.js` lists
the two artwork cache folders once per load and looks paths up in that, rather
than a blocking `file_test` per poster.

## Running next to other extensions

The user runs other extensions in the same shell that do what this one does:
put buttons beside Show Apps, put a grid in the same app-grid slot, hook the
same shell and Dash to Panel methods, and read the same controllers.
Everything below is what keeps them from breaking each other; keep it true.

- **GObject type names are global to the process.** Every
  `GObject.registerClass` class here is `GamesMenu…` (`GamesMenuMediaView`,
  `GamesMenuPanel`, `GamesMenuSectionIcon`, …). A duplicate name makes
  `enable()` throw. A new class gets the prefix.
- **Stylesheets are global.** Every class of ours is `gm-`. Shell classes
  (`app-folder-dialog`, `overview-tile`, `button`) are shared on purpose. The
  blur effect on a panel is named `games-menu-panel-blur`.
- **Shell and Dash to Panel monkey-patches must chain.** `mediaMenu.js` wraps
  the overview layout's `_getAppDisplayBoxForState` and `sectionButtons.js`
  wraps Dash to Panel's `panel._updateGroupedElements`, both as own properties
  of the instance, and another extension may wrap the same two. Each wrapper
  calls whatever it found, so they stack in either order. Taking one back is
  where it goes wrong: `delete` removes every wrapper put on after it too. So
  ours come off (`_unfoldWorkspaces`, the Dash to Panel host's `release`) only
  while the current value is still ours, and then by putting back exactly what
  was there before — the other extension's wrapper, or nothing (a `delete`, to
  show the class's method again). With someone else's wrapper over ours, ours
  stays as a link in their chain and goes inert: `folded` checks
  `menu._foldedBox === folded`, the panel wrapper checks its `element`.
  `_foldWorkspaces` also looks the class's method up on every call rather than
  keeping it, so a prototype patch made after us (Dash to Dock patches this
  very method) is not stepped round, and it measures the slot for its own
  views off the class rather than off what the wrapper beneath returned, which
  the other extension may have grown for its view.
- **Two views, one app grid.** A library shows its grid by adding a view to
  `appDisplay` and hiding `appDisplay._box`. If the grid is up, `_box` is
  hidden and the view is not ours (`MediaMenu._otherViewUp`), our button (or
  shortcut, or controller Home) does not draw over it: `open` hides the
  overview and reopens onto ours from the `hidden` handler (`_next`,
  `_reopenId`) — two of the shell's own transitions. Only one view is ever up,
  which is also what lets each fold wrapper grow the slot only for its own.
- **Controllers.** Another extension may read the same pads, and each should
  act only while its own library is up — except Home, which opens the library
  when nothing has focus.
  So Home here is the Guide button (`button:316`) and `keys-home` is empty,
  leaving Menu (`button:315`) and the remote's HomePage key to anything else.
  `_controlsOpen` also refuses while any modal grab is up
  (`Main.modalCount > 0`), so Guide never opens the games over another
  extension's panel or overview.
- **Workspaces.** `_emptyWorkspace` (for `play-on-new-workspace`) skips any
  workspace with `_keepAliveId` set — the shell's own during a drag, or an
  extension's on a workspace it has claimed for itself. It only ever reads
  `_keepAliveId`, never sets it.
- **Distinct paths.** Settings `org.gnome.shell.extensions.games-menu`, cache
  `~/.cache/games-menu/`, staging `$XDG_RUNTIME_DIR/games-menu/`, log prefix
  `[Games Menu]` (`make logs` greps for it), nested shell `games-menu-dev` in
  `$XDG_RUNTIME_DIR/games-menu-nested/`.

## Design rules

- **A modification of GNOME, not a second one.** Whatever the shell already has
  is what Games Menu uses: the app grid for the library, `AppViewItem` and
  `overview-tile` for a tile, `app-folder-dialog` for the panels, `button` for
  the actions, `global.focus_manager` for the keyboard, the dash's own
  `ShowAppsIcon` for the button. Before writing a widget, look for the
  shell's — the extension should be the games and the few shapes GNOME has no
  equivalent for (the detail pane, the rows), and nothing else.
- **Motion copies the shell.** `anim.js` holds the only durations and curves in
  use: 120 ms for hover and things leaving, 200 ms ease-out-quad or ease-out-
  expo for the rest. Don't invent new ones; `actor.ease()` already honours
  the animations toggle and slow-down factor, and `easeProps` takes the same
  factor for the one thing `ease()` cannot reach (a blur effect).
- **Corners come from one radius.** `corner-radius` (a setting, default 18px) is
  the only radius in the design; `shape.js` scales it into the handful the views
  need — artwork (rows share it), hero, panel, badge — and every rounded
  surface sets it inline as it is built. The stylesheet's `border-radius` values
  are fallbacks that match the default; change `shape.js`, not them. Pills stay
  `9999px` and are not scaled. The one exception to "one radius" is a surface
  *inside* another — `paneInner`, the pane within the folder's frame — which is
  the outer radius less the inset, so the two curves are concentric rather than
  one being visibly tighter than the other.
- **The style settings are one set, for both places.** `columns` (4–10) and
  `rows` (1–3) are the grid shape wherever a grid is drawn — the overview's
  slot, the modal panel — each capped by what fits at `mediaGrid.js`'s
  `MIN_ART` in the box that view is given, so a narrow space simply shows
  fewer of either; `corner-radius` is above; `detail-size` (80–120%) is how
  much of the work area the pop-up fills, and reaches `panel.js` `_budget()`
  alone; `grid-align` is whether a part-full row is centred under the full
  ones, as the app grid has it, or hugs the leading edge (`mediaGrid.js`
  `setGridAlign`, read by the layout as it allocates); the block itself is
  always centred, because `gridFor` shrinks the cover to fit `rows` and
  `columns` exactly and a block hugging the edge left all of that slack as one
  gap on the far side. The page dots keep their room on a one-page library —
  the shell hides them for a single page and the grid re-centred seven pixels
  lower. The hero artwork in the pop-up has a floor (`detailView.js`
  `HERO_MIN`, 132 logical px): on a small work area the smallest `detail-size`
  leaves less room than the buttons beneath the artwork take, and without the
  floor the hero came out at nothing — so the panel grows, the artwork does
  not vanish. There is no per-view copy of any of them, and a change of one
  rebuilds whatever is built.
- **Type is in em.** 1em is the stage's UI font, so every size in the
  stylesheet follows Settings → Accessibility → Large Text, and the values land
  on the shell's own steps (`%title_1` and friends in `_common.scss`). A px
  font-size in the stylesheet is a bug.
- **Colour comes from the accent.** The stylesheet never hardcodes a hue. Use
  `-st-accent-color` / `-st-accent-fg-color` with `st-lighten()`, `st-mix()` and
  `st-transparentize()`, exactly as `gnome-shell.css` does. Neutrals are the
  shell's own (`#222226`, `#fafafb`).
- **Placeholders are drawn, not generated.** Missing artwork gets an
  accent-tinted tile built in `widgets.js`, so nothing stale is cached on disk and
  an accent change shows immediately. A PS2 disc IGDB could not find, or with no
  IGDB key set, is exactly this.

## Gotchas

- **`extension.js` itself is cached for the life of the shell.** `make reload`
  picks up everything under `lib/`, `stylesheet.css` and the schema, but an edit to
  `extension.js` or `metadata.json` needs a log out / log back in (or, for the
  nested shell, `stop` + `start`).
- **New UUIDs need a logout** for the same reason: the shell only scans for
  unknown extension UUIDs at startup. `games-menu@jackt` is one.
- **`make reload` is not optional.** Edits in `src/` are live on disk via the
  symlink, but the shell holds the old module until the disable/enable cycle.
- **Play is a real launch.** In the nested shell as anywhere: `xdg-open
  steam://…` reaches the user's running Steam. Never press it to test.
- **A rounded background image must carry its radius inline.** St bakes the
  corner radius into artwork only when it renders the background image itself,
  so `border-radius` has to travel in the same `set_style()` string as
  `background-image`, never be left to the stylesheet alone.
- **Never give an image-backed widget a `box-shadow`.** St draws that shadow as
  a square box, ignoring the radius: clipped, it shows as dark rings in the
  rounded corners; unclipped, as a dark container behind the artwork.
- **St CSS is not web CSS.** No flexbox, grid, `calc()`, CSS variables or
  `linear-gradient()` (use `background-gradient-direction/start/end`). Layout is
  done in JS (`St.BoxLayout`, `Clutter.BinLayout`); the stylesheet is for paint
  only.
- **A freshly built actor has no style until something asks for it.** St
  computes a theme node lazily, but the numbers a widget takes *out* of its node
  — an `St.BoxLayout`'s `spacing`, a `margin` — are only picked up when
  `style-changed` is emitted on that widget, which happens no earlier than its
  first map. So `get_preferred_height` on a column built a moment ago answers as
  if it had no spacing and no margins: the detail popup's panel came out
  twenty-six pixels short of the pane inside it, and the clip cut the backdrop's
  bottom corners off square against the panel's rounded ones. `ensure_style()`
  fixes it but only for the widget it is called on — it merely marks the
  children dirty — so the whole subtree has to be walked: `anim.js`
  `ensureStyleDeep()`. Nothing may be measured before it.
- **The overview is laid out in the work area, not on the monitor.** The `box`
  the shell's `ControlsManagerLayout.vfunc_allocate` divides up is already inset
  by the top bar and by whatever else is reserved — Dash to Panel's panel, 48px
  of it — so anything that works out one of its boxes ahead of the shell
  (`mediaMenu.js` `_slotSize`, for a button pressed before the overview has
  ever been shown) must start from `getWorkAreaForMonitor`, and must measure
  the dash whether or not it is *visible*, as the shell does. The box the view
  standing was built for is kept, and it is dropped and built again when that
  moves.
- **A scroll view's `St.Adjustment` is already disposed when its `destroy`
  fires.** Disconnecting a handler from it there throws "already disposed"
  rather than tidying anything — the adjustment dies with the view, so its
  handlers go with it. `lazyList.js` takes back only its idle source.
- **Hover on a tile is crossing events, not `track_hover`.** The `hover`
  pseudo-class restyles a widget and all its children on every enter and
  leave; across a grid that is the cost of a hover. Only the few widgets that
  paint something from `:hover` (the rows) track it, and no rule keys a
  descendant off a parent's `:hover`.
- **Private shell API.** The `menu` library reaches
  `Main.overview._overview.controls`, its `_stateAdjustment`,
  `_workspacesDisplay` and `_searchController`, the layout's
  `_getAppDisplayBoxForState` (wrapped, and unwrapped on disable — see
  "Running next to other extensions"), `appDisplay._box`, and `BaseAppView`,
  which the shell does not export and is reached as `AppDisplay`'s prototype.
  `sectionButtons.js` adds `global.dashToPanel.panels` and its
  `panels-created` signal (Dash to Panel's own, used to re-attach the button
  when it rebuilds its panels), its `_updateGroupedElements` (wrapped), and
  `Dash.ShowAppsIcon` (exported, but its `_createIcon` and `_iconActor` are
  private shape the subclass fills in). `panel.js` `folderLook()` adds
  `appDisplay._folderIcons`, the `_dialog` each of them keeps and its
  `_viewBox`, read only to see what this desktop puts behind an open folder;
  it finds nothing on a desktop with no folders, and a shade is what it falls
  back to, so this one fails soft. `app.js` reads `Meta.Workspace._keepAliveId`.
  If the overview grid goes missing after a GNOME upgrade, look at the first;
  if the button stops appearing beside Show Apps after a GNOME or Dash to
  Panel upgrade, at the second; if the popup starts shading a desktop whose
  folders do not, at the third.
- **"Is the app grid up?" is `dash.showAppsButton.checked`, never
  `appDisplay.visible`.** The shell holds the app display visible for the whole
  slide down to the window picker (`_updateAppDisplayVisibility` takes the
  *larger* of the states it is moving between) and does not update it again
  once the transition is dropped, so a view read from that visibility
  outlived the grid: Escape left the view current and Show Apps still held by
  us, and the next click on it went nowhere. The button's own checked state is
  set as the grid opens and cleared on every way out — Escape, a swipe, a
  search, leaving the overview — so `mediaMenu.js` follows it.
- **`captured-event::key` is wider than a key press.** Key releases and the
  input method's own events carry the same detail, and asking one of those for
  a key symbol is a Clutter assertion in the journal, twice per keystroke. Check
  `event.type() === Clutter.EventType.KEY_PRESS` first, exactly as the shell
  does (`calendar.js:860`); `mediaMenu.js` `_force()` is the only such handler
  here.
- **Never hardcode the repo path.** Resolve paths from `this.path` /
  `this.dir.get_uri()` in JS and `__file__` in Python — the extension has to work
  from the installed copy, not just the symlink. Modules under `lib/` run from a
  staging copy, so never derive resource paths from `import.meta.url` either.
- **Never touch a game's folder synchronously.** A PS2 disc folder can sit on a
  network share behind a systemd automount that idles out, and the first stat
  after that blocks until it is mounted again — eleven seconds, measured. In
  `prefs.js` that is how long the window takes to open; in `lib/` it is the
  whole desktop standing still. Use `query_info_async` and friends
  (`launch_default_for_uri_async` for Show in Files); only the cache folder,
  which is always local, is read synchronously.
- **Check the logs.** Exceptions inside the extension are swallowed into the shell
  journal, not a terminal. `make logs` is the only way to see them.
- **A freeze leaves no log; `make stalls` catches one in the act.** It writes
  three timestamped streams to `dist/stalls.log`: stalls of the shell's main
  loop, processes held in the kernel (`autofs_wait` is a systemd automount
  being mounted, `cifs_*` a share answering slowly) and which process woke an
  automount. Measure the main loop with a `Properties.Get` on
  `org.gnome.Shell`, never `Peer.Ping` — GDBus answers a ping on its worker
  thread, so a ping stays fast through any stall.
- **The shares idle out, and one of them can be offline.** `/media/LENOVO` and
  `/media/HP-AIO` are systemd automounts with a 60 s idle timeout; the first
  touch after that blocks until the mount is back, and an offline share blocks
  every toucher for the whole connect timeout (11 s measured). That is why
  nothing in `lib/` or `prefs.js` touches a game's folder synchronously
  (above).
- **API keys are secrets.** They sit in dconf in plain text, in the
  `credentials` setting (the README and the schema say so; the preferences
  do not yet). Never log them, never put them on a command line, and never
  paste them into the conversation; reading them back
  out of GSettings is fine, which is how the scanner gets them. Never run the
  scanner with `--from-settings` to test (it reads the real keys and goes
  online); see `src/backend/CLAUDE.md`. `~/Documents/keys/<SERVICE>/` is the
  user's key drop shared with other projects, and each key row's Import button
  reads it from there.
- **The 48 floor is the theme's, not the architecture's.** Every shell class
  and private field this extension reaches is identical from 48.0 to 50.4; what
  actually stops it going lower is CSS — the whole accent palette is
  `-st-accent-color`, which is 47+, and `St.BoxLayout({orientation})`, used
  throughout, is 48+. The prefs' `Adw.ToggleGroup` is libadwaita 1.7, which
  is 48 too.
- **The neutrals are the dark palette's on purpose.** What is drawn inside the
  panels — titles, facts, rows — is light on the shell's dark folder panel and
  on a dimmed backdrop. A light variant is one style class synced from
  `Main.getStyleVariant()` and a dozen rules, not a second stylesheet — worth
  doing if asked for, not worth doing speculatively.
- **JS sizes are physical pixels; CSS strings are not.** A number that meets an
  allocation (`set_size`, a layout calculation, a budget) is logical px from a
  constant or a setting and has to be multiplied by
  `St.ThemeContext.get_for_stage(global.stage).scale_factor` before it is used.
  A number written into a `set_style()` string (`radiusStyle()`, `padding:`)
  must **not** be scaled — St scales CSS itself, so scaling it twice doubles it
  on HiDPI. `St.Icon.icon_size` is the one exception in the allocation
  direction: it is logical, so a size derived from physical px is *divided* by
  the scale factor, not multiplied (`widgets.js` `createArtwork`).
- **The staged `lib/` copy survives a screen unlock, not just a reload.**
  `extension.js` names the staging directory after a checksum of `lib/`'s file
  contents (name, size, mtime), not the time it was built, so re-enabling after
  a lock (GNOME disables every extension at lock and re-enables at unlock)
  finds the same directory and re-imports from GJS's module cache rather than
  copying and building again. Only an actual edit — which changes the checksum
  — makes a new stage; the sweep on the next `enable()` removes whatever stage
  is no longer current.
