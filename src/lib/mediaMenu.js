// A second application menu, of games. The "menu" library.
//
// The view is the library grid from mediaGrid.js — the shell's own app grid
// with posters in it — put inside the app grid's slot, a child of the
// AppDisplay shown in place of the grid's own box, so the overview allocates
// it, slides it up and hides it for search exactly as it does the apps.
//
// The library gets a button beside Show Apps (sectionButtons.js), in the dash
// or in Dash to Panel's panel. It is the only way in: it opens the overview
// straight onto the games, and pressed again it closes what it opened. That
// is the rule the docks' Show Apps follows (Dash to Panel and Dash to Dock
// both keep a `forcedOverview` flag): a button pressed on the desktop opened
// the overview itself, so a second press — or Escape — takes the overview
// down and lands back on the desktop; pressed with the overview already up,
// it only goes back to the window picker, as the shell's own Show Apps does.
// And whatever way out of such an overview is taken goes all the way down:
// Show Apps unchecked with the view up closes it (a dock only keeps its own
// `forcedOverview`, so left standing it would settle on the window picker, and
// every Show Apps press after that came back there rather than to the
// desktop). Show Apps itself is left alone: it leaves the grid as it always
// has, and what the grid shows when it is next opened is the apps, because a
// view only lives as long as the grid is up.
//
// Another extension may do all of this too, in the same slot of the same
// overview. Only one view can be in it at a time — each hides the grid's own
// box to show its own — so the button pressed with the other extension's view
// up closes the overview and opens it again onto the games (`open`): two of
// the shell's own transitions, rather than one grid drawn over the other.
//
// What is ours here: the workspaces row above the grid is folded away while
// the view is up, so the posters get its room.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';

import {Duration, Ease} from './anim.js';
import {createMediaView} from './mediaGrid.js';
import {SectionButtons} from './sectionButtons.js';

// The overview gives the dash no more than this share of its height, and
// leaves this much of it between its rows (DASH_MAX_HEIGHT_RATIO and
// VERTICAL_SPACING_RATIO, overviewControls.js:22-23, which it does not export).
const DASH_MAX_SHARE = 0.16;
const VERTICAL_SPACING_SHARE = 0.02;

export class MediaMenu {
    constructor({sections, itemsFor, onActivate, columns, rows}) {
        // A library with nothing in it gets no button.
        this._sections = sections.filter(s => itemsFor(s.key).length);
        this._itemsFor = itemsFor;
        this._onActivate = onActivate;
        this._columns = columns;
        this._rows = rows;
        this._views = new Map();
        this._buttons = new SectionButtons({
            sections: this._sections,
            onActivate: key => this.toggle(key),
        });
        // Show Apps, once `enable` has found the overview; never, for an empty
        // library, though the shortcut still reaches `toggle`.
        this._showAppsButton = null;
        this._current = null;
        // The slot the shell's own layout last measured for a view of ours,
        // and the box the views standing were actually built for.
        this._slot = null;
        this._box = null;
        // How far the workspaces were last left folded, 0 to 1.
        this._fold = 0;
        // Whether the overview that is up is one a button of ours opened.
        this._forced = false;
        this._escapeId = 0;
        // The library to open onto once the overview has gone down: a press
        // with another extension's view up closes the one that is up and
        // opens ours.
        this._next = null;
        this._reopenId = 0;
        // Our wrapper round the layout's `_getAppDisplayBoxForState`, and the
        // wrapper it went on over, if it went on over one.
        this._foldedBox = null;
        this._stockBox = null;
    }

    enable() {
        this._controls = Main.overview._overview?.controls ?? null;
        this._appDisplay = this._controls?.appDisplay ?? null;
        // The app grid's own content; ours takes turns with it.
        this._appsBox = this._appDisplay?._box ?? null;
        if (!this._appDisplay || !this._appsBox || !this._sections.length) {
            if (this._sections.length)
                console.warn('[Games Menu] The overview is not laid out as expected; no games menu.');
            this._appsBox = null;
            return;
        }

        // Gone from view is back to apps, so Show Apps always shows apps.
        //
        // Show Apps' own checked state says whether the grid is up: the shell
        // checks it as the grid opens and unchecks it on every way out —
        // Escape, a swipe, a search, leaving the overview — so that is what
        // our view follows. (The app display's visibility does not: it is held
        // on for the whole slide down to the window picker, which used to
        // leave a view up with nothing showing it and Show Apps still ours,
        // so the next click on it went nowhere.)
        //
        // Unchecked with our view up in an overview a button of ours opened,
        // that is Show Apps pressed — or the app grid stepped down from — and
        // the overview goes down whole, as it does for Escape. Not while a
        // swipe is landing (the shell unchecks before it eases, and the
        // gesture is the shell's), and not for a search, which unchecks as it
        // starts and puts the grid back as it ends.
        this._showAppsButton = Main.overview.dash.showAppsButton;
        this._showAppsButton.connectObject('notify::checked', button => {
            if (button.checked)
                return;
            const leaving = this._current && this._forced &&
                Main.overview.visible && !Main.overview.animationInProgress &&
                !this._adjustment?.gestureInProgress &&
                !this._controls._searchController?.searchActive;
            this._show(null);
            if (leaving)
                Main.overview.hide();
        }, this);

        // The end of a search shows the workspaces again, whatever is up.
        this._controls._searchController?.connectObject('notify::search-active', controller => {
            if (!controller.searchActive && this._current)
                this._syncWorkspaces(true);
        }, this);

        this._adjustment = this._controls._stateAdjustment ?? null;
        this._adjustment?.connectObject('notify::value', () => this._syncWorkspaces(), this);

        // However the overview goes, it is nobody's forced one any more —
        // and if it went down to make way for ours, it comes back up onto
        // the games, off the idle so the shell's own hide has finished with
        // it first.
        Main.overview.connectObject('hidden', () => {
            this._unforce();
            const next = this._next;
            this._next = null;
            if (next && !this._reopenId) {
                this._reopenId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._reopenId = 0;
                    this.open(next);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }, this);

        this._foldWorkspaces();

        this._buttons.attach();
    }

    disable() {
        if (!this._appsBox)
            return;
        this._show(null);
        this._buttons.detach();
        this._unfoldWorkspaces();
        this._controls.queue_relayout();
        this._showAppsButton?.disconnectObject(this);
        this._showAppsButton = null;
        Main.overview.disconnectObject(this);
        this._unforce();
        if (this._reopenId)
            GLib.source_remove(this._reopenId);
        this._reopenId = 0;
        this._next = null;
        this._controls._searchController?.disconnectObject(this);
        this._adjustment?.disconnectObject(this);
        this._adjustment = null;
        this._dropViews();
        this._slot = null;
        this._controls = this._appDisplay = this._appsBox = null;
    }

    // In the app grid state the overview keeps a row of small workspaces above
    // the grid and gives the grid what is left. While our view is up the
    // grid's box is grown over that row instead, and the row faded out (see
    // _syncWorkspaces) — the workspaces keep their box, because the shell
    // divides by its height.
    //
    // The box comes from the layout's `_getAppDisplayBoxForState`, which this
    // wraps on the layout itself — and another extension may too, for its own
    // view, on the same layout. Wrappers stack: each calls whatever it found,
    // and each grows the box only while its own view is up, which is never
    // while the other's is (see `open`). What they must not do is take the
    // method back by deleting it, which would take every wrapper put on after
    // theirs with it; see `_unfoldWorkspaces`.
    _foldWorkspaces() {
        const layout = this._controls.layout_manager;
        if (typeof layout._getAppDisplayBoxForState !== 'function')
            return;
        // What was there before us: another extension's wrapper, on the
        // layout itself as ours is, or else the class's own method — which is
        // looked up on every call rather than kept, since an extension enabled
        // after us may patch the class (Dash to Dock does, for this very
        // method), and ours must not step round it.
        const own = Object.prototype.hasOwnProperty.call(layout, '_getAppDisplayBoxForState')
            ? layout._getAppDisplayBoxForState : null;
        const menu = this;
        // Six arguments since GNOME 47; five before.
        const folded = function (state, box, searchHeight, dashHeight, workspacesBox, spacing) {
            const shell = Object.getPrototypeOf(this)._getAppDisplayBoxForState;
            const slot = (own ?? shell).call(this, state, box, searchHeight, dashHeight, workspacesBox, spacing);
            // Unhooked, and only still here as a link in someone else's chain.
            if (menu._foldedBox !== folded)
                return slot;
            // The folded slot, measured by the shell's own layout, for the next
            // view that has to be built before it is ever allocated. Asked of
            // the class rather than read off `slot` when there is a wrapper in
            // between: with the other media menu's view up, `slot` has
            // already been grown for that view, and ours built against it
            // would overhang its own box.
            const measured = own
                ? shell.call(this, state, box, searchHeight, dashHeight, workspacesBox, spacing) : slot;
            menu._slot = [measured.get_width(), measured.get_height() + workspacesBox.get_height() + spacing];
            if (!menu._current)
                return slot;
            // The same size in every state, as the shell has it, so the slide
            // up from the window picker moves the slot without stretching it.
            const extra = workspacesBox.get_height() + spacing;
            const [x, y] = slot.get_origin();
            const [width, height] = slot.get_size();
            slot.set_origin(x, state === ControlsState.APP_GRID ? y - extra : y);
            slot.set_size(width, height + extra);
            return slot;
        };
        this._stockBox = own;
        this._foldedBox = layout._getAppDisplayBoxForState = folded;
    }

    // The wrapper comes off only while it is still the one on the layout, and
    // then by putting back exactly what it found — the class's method, or the
    // other media menu's wrapper. With someone else's wrapper over it, it has
    // become a link in their chain and stays, passing straight through: it
    // checks it is still hooked before doing anything of its own.
    _unfoldWorkspaces() {
        const folded = this._foldedBox;
        this._foldedBox = null;
        if (!folded)
            return;
        const layout = this._controls.layout_manager;
        if (layout._getAppDisplayBoxForState === folded) {
            if (this._stockBox)
                layout._getAppDisplayBoxForState = this._stockBox;
            else
                delete layout._getAppDisplayBoxForState;
        }
        this._stockBox = null;
    }

    // How far the row of workspaces is folded away follows the overview's own
    // state: not at all up to the window picker, wholly in the app grid. So
    // the workspace shrinks towards its row and fades on the way in, and grows
    // back out of it on the way out, in step with whatever is moving the
    // overview — Show Apps, Super, a swipe — rather than on a clock of ours.
    // Only a change of view, when the overview is standing still, is eased.
    _syncWorkspaces(animate = false) {
        // An ease of ours can outlast the menu.
        const workspaces = this._controls?._workspacesDisplay;
        // A search has them hidden, and brings them back itself.
        if (!workspaces || this._controls._searchController?.searchActive)
            return;
        const state = this._adjustment?.value ?? ControlsState.WINDOW_PICKER;
        const fold = this._current
            ? Math.clamp(state - ControlsState.WINDOW_PICKER, 0, 1) : 0;
        // Nothing of ours to undo, which is every frame the overview moves
        // with the apps up — or with the other media menu's view up, whose
        // fold is its own: the workspaces are someone else's to animate.
        if (!fold && !this._fold)
            return;
        const opacity = Math.round(255 * (1 - fold));

        // As the shell hides them for a search: out of sight, and then out
        // of picking. The row lies over the top of the grown slot, and a
        // workspace that is only transparent still takes a poster's click.
        if (fold < 1) {
            workspaces.reactive = true;
            workspaces.setPrimaryWorkspaceVisible?.(true);
        }
        workspaces.remove_transition('opacity');
        if (animate && workspaces.mapped && workspaces.opacity !== opacity) {
            workspaces.ease({
                opacity,
                duration: Duration.NORMAL,
                mode: Ease.OUT,
                onComplete: () => this._syncWorkspaces(),
            });
            return;
        }
        this._fold = fold;
        workspaces.opacity = opacity;
        if (fold === 1) {
            workspaces.reactive = false;
            workspaces.setPrimaryWorkspaceVisible?.(false);
        }
    }

    // The button, or the shortcut: the view, opening the overview onto it if
    // need be; or, when that view is what is up, the way back out — to the
    // desktop if this is an overview a button of ours opened, else unchecked,
    // which the shell takes back to the window picker.
    toggle(key) {
        if (Main.overview.visible && this._showAppsButton?.checked && this._current) {
            if (this._forced)
                Main.overview.hide();
            else
                this._showAppsButton.checked = false;
            return;
        }
        this.open(key);
    }

    // The way out, whatever is up: the view only exists while the overview
    // does, so taking the overview down closes it.
    close() {
        Main.overview.hide();
    }

    // The view is what the overview is showing.
    get isShowing() {
        return Main.overview.visible && !!this._showAppsButton?.checked && !!this._current;
    }

    // The grid on show, for a page turn with the keyboard not yet in it.
    get currentView() {
        return this.isShowing ? this._views.get(this._current) ?? null : null;
    }

    // What is up, for a rebuild to put back: the library, if it is showing,
    // and whether the overview it is in is one a button of ours opened. A
    // rebuild tears this menu down and makes another (a change of `columns`,
    // a rescan landing), and without this the overview was left on the app
    // grid, with the library gone and the new column count nowhere to be
    // seen until the button was pressed again.
    get state() {
        return {key: this._current, forced: this._forced};
    }

    // The library `state` names back into the overview, if that is still up
    // -- otherwise there is nothing to restore into, and the next press
    // builds the view fresh anyway.
    restore(state) {
        if (!state?.key || !this._appsBox || !Main.overview.visible)
            return;
        if (!this._sections.some(s => s.key === state.key))
            return;
        if (state.forced)
            this._force();
        this.open(state.key);
    }

    // The overview, on the view: opened onto it, or brought up to the grid if
    // it is already showing.
    //
    // Unless another extension's view is what the grid is showing. Ours shown
    // now would be drawn over it, two grids in one slot with the apps hidden
    // under both. So the overview goes down with the other view in it, and
    // comes back up onto ours
    // (`hidden`, in `enable`), as a dock's Show Apps would reopen it.
    open(key) {
        this._next = null;
        if (!this._appsBox || !this._sections.some(s => s.key === key))
            return;
        if (this._otherViewUp()) {
            this._next = key;
            Main.overview.hide();
            return;
        }
        this._show(key);
        if (Main.overview.visible) {
            this._showAppsButton.checked = true;
            return;
        }
        this._force();
        Main.overview.show(ControlsState.APP_GRID);
    }

    // Someone else's view in the app grid's slot: the grid is up, the apps in
    // it are hidden, and it is not ours that has taken their place.
    _otherViewUp() {
        return Main.overview.visible && !!this._showAppsButton?.checked &&
            !this._appsBox.visible && !this._current;
    }

    // An overview of our own opening. While it is up, Escape on our view
    // closes it whole — the desktop is where it was opened from — where the
    // shell's Escape would only step down to the window picker. Seen ahead of
    // the shell's own handler, which is on the stage's bubbling phase; a
    // search or a popup over the overview is left its own Escape.
    _force() {
        this._forced = true;
        if (this._escapeId)
            return;
        // Keyed on the event type, as the date menu keys its own captures
        // (dateMenu.js:923-931), so the pointer crossing the overview never
        // reaches JS. The `key` detail is wider than a key press — releases
        // and the input method's own events carry it too — and asking one of
        // those for a key symbol is a Clutter assertion, so the type is
        // checked first, exactly as the date menu's handler does
        // (calendar.js:860).
        this._escapeId = global.stage.connect('captured-event::key', (_stage, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS ||
                event.get_key_symbol() !== Clutter.KEY_Escape ||
                !this._current || !this._showAppsButton?.checked ||
                Main.modalCount > 1 || this._controls?._searchController?.searchActive)
                return Clutter.EVENT_PROPAGATE;
            Main.overview.hide();
            return Clutter.EVENT_STOP;
        });
    }

    _unforce() {
        this._forced = false;
        if (this._escapeId)
            global.stage.disconnect(this._escapeId);
        this._escapeId = 0;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    // The library's view in the app grid's slot, or (null) the apps again.
    _show(key) {
        if (!this._appsBox)
            return;
        if (key !== this._current) {
            // Built against the slot as it stands, before the fold moves it.
            const view = key ? this._view(key) : null;
            this._views.get(this._current)?.hide();
            this._current = key;
            this._appsBox.visible = !key;
            if (view) {
                view.show();
                view.goToPage(0, false);
            }
            this._syncWorkspaces(true);
            this._controls.queue_relayout();
        }
        // A toggle button unchecks itself when the one that is up is clicked.
        this._buttons.sync(this._current);
    }

    // The slot as the overview will lay it out under the view: the one the
    // shell's own layout last handed us, or — for a button pressed before
    // the overview has ever been shown — worked out as that layout does,
    // since what the slot was last given says nothing of which of the two
    // sizes that was.
    //
    // Step for step the shell's `vfunc_allocate` (overviewControls.js:155-183),
    // the dash included whether or not it is visible: the shell measures it
    // either way, and Dash to Panel hides it. Reading the visibility instead
    // left this estimate a dash-height taller than the slot the shell went on
    // to hand out.
    _slotSize() {
        if (this._slot)
            return this._slot;
        const monitor = Main.layoutManager.primaryMonitor;
        // The overview is laid out in the work area, not on the monitor: the
        // shell's `box` here is already inset by the top bar and by whatever
        // else is reserved (Dash to Panel's panel, 48px of it). Measuring the
        // monitor instead left this a panel's height too tall.
        const {width, height} = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const spacing = Math.round(height * VERTICAL_SPACING_SHARE);
        const maxDash = Math.round(height * DASH_MAX_SHARE);
        const search = Main.overview.searchEntry?.get_parent();
        const searchHeight = search ? search.get_preferred_height(width)[0] : 0;
        const dash = Main.overview.dash;
        dash.setMaxSize(width, maxDash);
        const dashHeight = Math.min(dash.get_preferred_height(width)[1], maxDash);
        // What the apps get, plus the row of workspaces folded away above them.
        return [width, height - searchHeight - dashHeight - 2 * spacing];
    }

    // Built the first time it is wanted, against the box the slot will have.
    // The first press can come before the overview has ever laid the slot
    // out, and what that press gets is `_slotSize`'s estimate; the shell's
    // own measurement lands a moment later and need not agree with it to the
    // pixel. So the box the view standing was built for is kept, and when it
    // moves the view goes and is built again against the new one — or
    // `columns` would mean one cover size today and another after a restart.
    _view(key) {
        const [width, height] = this._slotSize();
        if (this._box && (this._box[0] !== width || this._box[1] !== height))
            this._dropViews();
        this._box = [width, height];

        let view = this._views.get(key);
        if (view)
            return view;

        const section = this._sections.find(s => s.key === key);

        view = createMediaView({
            section,
            items: this._itemsFor(key),
            width,
            height,
            columns: this._columns,
            rows: this._rows,
            onActivate: this._onActivate,
        });
        view.visible = false;
        this._appDisplay.add_child(view);
        this._views.set(key, view);
        return view;
    }

    _dropViews() {
        for (const view of this._views.values())
            view.destroy();
        this._views.clear();
        this._box = null;
    }
}
