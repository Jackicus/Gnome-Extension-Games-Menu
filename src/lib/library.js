// Reads ~/.cache/games-menu/library.json (written by backend/scan_library.py)
// and normalises every game into one shape the views can render:
//
//   item = {
//     id, kind, title, subtitle, year, rating, tags, summary, art, backdrop, folder,
//     countLabel,               // "105 hours played"
//     playPath, playLabel,      // the command line Play runs
//     details: {name, entries: [{title, subtitle, path, icon, badges, size}]},
//   }

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The one section. It is a list, and a section is a key, because that is the
// shape the grid, the button beside Show Apps and the preferences are built
// around: `games-` settings, a title and an icon, looked up by key.
export const SECTIONS = [
    {
        key: 'games',
        prefix: 'games',
        title: 'Games',
        icon: 'applications-games-symbolic',
        aspect: 1.5,
    },
];

export function sectionByKey(key) {
    return SECTIONS.find(s => s.key === key) ?? SECTIONS[0];
}

function cacheDir() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'games-menu']);
}

export function libraryPath() {
    return GLib.build_filenamev([cacheDir(), 'library.json']);
}

// "141 in your library", said by the modal library's header.
export function libraryCountLabel(count) {
    return count ? `${count} in your library` : 'Nothing indexed yet';
}

// The file as the scanner wrote it: the raw per-section arrays and when it ran.
export function readSections() {
    const nothing = {sections: {}, generated: null};
    const path = libraryPath();
    if (!GLib.file_test(path, GLib.FileTest.EXISTS))
        return nothing;
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return nothing;
        const raw = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        return {sections: raw?.sections ?? {}, generated: raw?.generated ?? null};
    } catch (e) {
        console.error(`[Games Menu] Failed to read ${path}: ${e}`);
        return nothing;
    }
}

// Returns {games: [...]} of normalised items. A missing or unreadable file
// yields an empty section, never fake data.
export function loadLibrary() {
    const empty = Object.fromEntries(SECTIONS.map(s => [s.key, []]));
    const {sections} = readSections();
    const art = artworkIndex();
    const out = {...empty};
    for (const section of SECTIONS) {
        const items = sections[section.key];
        if (Array.isArray(items))
            out[section.key] = items.map(item => normalizeGame(item, art)).filter(Boolean);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Is the artwork still there?
//
// A path in library.json can outlive the file it names — a cleared cache — and
// St paints a missing background image as nothing at all, so the drawn
// placeholder would never get its turn. Checking costs a blocking stat per
// item, though, and this runs on the compositor's main loop for every game.
//
// Every one of those paths is the scanner's own, in two cache folders: it
// copies the Steam client's own library art and PCSX2's covers in with the
// rest, scaled to what the desktop draws. So the folders are listed once and
// the check is a lookup. A path from anywhere else counts as missing rather
// than earning a stat of its own — a PS2 disc folder can be on a share that
// has gone to sleep, and one stat of that is the desktop standing still until
// it wakes.
// ---------------------------------------------------------------------------
const ART_DIRS = ['posters', 'backdrops'];

function listNames(path) {
    const names = new Set();
    let children;
    try {
        children = Gio.File.new_for_path(path).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (e) {
        return names;   // the folder is not there yet: nothing is cached
    }
    let info;
    while ((info = children.next_file(null)) !== null)
        names.add(info.get_name());
    children.close(null);
    return names;
}

function artworkIndex() {
    const root = cacheDir();
    const index = new Map();
    for (const name of ART_DIRS) {
        const dir = GLib.build_filenamev([root, name]);
        index.set(dir, listNames(dir));
    }
    return index;
}

function exists(path, art) {
    if (!path)
        return false;
    const cut = path.lastIndexOf('/');
    return art.get(path.slice(0, cut))?.has(path.slice(cut + 1)) ?? false;
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
const PLATFORM_NAMES = {steam: 'Steam', ps2: 'PlayStation 2'};

// 58 -> "58 minutes played"; 6347 -> "105 hours played". Steam counts in
// minutes and never rounds, so anything past a couple of hours reads better
// as hours.
function playtimeLabel(minutes) {
    if (!minutes || minutes < 1)
        return null;
    if (minutes < 120)
        return `${plural(minutes, 'minute')} played`;
    return `${plural(Math.round(minutes / 60), 'hour')} played`;
}

function normalizeGame(game, art) {
    if (!game || !game.title)
        return null;
    const platform = PLATFORM_NAMES[game.platform] ?? 'Game';
    const played = playtimeLabel(game.playtime_minutes);
    const folder = game.folder_path ?? null;

    // Not a list of things to play — a game is one thing — so the list is
    // what there is to know about it, each row opening the folder it names.
    const entries = [];
    if (folder) {
        entries.push({
            index: entries.length + 1,
            title: game.platform === 'ps2' ? 'Disc image' : 'Install folder',
            subtitle: game.platform === 'ps2' ? (game.disc_path ?? folder) : folder,
            path: folder,
            icon: 'folder-symbolic',
            badges: game.disc_format ? [game.disc_format.toUpperCase()] : [],
            size: game.size_mb ? `${Math.round(game.size_mb)} MB` : null,
        });
    }
    if (played) {
        entries.push({
            index: entries.length + 1,
            title: 'Playtime',
            subtitle: played,
            path: null,
            icon: 'preferences-system-time-symbolic',
            badges: [],
            size: null,
        });
    }
    if (game.serial) {
        entries.push({
            index: entries.length + 1,
            title: 'Serial',
            subtitle: game.serial,
            path: null,
            icon: 'media-optical-symbolic',
            badges: [],
            size: null,
        });
    }

    const launch = Array.isArray(game.launch) && game.launch.every(a => typeof a === 'string' && a)
        ? game.launch : null;
    return {
        id: game.id ?? game.title,
        kind: 'games',
        title: game.title,
        // The platform is the strong fact at the head of the row; the count
        // beside it is only ever the playtime, so a game never played does
        // not say its platform twice.
        subtitle: platform,
        year: game.year ?? null,
        rating: game.rating ?? null,
        tags: Array.isArray(game.genres) ? game.genres.slice(0, 3) : [],
        summary: game.summary ?? null,
        art: exists(game.poster_path, art) ? game.poster_path : null,
        backdrop: exists(game.backdrop_path, art) ? game.backdrop_path : null,
        folder,
        countLabel: played,
        details: {name: 'Details', entries},
        // An argv array: the app runs it as a command line rather than
        // handing it to the default application (openPath in app.js).
        playPath: launch,
        playLabel: 'Play',
    };
}
