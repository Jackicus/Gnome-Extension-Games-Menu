import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import {SECTIONS as LIBRARY_SECTIONS, readSections} from './lib/library.js';
import {ACTIONS, NATIVE_KEYS, padLabel} from './lib/actions.js';

// Everything a source is, in one place: what it is called, what it is good
// for, where its key comes from and which fields that key has.
//
// `fields` is what the credential is made of — two for IGDB's Twitch client
// id/secret pair — and its order is the order they are joined by in the
// `credentials` setting. A source with no `fields` needs no key, and still
// gets a row of the same shape with the entry greyed out.
//
// `service` is the folder the key drop is read from (~/Documents/keys/IGDB/),
// shared with other projects; `file` is the file inside it.
const SOURCES = {
    steam: {
        title: 'Steam',
        blurb: 'Free and keyless. Valve\'s own store record and library artwork for installed Steam games.',
        help: 'https://store.steampowered.com/',
        helpHint: 'steampowered.com — no account needed',
    },
    igdb: {
        title: 'IGDB',
        blurb: 'Covers, synopses and ratings for PS2 discs, which have no store record of their own.',
        help: 'https://dev.twitch.tv/console/apps',
        helpHint: 'dev.twitch.tv → Applications → Register (free)',
        service: 'IGDB',
        fields: [
            {title: 'Client ID', file: 'CLIENT ID.txt'},
            {title: 'Client secret', file: 'CLIENT SECRET.txt'},
        ],
    },
};

// The Games page, plus General and Controls.
//
// What the section *is* — its key, its GSettings prefix, its title, its icon
// — is lib/library.js's SECTIONS, imported above, so it is said in one place.
// What is added here is only what the preferences themselves need to say
// about it.
//
// `sources` is what the Add menu offers, not what is used: the ordered list in
// use is <prefix>-sources, and the same source may appear in it more than once
// with a different key.
//
// Games are not a folder of media but two roots — Steam's library and PCSX2's
// config folder, both auto-detected — so they are named in `paths` and get
// one fixed row each.
const PAGES = {
    games: {
        lower: 'games', noun: 'games',
        paths: [
            {
                key: 'steam-path', title: 'Steam library',
                hint: 'Auto-detected — ~/.steam/steam, ~/.local/share/Steam or the flatpak install',
            },
            {
                key: 'pcsx2-path', title: 'PCSX2 configuration',
                hint: 'Auto-detected — ~/.config/PCSX2 or the flatpak install',
            },
        ],
        layout: 'Installed Steam games come from Steam\'s own library files, including libraries on other drives. PS2 games come from the folders PCSX2.ini points at; covers come from its covers folder.',
        online: 'A game\'s source follows its platform rather than this order — Steam apps use Steam, PS2 discs use IGDB. The order decides which IGDB credential is tried first.',
        sources: ['steam', 'igdb'],
    },
};

const SECTIONS = LIBRARY_SECTIONS.map(section => ({...section, ...PAGES[section.key]}));

// Where the system's own shortcuts are kept, for a new one to be checked
// against: the window manager's, the shell's, mutter's and the media keys,
// whose `custom-keybindings` also lists the ones made in GNOME Settings.
const SYSTEM_KEYBINDINGS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];
const MEDIA_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_KEYBINDING = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
// Libadwaita's from 1.8 (GNOME 49); GTK's, deprecated since, before that.
const ShortcutLabel = Adw.ShortcutLabel ?? Gtk.ShortcutLabel;

// What a remote's keys are called. GTK's table predates the keys xkbcommon
// gives a remote's evdev codes (0x10081xxx) and shows those as numbers.
const REMOTE_KEYS = {
    0x10081160: 'OK',
    0x1008ffa0: 'Select',
    0x100810ae: 'Exit',
    0x1008ff18: 'Home',
    0x10081166: 'Info',
    0x10081192: 'Channel Up',
    0x10081193: 'Channel Down',
    0x100811b6: 'Context Menu',
};

// Fields of a multi-field credential are joined by a tab: it cannot occur in
// any of the keys, and it keeps the setting one flat a{ss}.
const FIELD_SEP = '\t';

export default class GamesMenuPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(720, 640);
        window.set_search_enabled(true);

        const state = {
            window,
            settings,
            counts: this._readCounts(),
        };

        window.add(this._generalPage(state));
        window.add(this._controlsPage(state));
        for (const section of SECTIONS)
            window.add(this._sectionPage(state, section));
    }

    // ------------------------------------------------------------------
    // Credentials
    // ------------------------------------------------------------------
    // A slot id ("igdb@1") is one key; a second slot ("igdb@2") is a second
    // key to fall back to.
    _credentials(settings) {
        return settings.get_value('credentials').deep_unpack();
    }

    _credential(settings, slot) {
        return this._credentials(settings)[slot] ?? '';
    }

    _setCredential(settings, slot, value) {
        const all = this._credentials(settings);
        if (value)
            all[slot] = value;
        else
            delete all[slot];
        settings.set_value('credentials', new GLib.Variant('a{ss}', all));
    }

    // One credential split into the fields its source declares, padded so a
    // half-filled pair still has a box for the missing half.
    _fields(settings, slot, count) {
        const parts = this._credential(settings, slot).split(FIELD_SEP);
        return Array.from({length: count}, (_, i) => parts[i] ?? '');
    }

    _setField(settings, slot, index, value, count) {
        const parts = this._fields(settings, slot, count);
        parts[index] = value;
        // All-empty is no credential at all, so the slot goes rather than
        // lingering as a row of tabs.
        this._setCredential(settings, slot, parts.some(Boolean) ? parts.join(FIELD_SEP) : '');
    }

    // A slot is usable when every field its source declares is filled; a
    // source whose slot is not usable is skipped by the scanner.
    _credentialReady(settings, slot, count) {
        return this._fields(settings, slot, count).every(value => value.trim() !== '');
    }

    // Slots no list names any more are keys nobody can reach, so removing the
    // last row that used one removes the key with it.
    _pruneCredentials(settings) {
        const used = new Set();
        for (const section of SECTIONS) {
            for (const entry of settings.get_strv(`${section.prefix}-sources`))
                used.add(entry);
        }
        const all = this._credentials(settings);
        const orphans = Object.keys(all).filter(slot => !used.has(slot));
        if (!orphans.length)
            return;
        for (const slot of orphans)
            delete all[slot];
        settings.set_value('credentials', new GLib.Variant('a{ss}', all));
    }

    // ------------------------------------------------------------------
    // General
    // ------------------------------------------------------------------
    _generalPage(state) {
        const {settings} = state;
        const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});

        // One way of browsing, and one way of opening what is picked, each
        // chosen on its own.
        const view = new Adw.PreferencesGroup({title: 'View'});
        page.add(view);

        // One vocabulary, offered twice: the same two places for the library
        // and for a picked game, each read without reference to the other.
        const PLACES = [
            ['menu', 'Menu'],
            ['modal', 'Modal'],
        ];
        const toggles = () => {
            // `can_shrink` off so a label is never ellipsized to fit the row; the
            // two titles are kept short and parallel so both groups sit the same.
            const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER, homogeneous: true, can_shrink: false});
            for (const [name, label] of PLACES)
                group.add(new Adw.Toggle({name, label}));
            return group;
        };
        const modes = toggles();
        const viewRow = new Adw.ActionRow({title: 'Library opens in'});
        viewRow.add_suffix(modes);
        view.add(viewRow);

        const details = toggles();
        const detailRow = new Adw.ActionRow({title: 'Games open in'});
        detailRow.add_suffix(details);
        view.add(detailRow);

        const playRow = new Adw.SwitchRow({
            title: 'Play on a new workspace',
            subtitle: 'The game opens on an empty workspace of its own, leaving the one you picked it from as it was',
        });
        settings.bind('play-on-new-workspace', playRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        view.add(playRow);

        page.add(this._shortcutsGroup(state));

        const appearance = new Adw.PreferencesGroup({title: 'Appearance'});
        page.add(appearance);

        // A slider with a tick at the schema's own default, read from the
        // schema rather than repeated here, so dragging back to the line is
        // dragging back to the default.
        const slider = (key, min, max) => {
            const scale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: 1}),
                digits: 0,
                draw_value: true,
                value_pos: Gtk.PositionType.RIGHT,
                hexpand: true,
                width_request: 220,
                valign: Gtk.Align.CENTER,
            });
            scale.add_mark(settings.get_default_value(key).deep_unpack(), Gtk.PositionType.BOTTOM, null);
            scale.set_value(settings.get_int(key));
            scale.connect('value-changed', () => settings.set_int(key, Math.round(scale.get_value())));
            settings.connect(`changed::${key}`, () => {
                if (Math.round(scale.get_value()) !== settings.get_int(key))
                    scale.set_value(settings.get_int(key));
            });
            return scale;
        };

        const rowsRow = new Adw.ActionRow({
            title: 'Rows',
            subtitle: 'Covers down a page. Fewer means larger covers.',
        });
        rowsRow.add_suffix(slider('rows', 1, 3));
        appearance.add(rowsRow);

        const columnsRow = new Adw.ActionRow({
            title: 'Columns',
            subtitle: 'Covers across a page. Fewer means larger covers. A small space — the grid in the overview, a small screen — fits fewer of either.',
        });
        columnsRow.add_suffix(slider('columns', 4, 10));
        appearance.add(columnsRow);

        // Where a row that is not full sits: centred under the full ones, as
        // the app grid does, or against the leading edge.
        const align = new Adw.ToggleGroup({valign: Gtk.Align.CENTER, homogeneous: true, can_shrink: false});
        align.add(new Adw.Toggle({name: 'center', label: 'Centre'}));
        align.add(new Adw.Toggle({name: 'start', label: 'Left'}));
        align.set_active_name(settings.get_string('grid-align'));
        align.connect('notify::active-name', () => settings.set_string('grid-align', align.get_active_name()));
        settings.connect('changed::grid-align', () => {
            if (align.get_active_name() !== settings.get_string('grid-align'))
                align.set_active_name(settings.get_string('grid-align'));
        });
        const alignRow = new Adw.ActionRow({
            title: 'Align covers',
            subtitle: 'Where a row that is not full sits',
        });
        alignRow.add_suffix(align);
        appearance.add(alignRow);

        const radiusRow = new Adw.ActionRow({
            title: 'Corner radius',
            subtitle: 'How rounded covers, tiles and the pop-up are, in pixels. 0 is square.',
        });
        radiusRow.add_suffix(slider('corner-radius', 0, 40));
        appearance.add(radiusRow);

        const detailSizeRow = new Adw.ActionRow({
            title: 'Pop-up size',
            subtitle: 'How much of the available room a picked game\'s pop-up fills, as a percentage',
        });
        detailSizeRow.add_suffix(slider('detail-size', 80, 120));
        appearance.add(detailSizeRow);

        const VIEWS = {
            menu: 'A grid of your games in the overview, beside your applications, opened from the button next to Show Apps.',
            modal: 'A panel over the desktop, opened from the same button next to Show Apps. Escape, a click away, or the button again closes it.',
        };
        const DETAILS = {
            menu: 'What you pick pops up where you picked it, the way an app folder opens.',
            modal: 'What you pick opens in a panel over the desktop and stays up until Escape or a click away closes it.',
        };
        const syncView = () => {
            const mode = settings.get_string('library-opens-in');
            const detail = settings.get_string('detail-opens-in');
            if (modes.active_name !== mode)
                modes.active_name = mode;
            if (details.active_name !== detail)
                details.active_name = detail;
            // Under the heading, not in the rows, where it would squeeze the toggles.
            view.description = `${VIEWS[mode] ?? ''} ${DETAILS[detail] ?? ''}`.trim();
        };
        for (const [group, key] of [[modes, 'library-opens-in'], [details, 'detail-opens-in']]) {
            group.connect('notify::active-name', () => {
                if (group.active_name && group.active_name !== settings.get_string(key))
                    settings.set_string(key, group.active_name);
            });
            settings.connect(`changed::${key}`, syncView);
        }
        syncView();

        const accent = new Adw.ActionRow({
            title: 'Accent colour',
            subtitle: 'Follows Settings → Appearance → Accent Color',
            activatable: true,
        });
        accent.add_suffix(new Gtk.Image({icon_name: 'external-link-symbolic'}));
        accent.connect('activated', () => {
            try {
                Gio.Subprocess.new(['gnome-control-center', 'background'], Gio.SubprocessFlags.NONE);
            } catch (e) {
                console.warn(`[Games Menu] Could not open Settings: ${e.message}`);
            }
        });
        appearance.add(accent);

        return page;
    }

    // ------------------------------------------------------------------
    // Shortcuts
    // ------------------------------------------------------------------
    // A row per section — the one, Games — set by pressing the shortcut, as
    // GNOME Settings sets its own. The extension grabs whatever
    // `<prefix>-shortcut` holds (lib/app.js) and follows it as it changes, so
    // nothing is registered here — writing the setting is the whole of it.
    _shortcutsGroup(state) {
        const {settings} = state;
        const group = new Adw.PreferencesGroup({
            title: 'Keyboard Shortcut',
            description: 'Opens the library from anywhere, wherever it opens; the same shortcut again closes it. None is set to begin with.',
        });
        for (const section of SECTIONS) {
            const key = `${section.prefix}-shortcut`;
            const row = new Adw.ActionRow({title: `Open ${section.title}`, activatable: true});
            const label = new ShortcutLabel({disabled_text: 'Disabled', valign: Gtk.Align.CENTER});
            const clear = new Gtk.Button({
                icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove this shortcut', css_classes: ['flat'],
            });
            clear.connect('clicked', () => settings.set_strv(key, []));
            row.add_suffix(label);
            row.add_suffix(clear);
            const sync = () => {
                const accel = settings.get_strv(key)[0] ?? '';
                label.accelerator = accel;
                clear.visible = accel !== '';
            };
            settings.connect(`changed::${key}`, sync);
            sync();
            row.connect('activated', () => this._captureShortcut(state, section));
            group.add(row);
        }
        return group;
    }

    // The shortcut: GNOME Settings' own rules (cc-keyboard-shortcut-editor.c)
    // — Escape cancels, Backspace removes it, and a key with no modifier is
    // only taken when it types nothing, a function key or a media key. What
    // the system already answers to is refused, not taken over: this is the
    // extension's setting, not the system's.
    _captureShortcut(state, section) {
        const {settings} = state;
        const key = `${section.prefix}-shortcut`;
        this._keyDialog(state, {
            title: `Open ${section.title}`,
            description: 'Press the new shortcut. Esc cancels, Backspace removes it.',
            onKey: (keyval, mods) => {
                if (!mods && keyval === Gdk.KEY_Escape)
                    return true;
                if (!mods && keyval === Gdk.KEY_BackSpace) {
                    settings.set_strv(key, []);
                    return true;
                }
                const shown = keyLabel(keyval, mods);
                const typing = !(mods & ~Gdk.ModifierType.SHIFT_MASK) &&
                    !(keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35) && keyval < 0x1008ff00;
                if (typing)
                    return `${shown} types a character. Add Ctrl, Alt or Super to it, or use a function or media key.`;
                const accel = Gtk.accelerator_name(keyval, mods);
                const clash = shortcutClash(settings, accel, key);
                if (clash)
                    return `${shown} is already taken — ${clash}. Try another, or Esc to cancel.`;
                settings.set_strv(key, [accel]);
                return true;
            },
        });
    }

    // The dialog GNOME Settings listens for a key in. `onKey` is handed each
    // key pressed, lowered the way Settings lowers it (Shift kept only where
    // it changed the key), and answers true to close, or a line saying why
    // the key will not do. A modifier on its own is waited past; so, for a
    // shortcut, is a bare arrow, Tab, Home, End or Page key, which GTK holds
    // to be navigation — `anyKey` takes those too, since they are exactly
    // what a remote or a Pico may send.
    _keyDialog(state, {heading = 'Set Shortcut', title, description, onKey, anyKey = false}) {
        const {window} = state;
        const status = new Adw.StatusPage({
            icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            title,
            description,
        });
        const toolbar = new Adw.ToolbarView({content: status});
        toolbar.add_top_bar(new Adw.HeaderBar());
        const dialog = new Adw.Dialog({title: heading, content_width: 440, child: toolbar});

        const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        keys.connect('key-pressed', (_controller, keyval, _keycode, modifiers) => {
            let mods = modifiers & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;
            let lower = Gdk.keyval_to_lower(keyval);
            if (lower === Gdk.KEY_ISO_Left_Tab)
                lower = Gdk.KEY_Tab;
            if (lower !== keyval)
                mods |= Gdk.ModifierType.SHIFT_MASK;
            if (!Gtk.accelerator_valid(lower, anyKey ? mods | Gdk.ModifierType.CONTROL_MASK : mods))
                return Gdk.EVENT_STOP;
            const answer = onKey(lower, mods);
            if (answer === true)
                dialog.close();
            else if (answer)
                status.description = answer;
            return Gdk.EVENT_STOP;
        });
        // On the dialog, not the window: a dialog's keys never pass through
        // the window's capture phase.
        dialog.add_controller(keys);

        // As GNOME Settings does while it listens: a key the system has taken
        // reaches the dialog instead of doing what it does, so it can be said
        // to be taken. The shell asks once whether this app may; refused, a
        // taken key goes on doing its own thing and only the rest are heard.
        const surface = window.get_surface();
        surface?.inhibit_system_shortcuts?.(null);
        dialog.connect('closed', () => surface?.restore_system_shortcuts?.());
        dialog.present(window);
        return dialog;
    }

    // ------------------------------------------------------------------
    // Controls
    // ------------------------------------------------------------------
    // What a remote, a controller or keys of the user's own do in the library
    // (lib/controls.js). Every action is two lists, `keys-<action>` and
    // `pad-<action>`; a row shows one, adds to it by pressing the thing to
    // add, and empties it.
    _controlsPage(state) {
        const {settings} = state;
        const page = new Adw.PreferencesPage({title: 'Controls', icon_name: 'input-gaming-symbolic'});

        const keys = new Adw.PreferencesGroup({
            title: 'Remote and Keyboard',
            description: 'The arrow keys, Enter and Escape always work. Add the keys a remote, a Pico or anything else that acts as a keyboard sends: they do these things while the library is on screen, and what they always did everywhere else.',
        });
        page.add(keys);
        const pairs = action => settings.get_value(`keys-${action.key}`).deep_unpack();
        for (const action of ACTIONS) {
            keys.add(this._bindingRow(settings, action, {
                key: `keys-${action.key}`,
                labels: () => pairs(action).map(([keyval, mods]) => keyLabel(keyval, mods)),
                add: () => this._captureNavKey(state, action),
                addTip: 'Add a key',
            }));
        }
        keys.add(this._resetRow(settings, ACTIONS.map(a => `keys-${a.key}`)));

        const pads = new Adw.PreferencesGroup({
            title: 'Game Controller',
            description: 'Read only while the library is on screen, so games are left alone — except Home, which also opens the library when no window has the keyboard. Xbox, PlayStation and most other pads are ready as they are; anything else, a Pico running as a gamepad included, is set up by pressing its buttons here.',
        });
        page.add(pads);
        const use = new Adw.SwitchRow({title: 'Use game controllers'});
        settings.bind('gamepad-enabled', use, 'active', Gio.SettingsBindFlags.DEFAULT);
        pads.add(use);
        const connected = new Adw.ActionRow({title: 'Connected', subtitle: 'Looking…'});
        pads.add(connected);
        const padRows = [connected];
        for (const action of ACTIONS) {
            padRows.push(this._bindingRow(settings, action, {
                key: `pad-${action.key}`,
                // A mapped pad's D-pad is four buttons, an unmapped one's a
                // hat, and both are bound, under the one name.
                labels: () => [...new Set(settings.get_strv(`pad-${action.key}`).map(padLabel))],
                subtitle: action.subtitle ?? null,
                add: () => this._capturePad(state, action),
                addTip: 'Add a button',
            }));
        }
        padRows.push(this._resetRow(settings, ACTIONS.map(a => `pad-${a.key}`)));
        for (const row of padRows) {
            settings.bind('gamepad-enabled', row, 'sensitive', Gio.SettingsBindFlags.GET);
            if (row !== connected)
                pads.add(row);
        }
        this._watchPads(state, connected);

        return page;
    }

    // One action's list: what is in it, a button to add to it, and one to
    // empty it. Rebuilt from the setting on every change.
    _bindingRow(settings, action, {key, labels, add, addTip, subtitle = action.subtitle ?? 'Besides the arrow key'}) {
        const row = new Adw.ActionRow({title: action.title});
        if (subtitle)
            row.subtitle = subtitle;
        const shown = new Gtk.Label({
            css_classes: ['dim-label'],
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 22,
            valign: Gtk.Align.CENTER,
        });
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: addTip, css_classes: ['flat'],
        });
        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Remove them all', css_classes: ['flat'],
        });
        addButton.connect('clicked', add);
        clear.connect('clicked', () => settings.set_value(key,
            new GLib.Variant(settings.get_value(key).get_type_string(), [])));
        row.add_suffix(shown);
        row.add_suffix(addButton);
        row.add_suffix(clear);
        row.activatable_widget = addButton;
        const sync = () => {
            const names = labels();
            shown.label = names.length ? names.join(', ') : 'None';
            shown.tooltip_text = names.join(', ');
            clear.sensitive = names.length > 0;
        };
        settings.connect(`changed::${key}`, sync);
        sync();
        return row;
    }

    _resetRow(settings, keys) {
        const row = new Adw.ActionRow({title: 'Put back the defaults'});
        const button = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        button.connect('clicked', () => keys.forEach(key => settings.reset(key)));
        row.add_suffix(button);
        return row;
    }

    // A key for `action`, pressed. It is added to the others, not in place of
    // them; one the library already knows, one another action has, and one
    // the system takes before the library can see it are refused.
    _captureNavKey(state, action) {
        const {settings} = state;
        const key = `keys-${action.key}`;
        const matches = (keyval, mods) => ([k, m]) => k === keyval && m === mods;
        this._keyDialog(state, {
            heading: 'Add a Key',
            title: action.title,
            description: 'Press the key on the remote or keyboard. Esc cancels.',
            anyKey: true,
            onKey: (keyval, mods) => {
                if (!mods && keyval === Gdk.KEY_Escape)
                    return true;
                const shown = keyLabel(keyval, mods);
                if (!mods && NATIVE_KEYS.some(name => Gdk[`KEY_${name}`] === keyval))
                    return `${shown} already works in the library. Press another key, or Esc to cancel.`;
                const bound = settings.get_value(key).deep_unpack();
                if (bound.some(matches(keyval, mods)))
                    return true;
                const owner = ACTIONS.find(other => other !== action &&
                    settings.get_value(`keys-${other.key}`).deep_unpack().some(matches(keyval, mods)));
                if (owner)
                    return `${shown} is already ${owner.title}. Press another key, or Esc to cancel.`;
                const clash = shortcutClash(settings, Gtk.accelerator_name(keyval, mods), null);
                if (clash)
                    return `${shown} is taken by the system — ${clash} — and would never reach the library.`;
                settings.set_value(key, new GLib.Variant('a(uu)', [...bound, [keyval, mods]]));
                return true;
            },
        });
    }

    // A controller input for `action`: the first button pressed, or stick
    // or D-pad pushed, on any controller. A stick is only taken once it has
    // been seen at rest, so one that was already over (a trigger resting at
    // one end) is not mistaken for the press.
    async _capturePad(state, action) {
        const {settings, window} = state;
        const key = `pad-${action.key}`;
        const status = new Adw.StatusPage({
            icon_name: 'input-gaming-symbolic',
            title: action.title,
            description: 'Press the button, or push the stick or D-pad, on the controller. Esc cancels.',
        });
        const toolbar = new Adw.ToolbarView({content: status});
        toolbar.add_top_bar(new Adw.HeaderBar());
        const dialog = new Adw.Dialog({title: 'Set Controller Input', content_width: 440, child: toolbar});
        dialog.present(window);

        const Manette = await loadManette();
        if (!Manette) {
            status.description = 'libmanette is not installed, so controllers cannot be read.';
            return;
        }
        const monitor = new Manette.Monitor();
        const handlers = [];
        const listen = (object, signal, handler) => handlers.push([object, object.connect(signal, handler)]);
        const rest = new Map();
        const take = input => {
            const bound = settings.get_strv(key);
            if (bound.includes(input)) {
                dialog.close();
                return;
            }
            const owner = ACTIONS.find(other => other !== action &&
                settings.get_strv(`pad-${other.key}`).includes(input));
            if (owner) {
                status.description = `${padLabel(input)} is already ${owner.title}. Press another, or Esc to cancel.`;
                return;
            }
            settings.set_strv(key, [...bound, input]);
            dialog.close();
        };
        const axis = (device, code, value, hat) => {
            const id = `${device.get_guid()}/${code}`;
            const was = rest.get(id) ?? (hat ? 0 : undefined);
            rest.set(id, Math.abs(value));
            if (Math.abs(value) >= 0.7 && was !== undefined && was < 0.3)
                take(`axis:${code}${value < 0 ? '-' : '+'}`);
        };
        const watch = device => {
            listen(device, 'button-press-event', (_d, event) => {
                const [ok, button] = event.get_button();
                take(`button:${ok ? button : event.get_hardware_code()}`);
            });
            listen(device, 'absolute-axis-event', (_d, event) => {
                const [ok, code, value] = event.get_absolute();
                if (ok)
                    axis(device, code, value, false);
            });
            listen(device, 'hat-axis-event', (_d, event) => {
                const [ok, code, value] = event.get_hat();
                if (ok)
                    axis(device, code, value, true);
            });
        };
        listen(monitor, 'device-connected', (_m, device) => watch(device));
        const devices = monitor.iterate();
        let device, count = 0;
        while (([, device] = devices.next()) && device) {
            watch(device);
            count++;
        }
        if (!count)
            status.description = 'No controller is connected. Connect one and press a button on it, or Esc to cancel.';
        dialog.connect('closed', () => {
            for (const [object, id] of handlers)
                object.disconnect(id);
            handlers.length = 0;
        });
    }

    // Which controllers libmanette can see, kept up to date while the window
    // is open — the quickest way to tell a pad that is not being read from a
    // binding that is wrong.
    async _watchPads(state, row) {
        const Manette = await loadManette();
        if (!Manette) {
            row.subtitle = 'libmanette is not installed, so controllers cannot be read.';
            return;
        }
        const monitor = state.padMonitor = new Manette.Monitor();
        const names = new Map();
        const sync = () => {
            row.subtitle = names.size ? [...names.values()].join(', ') : 'None';
        };
        const add = device => {
            names.set(device, device.get_name());
            device.connect('disconnected', () => {
                names.delete(device);
                sync();
            });
            sync();
        };
        monitor.connect('device-connected', (_m, device) => add(device));
        const devices = monitor.iterate();
        let device;
        while (([, device] = devices.next()) && device)
            add(device);
        sync();
    }

    // ------------------------------------------------------------------
    // The Games page
    // ------------------------------------------------------------------
    _sectionPage(state, section) {
        const page = new Adw.PreferencesPage({title: section.title, icon_name: section.icon});

        const files = new Adw.PreferencesGroup({title: 'Files', description: section.layout});
        page.add(files);
        for (const spec of section.paths)
            files.add(this._folderRow(state, section, spec));

        page.add(this._sourcesGroup(state, section));

        const library = new Adw.PreferencesGroup({title: 'Library'});
        page.add(library);

        const status = new Adw.ActionRow({
            title: 'Indexed',
            subtitle: this._countText(state.counts, section),
        });
        const button = this._scanButton(state, () => {
            status.set_subtitle(this._countText(state.counts, section));
        });
        status.add_suffix(button);
        library.add(status);

        return page;
    }

    // ------------------------------------------------------------------
    // Sources
    // ------------------------------------------------------------------
    // The ordered list of where the games' artwork and facts come from, and
    // the keys that go with them. Everything in it lives in two settings —
    // <prefix>-sources for the order and `credentials` for the keys — so the
    // rows are torn down and rebuilt from those rather than kept in step by
    // hand.
    _sourcesGroup(state, section) {
        const {settings} = state;
        const key = `${section.prefix}-sources`;
        const offered = section.sources;

        const group = new Adw.PreferencesGroup({
            title: 'Information sources',
            description: section.online,
        });

        const online = new Adw.SwitchRow({
            title: 'Fetch artwork and descriptions online',
            subtitle: 'Off leaves the library with whatever is already cached.',
        });
        settings.bind(`${section.prefix}-online`, online, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(online);

        // The Add menu. An action group rather than a callback per item so the
        // menu is a plain Gio.Menu and the popover comes from GTK.
        const actions = new Gio.SimpleActionGroup();
        const add = new Gio.SimpleAction({name: 'add', parameter_type: new GLib.VariantType('s')});
        add.connect('activate', (_action, param) => this._addSource(state, section, param.unpack()));
        actions.add_action(add);
        group.insert_action_group('sources', actions);

        const menu = new Gio.Menu();
        for (const id of offered)
            menu.append(SOURCES[id].title, `sources.add('${id}')`);
        group.set_header_suffix(new Gtk.MenuButton({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Add a source',
            css_classes: ['flat'],
            menu_model: menu,
        }));

        const rows = [];
        const syncers = [];
        const rebuild = () => {
            for (const row of rows.splice(0))
                group.remove(row);
            syncers.length = 0;
            const list = settings.get_strv(key);
            if (!list.length) {
                const empty = new Adw.ActionRow({
                    title: 'No sources',
                    subtitle: `Nothing is looked up for ${section.lower}. Add one above.`,
                    sensitive: false,
                });
                group.add(empty);
                rows.push(empty);
                return;
            }
            list.forEach((entry, index) => {
                const built = this._sourceRow(state, section, entry, index, list);
                group.add(built.row);
                rows.push(built.row);
                if (built.sync)
                    syncers.push(built.sync);
            });
        };

        settings.connect(`changed::${key}`, rebuild);
        // A key imported or cleared elsewhere is refreshed rather than
        // rebuilt, so an entry being typed into is not pulled out from under
        // the cursor.
        settings.connect('changed::credentials', () => syncers.forEach(sync => sync()));
        rebuild();
        return group;
    }

    // One source: its name, what state its key is in, and — expanded — the key
    // itself. The shape is the same whether or not it takes one; a source that
    // needs no key shows the entry greyed out rather than hiding it, so the
    // rows line up and nothing looks missing.
    _sourceRow(state, section, entry, index, list) {
        const {settings} = state;
        const id = sourceId(entry);
        const spec = SOURCES[id];
        const slot = entry.includes('@') ? entry : null;
        const fields = spec?.fields ?? [];

        const row = new Adw.ExpanderRow({
            title: spec?.title ?? id,
            tooltip_text: spec?.blurb ?? '',
        });

        const sync = () => {
            if (!spec)
                row.set_subtitle('Unknown source — remove it or fix the setting');
            else if (!slot || !fields.length)
                row.set_subtitle('No key needed');
            else {
                const which = `Key ${entry.split('@')[1]}`;
                row.set_subtitle(this._credentialReady(settings, slot, fields.length)
                    ? `${which} is set`
                    : `${which} is not set — skipped`);
            }
        };
        sync();

        const move = (to) => {
            const next = [...list];
            next.splice(to, 0, ...next.splice(index, 1));
            settings.set_strv(`${section.prefix}-sources`, next);
        };
        const remove = new Gtk.Button({
            icon_name: 'list-remove-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Remove this source', css_classes: ['flat'],
        });
        remove.connect('clicked', () => {
            settings.set_strv(`${section.prefix}-sources`, list.filter((_, i) => i !== index));
            this._pruneCredentials(settings);
        });

        const down = new Gtk.Button({
            icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Try this one later', css_classes: ['flat'],
            sensitive: index < list.length - 1,
        });
        down.connect('clicked', () => move(index + 1));

        const up = new Gtk.Button({
            icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Try this one sooner', css_classes: ['flat'],
            sensitive: index > 0,
        });
        up.connect('clicked', () => move(index - 1));

        let help = null;
        if (spec?.help) {
            help = new Gtk.Button({
                icon_name: 'help-about-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: fields.length
                    ? `Get a ${spec.title} key — ${spec.helpHint}`
                    : `About ${spec.title} — ${spec.helpHint}`,
                css_classes: ['flat'],
            });
            help.connect('clicked', () => Gtk.show_uri(state.window, spec.help, Gdk.CURRENT_TIME));
        }

        // An expander row packs each suffix ahead of the last, so they go on
        // back to front to read help, sooner, later, remove from the left.
        for (const button of [remove, down, up, help]) {
            if (button)
                row.add_suffix(button);
        }

        if (!fields.length) {
            row.add_row(new Adw.PasswordEntryRow({
                title: spec ? `${spec.title} needs no key` : 'No key',
                sensitive: false,
            }));
            return {row, sync};
        }

        const entries = fields.map((field, i) => {
            const value = new Adw.PasswordEntryRow({
                title: field.title,
                text: this._fields(settings, slot, fields.length)[i],
                show_apply_button: true,
            });
            value.connect('apply', () => {
                this._setField(settings, slot, i, value.get_text().trim(), fields.length);
                sync();
            });

            const dropFile = this._keyDropFile(spec.service, field.file);
            if (dropFile) {
                const importBtn = new Gtk.Button({
                    label: 'Import',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: `Read it from ${dropFile}`,
                    css_classes: ['flat'],
                });
                importBtn.connect('clicked', () => {
                    const imported = this._readKeyDrop(dropFile);
                    if (!imported)
                        return;
                    value.set_text(imported);
                    this._setField(settings, slot, i, imported, fields.length);
                    sync();
                });
                value.add_suffix(importBtn);
            }
            row.add_row(value);
            return value;
        });

        return {
            row,
            sync: () => {
                const current = this._fields(settings, slot, fields.length);
                entries.forEach((value, i) => {
                    // Never over an entry being typed into: the edit in front
                    // of the user beats the one that landed from elsewhere.
                    if (!value.has_focus && value.get_text() !== current[i])
                        value.set_text(current[i]);
                });
                sync();
            },
        };
    }

    // Adding a source that takes a key picks the lowest slot not already in
    // the list, so a second IGDB row is a second key to fall back to.
    _addSource(state, section, id) {
        const {settings} = state;
        const key = `${section.prefix}-sources`;
        const list = settings.get_strv(key);
        const spec = SOURCES[id];

        let entry = id;
        if (spec?.fields?.length) {
            let n = 1;
            while (list.includes(`${id}@${n}`))
                n++;
            entry = `${id}@${n}`;
        } else if (list.includes(id)) {
            return;   // a keyless source twice would only ask the same server twice
        }
        settings.set_strv(key, [...list, entry]);
    }

    // The value in the key drop, or '' if it cannot be read. Never logged.
    _readKeyDrop(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            return ok ? new TextDecoder().decode(bytes).trim() : '';
        } catch (e) {
            console.warn(`[Games Menu] Could not read ${path}: ${e.message}`);
            return '';
        }
    }

    _keyDropFile(service, field) {
        if (!service || !field)
            return null;
        const docs = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) ?? GLib.get_home_dir();
        const path = GLib.build_filenamev([docs, 'keys', service, field]);
        return GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? path : null;
    }

    // ------------------------------------------------------------------
    // Folders
    // ------------------------------------------------------------------
    // Find out whether `path` is there and mark the row if not. The answer is
    // never waited for: a folder on a share or an automount that has idled
    // out takes as long to stat as the share takes to come back, and asked
    // synchronously that is how long the window takes to open. `stillCurrent`
    // says whether the row is still about this path when the answer lands.
    _checkFolder(row, path, stillCurrent) {
        const text = row.get_subtitle();
        Gio.File.new_for_path(path).query_info_async(
            'standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null,
            (file, result) => {
                let found = false;
                try {
                    found = file.query_info_finish(result).get_file_type() === Gio.FileType.DIRECTORY;
                } catch (e) {
                    // Missing or unreachable: the row says the same either way.
                }
                if (!found && stillCurrent())
                    row.set_subtitle(`${text}  — not found`);
            });
    }

    _pickFolder(window, title, initial, onChosen) {
        const dialog = new Gtk.FileDialog({
            title,
            modal: true,
            initial_folder: Gio.File.new_for_path(initial ?? GLib.get_home_dir()),
        });
        dialog.select_folder(window, null, (source, result) => {
            try {
                const file = source.select_folder_finish(result);
                if (file)
                    onChosen(file.get_path());
            } catch (e) {
                // Cancelled.
            }
        });
    }

    // One fixed root row: what it is set to, a chooser and a button back to
    // auto-detection.
    _folderRow(state, section, spec) {
        const {settings} = state;
        const row = new Adw.ActionRow({title: spec.title, activatable: true});
        this._showFolder(row, settings, spec);
        const pick = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Choose folder',
            css_classes: ['flat'],
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Back to auto-detection',
            css_classes: ['flat'],
            visible: settings.get_string(spec.key) !== '',
        });
        row.add_suffix(reset);
        row.add_suffix(pick);

        const choose = () => this._pickFolder(
            state.window, `Choose ${section.title} ${spec.title.toLowerCase()}`,
            settings.get_string(spec.key) || null, path => {
                settings.set_string(spec.key, path);
                this._showFolder(row, settings, spec);
                reset.visible = true;
            });
        pick.connect('clicked', choose);
        row.connect('activated', choose);
        reset.connect('clicked', () => {
            settings.set_string(spec.key, '');
            this._showFolder(row, settings, spec);
            reset.visible = false;
        });
        return row;
    }

    // A root row: the setting, or the auto-detection hint when unset.
    _showFolder(row, settings, spec) {
        const path = settings.get_string(spec.key);
        row.set_subtitle(path || spec.hint);
        if (path)
            this._checkFolder(row, path, () => settings.get_string(spec.key) === path);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------
    // How many games the last scan found, read the same way the extension
    // reads it.
    _readCounts() {
        const {sections, generated} = readSections();
        const counts = {generated};
        for (const s of SECTIONS)
            counts[s.key] = Array.isArray(sections[s.key]) ? sections[s.key].length : null;
        return counts;
    }

    // "105 games · last scanned 25 Sep 14:02".
    _countText(counts, section) {
        const n = counts[section.key];
        if (n === null || n === undefined || !counts.generated)
            return 'Not scanned yet';
        const when = GLib.DateTime.new_from_unix_local(Math.floor(counts.generated));
        return `${n} ${section.noun} · last scanned ${when.format('%-d %b %H:%M')}`;
    }

    // A button that runs backend/scan_library.py, then re-reads the count.
    // The extension picks the new library up on its own.
    //
    // The scanner reads the roots, sources, credentials and the online
    // switch out of GSettings itself, so nothing here has to turn a setting
    // into a flag or hand it a key. Steam and PCSX2 are auto-detected, so
    // there is always somewhere to look.
    _scanButton(state, onDone) {
        const content = new Adw.ButtonContent({label: 'Rescan', icon_name: 'view-refresh-symbolic'});
        const button = new Gtk.Button({child: content, valign: Gtk.Align.CENTER, css_classes: ['flat']});

        button.connect('clicked', () => {
            const argv = [
                'python3',
                GLib.build_filenamev([this.path, 'backend', 'scan_library.py']),
                '--from-settings',
            ];

            button.set_sensitive(false);
            content.set_label('Scanning…');
            content.set_icon_name('content-loading-symbolic');
            try {
                const proc = Gio.Subprocess.new(
                    argv, Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (p, result) => {
                    let failed = false;
                    try {
                        const [, , stderr] = p.communicate_utf8_finish(result);
                        failed = !p.get_successful();
                        if (failed)
                            console.error(`[Games Menu] Scan failed: ${stderr}`);
                    } catch (e) {
                        failed = true;
                        console.error(`[Games Menu] Scan failed: ${e.message}`);
                    }
                    button.set_sensitive(true);
                    content.set_icon_name(failed ? 'dialog-warning-symbolic' : 'view-refresh-symbolic');
                    content.set_label(failed ? 'Failed — see logs' : 'Rescan');
                    state.counts = this._readCounts();
                    onDone();
                });
            } catch (e) {
                console.error(`[Games Menu] Could not launch scanner: ${e.message}`);
                button.set_sensitive(true);
                content.set_icon_name('dialog-warning-symbolic');
                content.set_label('Failed');
            }
        });
        return button;
    }
}

// What already answers to `accel`, by the name its setting gives it, or null:
// one of our own remote bindings, the system's own shortcuts, and the custom
// ones made in GNOME Settings. Accelerators are compared as GTK parses them,
// so "<Primary>" and "<Control>" are one modifier. `ownKey` is the shortcut
// being set, which is not a clash with itself.
function shortcutClash(settings, accel, ownKey) {
    const normal = text => {
        const [ok, keyval, mods] = Gtk.accelerator_parse(text);
        return ok && keyval ? Gtk.accelerator_name(Gdk.keyval_to_lower(keyval), mods) : null;
    };
    const wanted = normal(accel);
    const source = Gio.SettingsSchemaSource.get_default();

    for (const section of SECTIONS) {
        const key = `${section.prefix}-shortcut`;
        if (key !== ownKey && settings.get_strv(key).some(a => normal(a) === wanted))
            return `Open ${section.title}`;
    }
    // A shortcut is grabbed everywhere, so it would swallow a remote's key
    // before the library ever saw it.
    for (const action of ACTIONS) {
        const pairs = settings.get_value(`keys-${action.key}`).deep_unpack();
        if (pairs.some(([keyval, mods]) => normal(Gtk.accelerator_name(keyval, mods)) === wanted))
            return `${action.title}, on the Controls page`;
    }
    for (const id of SYSTEM_KEYBINDINGS) {
        const schema = source.lookup(id, true);
        if (!schema)
            continue;
        const system = new Gio.Settings({settings_schema: schema});
        for (const name of schema.list_keys()) {
            const key = schema.get_key(name);
            if (key.get_value_type().dup_string() !== 'as')
                continue;
            if (system.get_strv(name).some(a => normal(a) === wanted))
                return key.get_summary() || name;
        }
    }
    const custom = source.lookup(CUSTOM_KEYBINDING, true);
    if (custom && source.lookup(MEDIA_KEYS, true)) {
        for (const path of new Gio.Settings({schema_id: MEDIA_KEYS}).get_strv('custom-keybindings')) {
            const entry = new Gio.Settings({settings_schema: custom, path});
            if (normal(entry.get_string('binding')) === wanted)
                return entry.get_string('name') || 'a custom shortcut';
        }
    }
    return null;
}

// A key as the preferences show it: GTK's name for it, or ours for a remote's
// keys, which GTK shows as numbers.
function keyLabel(keyval, mods) {
    const named = REMOTE_KEYS[keyval];
    if (!named)
        return Gtk.accelerator_get_label(keyval, mods);
    // The modifiers' half of the label, off a key GTK does know.
    return mods ? Gtk.accelerator_get_label(Gdk.KEY_a, mods).slice(0, -1) + named : named;
}

// libmanette, if it is installed; loaded once, when first wanted.
let manette = null;
function loadManette() {
    manette ??= import('gi://Manette').then(module => module.default, () => null);
    return manette;
}

// "igdb@2" names the second IGDB key; "steam" names a source that has none.
function sourceId(entry) {
    return entry.split('@')[0];
}
