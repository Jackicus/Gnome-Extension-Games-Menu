# Games Menu

**Your installed games, in a menu of their own beside Show Apps.**

A GNOME Shell extension that gathers the games you already have — every
installed Steam game, across every Steam library on every drive, and the PS2
discs PCSX2 is pointed at — into one library with proper cover art, synopses,
ratings and playtime. It opens in the overview next to your apps, or in a
panel that pops out of its button, and pressing **Play** starts the game the
way its launcher would.

**It does not run games itself.** There is no emulator or launcher in here. A
Steam game is started through Steam (`steam://rungameid/…`, so your launch
options, Proton version and overlay all still apply), and a PS2 disc is handed
to PCSX2. Think of it as a good-looking front door to launchers you already
use.

It is the games half of [Media Libraries](https://github.com/Jackicus/Gnome-Extension-Media-Libraries),
split out into its own extension, and the two are made to run side by side.

---

## What it does

- **Finds your games on its own.** Steam's own library files are read,
  including libraries on other drives, and PS2 discs come from wherever
  `PCSX2.ini` points. Nothing to configure.
- **Finds the artwork for you.** Steam games get Valve's own library art and
  store description; PS2 discs use PCSX2's covers, or IGDB's with a free key.
  Everything is cached locally and pre-scaled, so browsing stays instant.
- **Built out of GNOME, not on top of it.** The grid *is* the shell's app grid
  — same paging, same swipe, same keyboard, same hover and focus rings — and
  a game opens the way an app folder does. It follows your accent colour, your
  font size and your theme, because it is using the shell's own widgets rather
  than imitating them.
- **Made for the couch.** A game controller, a media remote, or any keys you
  choose can drive it, and the Guide button opens it from the desktop.
- **Nothing to leave running.** No daemon, no tray icon, no window. It draws
  when you look at it and costs nothing when you don't.

## What it is not

- Not a launcher, an emulator or a store.
- Not a library manager — it won't install, move or uninstall anything.
- Not a downloader. It fetches artwork and descriptions, and only that.

---

## Getting started

### 1. Check you're on a supported GNOME

GNOME Shell **48, 49 or 50**. Nothing else is needed — the scanner uses
Python 3 and the image libraries GNOME already ships. (If you happen to have
[Pillow](https://python-pillow.org/) installed it will use that instead;
either way, it's optional.)

```bash
gnome-shell --version
```

### 2. Install it

```bash
git clone https://github.com/Jackicus/Gnome-Extension-Games-Menu.git
cd Gnome-Extension-Games-Menu
make install
```

Then **log out and back in**. GNOME only notices a brand-new extension at
login — there's no way around it on Wayland.

### 3. Scan

Open the preferences:

```bash
gnome-extensions prefs games-menu@jackt
```

and press **Rescan** on the **Games** page. Steam and PCSX2 are found on their
own; if yours live somewhere unusual, point the two rows on that page at them.
The first run takes a while — it's looking every game up online — and after
that it only fetches what it hasn't seen.

That's it. A **Games** button appears beside Show Apps — in the overview's
dash, or in Dash to Panel's panel if you use it.

---

## Choosing how it looks

Two settings on the **General** page decide where things happen, and they're
read independently of each other:

| | Library opens in | Games open in |
|---|---|---|
| **Menu** | The overview, next to your apps, opened from the button beside Show Apps | A pop-up that zooms out of the cover, the way an app folder does |
| **Modal** | A panel that pops out of that button, over the desktop | A pop-up over everything, until you dismiss it |

**Play on a new workspace** starts each game on an empty workspace of its own,
leaving the one you picked it from as it was.

The **Appearance** group applies to both: **rows** and **columns** (fewer of
either means bigger covers), **corner radius**, and how much of the screen the
pop-up fills. Colour comes from your system accent, and text sizes follow
Settings → Accessibility → Large Text.

A **keyboard shortcut** for the library can be set on the General page too; the
same shortcut again closes it.

---

## Controllers and remotes

The **Controls** page binds each action — the four directions, Select, Back,
Home and a page each way — to keys and to controller buttons. Xbox,
PlayStation and most other pads work as they are; the Guide button opens the
library whenever no window has the keyboard. Controllers are only listened to
while the library is on screen, so your games are left alone. It uses
libmanette, which most GNOME desktops already have.

---

## Artwork sources

| Games | Source | Key needed? |
|---|---|---|
| Steam | Steam's store and artwork CDN | No |
| PlayStation 2 | PCSX2's own covers, then IGDB | Only IGDB |

IGDB needs a free Twitch developer application —
[dev.twitch.tv](https://dev.twitch.tv/console/apps) → Applications → Register —
whose client ID and secret go in the Games page. Without one, PS2 discs with no
PCSX2 cover simply get a drawn placeholder.

> Keys are stored in dconf in plain text, like any other GNOME setting. Treat
> them the way you'd treat any other credential on your machine.

---

## Alongside Media Libraries

Games Menu and Media Libraries can both be enabled. Each has its own button
beside Show Apps, its own settings and its own cache. Pressing one's button
while the other's grid is up in the overview swaps them over. Their
controllers' Home buttons differ by default — Guide opens Games Menu, Menu
opens Media Libraries — so one press never opens both.

---

## Everyday commands

You never need these — the preferences do the same things — but they're handy.

| Command | Does |
|---|---|
| `make status` | What's installed, whether it's enabled, how big the library is |
| `make scan` | Re-index your games and fetch artwork |
| `make logs` | Follow the shell journal, filtered to this extension |
| `make uninstall` | Remove it entirely |

Something looks wrong? `make logs` first — a GNOME extension's errors go to
the system journal, never to a terminal.

---

## Development

`CLAUDE.md` is the real design document: how the pieces fit together, which
shell internals are being used and why, what keeps it from tripping over
Media Libraries, and the traps that bite.

```bash
# Symlink src/ into the extensions dir, so edits are live
make link

# Apply your edits (recompiles schemas, disable/enable, no shell restart)
make reload

# Follow shell logs, filtered to Games Menu
make logs
```

`make link` is the one to use while working in this repo. Run it once; after
that `make reload` picks up every edit straight from `src/`. Edits to
`extension.js` or `metadata.json` still need a full log out and back in.

| Command | Does |
|---|---|
| `make install` | Clean copy into the extensions dir (a real install, not a symlink) |
| `make stalls` | Watch for desktop freezes and log what stalled, on what, with timestamps |
| `make pack` | Build `dist/games-menu@jackt.shell-extension.zip` |
| `make clean` | Drop compiled schemas, `dist/`, and files that don't ship |

### Seeing it

The UI renders into the overview or into a shell-native panel, not into an
ordinary window, so a visual change can only be verified by looking at it.
These targets drive a throwaway **nested GNOME Shell** with a live mirror on
the real desktop — see `CLAUDE.md` and the `drive-extension` skill before using
them.

| Command | Does |
|---|---|
| `make nested` | Start the nested shell, with a live mirror window on the desktop |
| `make nested-headless` | Same, without the mirror window |
| `make preview` | Start it (if not already running) and take a screenshot |
| `make nested-status` | Report whether it's running |
| `make nested-stop` | Tear it down — always run this when finished |
