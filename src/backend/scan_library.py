#!/usr/bin/env python3
"""Index the installed games and write the library.json Games Menu reads.

Games are not a folder of media: Steam's library files and PCSX2's ini say
where everything is, and both are auto-detected, so a bare run scans them. The
two paths only override that.

    python3 scan_library.py
    python3 scan_library.py --steam-path ~/.local/share/Steam --offline
    python3 scan_library.py --sources steam,igdb@2

`--from-settings` fills all of that in from GSettings instead, so the Rescan
button in the preferences and ./scripts/dev.sh both just run this rather than
each rebuilding the same command line:

    python3 scan_library.py --from-settings

Run standalone for debugging, or from the Rescan button in the preferences.
"""

import argparse
import ast
import concurrent.futures
import contextlib
import fcntl
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from games_scanner import scan_games  # noqa: E402
from metadata import (  # noqa: E402
    CACHE_DIR, PROVIDERS, MetadataService, fit_cached_art, prune_art, source_id,
)

LIBRARY_VERSION = 1
SECTIONS = ("games",)

# Enrichment is almost entirely waiting on someone else's server, so it runs on
# a small pool. Small deliberately: both sources are free, and Steam's store
# answers bursts with 429 (metadata.py backs off and retries, but the polite
# thing is not to provoke it).
ENRICH_WORKERS = 6

SCHEMA = "org.gnome.shell.extensions.games-menu"
# The schemas ship beside the backend in the extension directory, so they are
# found from the installed copy as readily as from the repo.
SCHEMA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schemas")

# The library the extension reads. A run with --out somewhere else writes a
# library of its own, but shares this machine's one artwork cache.
LIBRARY_PATH = os.path.join(CACHE_DIR, "library.json")


def load_existing(path):
    """The sections of a library.json, or nothing when there is none yet."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    sections = data.get("sections", {}) if isinstance(data, dict) else {}
    return {k: v for k, v in sections.items() if k in SECTIONS}


@contextlib.contextmanager
def library_lock(out):
    """Hold the library against concurrent scans.

    Two scans running at once — the preferences' Rescan and `make scan`, say —
    would each write library.json and the metadata index as they found them,
    and each prune the artwork the other had just fetched.
    """
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(f"{out}.lock", "w", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("Another scan is already running; waiting for it to finish...")
            fcntl.flock(handle, fcntl.LOCK_EX)
        yield


# --------------------------------------------------------------------------
# Reading the preferences
# --------------------------------------------------------------------------
def _setting(key):
    """One GSettings value as a plain string, or None if it cannot be read."""
    argv = ["gsettings"]
    if os.path.exists(os.path.join(SCHEMA_DIR, "gschemas.compiled")):
        argv += ["--schemadir", SCHEMA_DIR]
    argv += ["get", SCHEMA, key]
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None
    return out[1:-1] if len(out) >= 2 and out[0] == out[-1] == "'" else out


def _setting_value(key):
    """One GSettings value as a Python object, for the keys that are not plain
    strings — `credentials` (a{ss}) and the source list (as).

    gsettings prints GVariants in a syntax that is also valid Python literal
    syntax, optionally behind an `@type` prefix for an empty container, so
    ast.literal_eval reads them without pulling gi into the backend. It only
    ever evaluates literals, so a credential holding anything at all is still
    only ever data.
    """
    raw = _setting(key)
    if raw is None:
        return None
    if raw.startswith("@"):
        raw = raw.split(" ", 1)[1] if " " in raw else ""
    try:
        return ast.literal_eval(raw)
    except (ValueError, SyntaxError):
        return None


def apply_settings(args, parser):
    """Fill the command line in from the preferences.

    This is the only place that knows how a setting becomes a scanner flag, so
    the preferences and dev.sh cannot drift from it or from each other.
    """
    if _setting("library-opens-in") is None:
        parser.error(
            "--from-settings could not read the Games Menu settings. Compile the "
            f"schemas ({SCHEMA_DIR}) or pass the paths explicitly.")

    # The two roots are auto-detected; a setting only overrides that.
    args.steam_path = args.steam_path or _setting("steam-path") or ""
    args.pcsx2_path = args.pcsx2_path or _setting("pcsx2-path") or ""

    if args.sources is None:
        listed = _setting_value("games-sources")
        if isinstance(listed, list):
            args.sources = [str(e) for e in listed]
    if _setting("games-online") == "false":
        args.offline = True

    # Read here rather than taken from the environment, so the preferences and
    # dev.sh both just run the scanner and neither has to hand it a key.
    credentials = _setting_value("credentials")
    if isinstance(credentials, dict):
        args.credentials = {str(k): str(v) for k, v in credentials.items()}


# --------------------------------------------------------------------------
# Scanning
# --------------------------------------------------------------------------
def enrich_all(meta, items):
    """Fill in metadata and artwork for `items`, several at a time.

    A scan that is not going online has nothing to wait for — it only reads
    the cache — so it is done in line rather than on the pool.
    """
    def one(item):
        try:
            meta.enrich(item)
        except Exception as e:  # one bad item must never abort the scan
            print(f"Metadata failed for '{item.get('title')}': {e}")

    if len(items) < 2 or not meta.online:
        for item in items:
            one(item)
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=ENRICH_WORKERS) as pool:
        list(pool.map(one, items))


def main():
    parser = argparse.ArgumentParser(description="Scan installed games and cache their metadata.")
    parser.add_argument("--steam-path", default="", help="Steam library root (empty: auto-detect)")
    parser.add_argument("--pcsx2-path", default="", help="PCSX2 config folder (empty: auto-detect)")
    parser.add_argument("--sources", metavar="A,B",
                        help="Sources, in the order they are tried (steam, igdb, igdb@2). "
                             "Keys come from the preferences or the environment, never from here.")
    parser.add_argument("--offline", action="store_true", help="Skip online metadata and artwork")
    parser.add_argument("--from-settings", action="store_true",
                        help="Take the paths, sources, keys and online switch from the preferences")
    parser.add_argument("--out", default=LIBRARY_PATH)
    args = parser.parse_args()

    # Filled either from --sources or, below, from the preferences.
    args.credentials = {}
    if args.sources is not None:
        entries = [e.strip() for e in args.sources.split(",") if e.strip()]
        unknown = [e for e in entries if source_id(e) not in PROVIDERS]
        if unknown:
            parser.error(f"--sources: {', '.join(unknown)} is not one of {', '.join(PROVIDERS)}")
        args.sources = entries

    if args.from_settings:
        apply_settings(args, parser)

    # Keys come from the preferences, or from the environment
    # (GAMES_MENU_IGDB_CLIENT_ID, GAMES_MENU_IGDB_CLIENT_SECRET) for a
    # standalone run. Never argv.
    meta = MetadataService(
        online=not args.offline,
        sources=args.sources,
        credentials=args.credentials,
    )

    with library_lock(args.out):
        # Every artwork path the shell is given has to be a file in the cache,
        # no larger than the desktop draws it; this keeps that true for what
        # was fitted to smaller caps than today's.
        fitted = fit_cached_art()

        t0 = time.time()
        games = scan_games(
            steam_root=os.path.expanduser(args.steam_path) or None,
            pcsx2_root=os.path.expanduser(args.pcsx2_path) or None,
        )
        enrich_all(meta, games)
        meta.flush()
        print(f"games: {len(games)} items ({time.time() - t0:.1f}s)")

        library = {
            "version": LIBRARY_VERSION,
            "generated": time.time(),
            "sections": {"games": games},
            "scanned": {
                "games": {
                    "path": args.steam_path or "auto",
                    "count": len(games),
                    "steam": sum(1 for g in games if g.get("platform") == "steam"),
                    "ps2": sum(1 for g in games if g.get("platform") == "ps2"),
                },
            },
        }
        tmp = f"{args.out}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(library, f, indent=1)
        os.replace(tmp, args.out)  # atomic: the shell's file monitor never sees a half-written file
        print(f"Wrote {args.out}")
        # Pruned after the write: what the library points at is exactly what
        # is worth keeping. Only for the real library, though — a run written
        # elsewhere shares this cache with it, and pruning against a library
        # the extension is not reading would delete the artwork it is.
        dropped = 0
        if os.path.abspath(args.out) == os.path.abspath(LIBRARY_PATH):
            dropped = prune_art(library["sections"])
        if fitted or dropped:
            print(f"Artwork cache: {fitted} scaled down, {dropped} removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
