// GamesMenuApp: where the games library opens, where a picked game opens, and
// what launching one does.
//
// Two settings decide where things open, and they are read independently of
// each other: `library-opens-in` for the grid, `detail-opens-in` for the pane
// of a picked game. Both take the same two values, meaning the same two
// places:
//
//   menu    in the overview's app-grid slot (mediaMenu.js) for the library;
//           popped up as an app folder is (detailDialog.js) for a pane
//   modal   in the folder's panel over the desktop (libraryWindow.js for the
//           library, detailDialog.js for a pane), held until it is closed
//
// Neither setting looks at the other, and nothing follows from the pair.
//
// Nothing is drawn on the wallpaper. A game is one thing to launch, not a
// collection to leave standing on the desktop, so the library is only ever
// somewhere of the shell's, opened from its button beside Show Apps.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {SECTIONS, loadLibrary, libraryPath, sectionByKey} from './library.js';
import {setCornerRadius} from './shape.js';
import {setGridAlign} from './mediaGrid.js';
import {MediaMenu} from './mediaMenu.js';
import {LibraryWindow} from './libraryWindow.js';
import {DetailDialog} from './detailDialog.js';
import {Controls} from './controls.js';

// What Play and the rows of the pane open. An array is a game's command line
// — Steam's own launch URI, or PCSX2 with the disc — run as it is; the
// shell's own spawn helper says so in a notification when that fails.
// Anything else is a folder, handed to whatever opens folders.
//
// `beforeLaunch` runs just before a game is launched, and never for a folder.
function openPath(path, beforeLaunch = null) {
    if (!path)
        return;
    if (Array.isArray(path)) {
        beforeLaunch?.();
        Util.spawn(path);
        return;
    }
    // Asynchronously all the way: a PS2 disc folder can sit on a network
    // share or an automount that has idled out, and a folder asked about
    // synchronously would stand the whole desktop still until it wakes.
    const file = Gio.File.new_for_path(path);
    Gio.AppInfo.launch_default_for_uri_async(file.get_uri(),
        global.create_app_launch_context(0, -1), null, (_source, res) => {
            try {
                Gio.AppInfo.launch_default_for_uri_finish(res);
            } catch (e) {
                Main.notifyError(`Could not open ${file.get_basename()}`, e.message);
            }
        });
}

export class GamesMenuApp {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._sections = {};
        // Where the library is browsed: the menu view or the window view.
        this._browser = null;
        // The pop-up a pick opens in, whichever place that is.
        this._dialog = null;
        this._monitor = null;
        this._rebuildTimer = 0;
        this._reloadWanted = false;
        // Remotes, controllers and keys of the user's own (controls.js).
        this._controls = new Controls(this._settings, {
            isActive: () => this._controlsActive(),
            onHome: () => this._controlsHome(),
            onOpen: () => this._controlsOpen(),
            currentView: () => this._browser?.currentView ?? null,
        });
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    enable() {
        this._controls.enable();
        this._sections = loadLibrary();
        this._build();

        // Every size in JS is physical pixels, worked out from the scale
        // factor as it was; a change of it is a change of everything.
        St.ThemeContext.get_for_stage(global.stage).connectObject('notify::scale-factor',
            () => this._scheduleRebuild(), this);

        const rebuildKeys = ['columns', 'rows', 'grid-align', 'corner-radius', 'detail-size',
            'library-opens-in', 'detail-opens-in'];
        for (const key of rebuildKeys)
            this._settings.connectObject(`changed::${key}`, () => this._scheduleRebuild(), this);

        // The shortcut, grabbed the way the shell grabs its own: the setting
        // holds the accelerators, and mutter follows it as it changes, so a
        // shortcut set in the preferences works at once. In the overview as
        // well as on the desktop, as Super+A is — and over a popup, which is
        // only so the modal library's own panel can be closed with it; see
        // `_onShortcut`.
        for (const section of SECTIONS) {
            Main.wm.addKeybinding(`${section.prefix}-shortcut`, this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
                () => this._onShortcut(section.key));
        }

        // The scanner writes library.json atomically; refresh when it lands so
        // a rescan from the preferences shows up without touching the shell.
        try {
            const file = Gio.File.new_for_path(libraryPath());
            this._monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (_m, _f, _o, event) => {
                if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                    event === Gio.FileMonitorEvent.CREATED ||
                    event === Gio.FileMonitorEvent.RENAMED ||
                    event === Gio.FileMonitorEvent.MOVED_IN)
                    this._scheduleRebuild({reload: true, delay: 400});
            });
        } catch (e) {
            console.warn(`[Games Menu] Could not watch library.json: ${e}`);
        }
    }

    disable() {
        for (const section of SECTIONS)
            Main.wm.removeKeybinding(`${section.prefix}-shortcut`);
        St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
        this._settings.disconnectObject(this);
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._rebuildTimer)
            GLib.source_remove(this._rebuildTimer);
        this._rebuildTimer = 0;
        this._teardown();
        this._sections = {};
        this._controls.disable();
    }

    _teardown() {
        // Closes whatever it had open, too.
        this._browser?.disable();
        this._browser = null;
        // Let go of the keyboard and the tile it came out of before it goes.
        this._dialog?.popdown();
        this._dialog?.destroy();
        this._dialog = null;
    }

    // Settings arrive in bursts (a slider dragged, a spin button held down),
    // and a rescan writes the library more than once; `reload` rides the same
    // timer so a burst of either is one rebuild.
    _scheduleRebuild({reload = false, delay = 150} = {}) {
        this._reloadWanted ||= reload;
        if (this._rebuildTimer)
            GLib.source_remove(this._rebuildTimer);
        this._rebuildTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._rebuildTimer = 0;
            if (this._reloadWanted)
                this._sections = loadLibrary();
            this._reloadWanted = false;
            // A browser being looked at is put back up once rebuilt, so the
            // change that caused the rebuild shows where it is being looked
            // for rather than on the next press.
            const browsing = this._browser?.state ?? null;
            this._teardown();
            this._build();
            this._browser?.restore(browsing);
            console.log('[Games Menu] Rebuilt');
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------------------------
    // Settings helpers
    // ------------------------------------------------------------------
    // The two independent choices, each 'menu' or 'modal'; see the note at
    // the top of this file.
    _libraryMode() {
        return this._settings.get_string('library-opens-in');
    }

    _detailMode() {
        return this._settings.get_string('detail-opens-in');
    }

    // ------------------------------------------------------------------
    // Building
    // ------------------------------------------------------------------
    _build() {
        // Every rounded surface reads its radius as it is constructed, so the
        // setting has to be in place before anything below is built.
        setCornerRadius(this._settings.get_int('corner-radius'));
        setGridAlign(this._settings.get_string('grid-align'));

        // A pick pops up in the folder's panel, which hosts itself over
        // whatever it is opened from.
        this._dialog = new DetailDialog({
            onOpen: path => this._open(path),
            size: this._settings.get_int('detail-size') / 100,
            mode: this._detailMode(),
        });

        // The library as a second application menu in the overview, or in a
        // panel popped out of its button.
        const Browser = this._libraryMode() === 'modal' ? LibraryWindow : MediaMenu;
        this._browser = new Browser({
            sections: SECTIONS,
            itemsFor: key => this._sections[key] ?? [],
            onActivate: (key, item, tile) => this._openPicked(key, item, tile),
            columns: this._settings.get_int('columns'),
            rows: this._settings.get_int('rows'),
        });
        this._browser.enable();
    }

    // ------------------------------------------------------------------
    // Navigation
    // ------------------------------------------------------------------
    // The shortcut: the library, wherever it opens, or — when that is what is
    // up — the way back out, exactly as its button is pressed.
    _onShortcut(key) {
        // A popup holds the keyboard for itself — a menu in the top bar, the
        // detail pop-up, Media Libraries' own panel — unless it is the modal
        // library's panel, which the shortcut closes as its button does.
        if (Main.actionMode === Shell.ActionMode.POPUP &&
            !(this._browser instanceof LibraryWindow && this._browser.state.key))
            return;
        this._browser?.toggle(key);
    }

    // A pick in the library. A "modal" pane wants the desktop to itself, so
    // the library goes first (the popup hides the overview itself).
    _openPicked(key, item, tile) {
        if (this._detailMode() === 'modal')
            this._browser.close();
        this._dialog.popup(tile, item, sectionByKey(key));
    }

    // Is the library what has the keyboard — the pop-up, or a browser on
    // show? A controller is only acted on while it is.
    _controlsActive() {
        return !!(this._dialog?.isOpen || this._browser?.isShowing);
    }

    // Home, from a remote or a controller: all the way out, to wherever the
    // library was opened from.
    _controlsHome() {
        this._dialog?.popdown();
        this._browser?.close();
    }

    // Home on a controller with nothing of ours up: the library, opened, when
    // nothing else has the keyboard — never over a window, where it would be
    // a game's own button too, and never over someone else's popup or
    // overview, Media Libraries' included.
    _controlsOpen() {
        if (global.display.focus_window || Main.modalCount > 0)
            return;
        const first = SECTIONS.find(s => this._sections[s.key]?.length);
        if (first)
            this._browser?.open(first.key);
    }

    // What the pane opens: a game's command line, or a folder.
    _open(path) {
        openPath(path, () => this._launching());
    }

    // A game is being launched, so whatever was up to pick it goes: left up,
    // the pop-up holds a grab the game's window cannot get past, and the
    // overview covers it. With `play-on-new-workspace`, onto an empty
    // workspace first, so the game's window maps there — a new window opens
    // on the active workspace — and the one it was picked from stays as it
    // was. The workspace is not held: the game's window is what keeps it,
    // and when that closes the shell folds it away as it would any other.
    _launching() {
        this._dialog?.popdown();
        this._browser?.close();
        Main.overview.hide();
        if (!this._settings.get_boolean('play-on-new-workspace'))
            return;
        const workspace = this._emptyWorkspace();
        if (!workspace) {
            console.warn('[Games Menu] No empty workspace to play on (Settings → Multitasking).');
            return;
        }
        workspace.activate(global.get_current_time());
    }

    // An empty workspace, made if need be. Dynamic workspaces always end in
    // one, which is exactly what is wanted; with a fixed number, the first
    // that nothing is using.
    //
    // A workspace held open by `_keepAliveId` is not free however empty it
    // looks: the shell sets it on one being dragged to, and Media Libraries
    // on one it has claimed for a library of its own, drawn on the wallpaper.
    // Only read, never set, here.
    _emptyWorkspace() {
        const wm = global.workspace_manager;
        const free = ws => ws && !ws._keepAliveId &&
            !ws.list_windows().some(w => !w.is_on_all_workspaces());
        if (Meta.prefs_get_dynamic_workspaces()) {
            const last = wm.get_workspace_by_index(wm.n_workspaces - 1);
            return free(last) ? last : wm.append_new_workspace(false, global.get_current_time());
        }
        for (let i = 0; i < wm.n_workspaces; i++) {
            const ws = wm.get_workspace_by_index(i);
            if (free(ws))
                return ws;
        }
        return null;
    }
}
