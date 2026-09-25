// One game up close: artwork and primary action on the left, title, facts,
// synopsis and the details list (install folder, playtime, serial) on the
// right. It always sits inside the folder's panel (detailDialog.js), which is
// the surface it is drawn on, so it draws no frame of its own.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

import {Duration, Ease, staggerIn} from './anim.js';
import {fillOnScroll} from './lazyList.js';
import {artworkStyle, createArtwork, createActionButton, createLabel, createPill, createRow} from './widgets.js';
import {PANE_INSET, radiusStyle} from './shape.js';
import {adjustAnimationTime, ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

// What the pane keeps around its content; the stylesheet carries the same
// number. Sizes are worked out here rather than read back off an allocation,
// because the popup has to know how wide the side column will be before
// anything is on screen.
//
// Everything below is logical pixels, as the stylesheet's are: each is
// multiplied by the scale factor where it meets an allocation, and left alone
// where it goes into a CSS string, which St scales itself.
// The panel around the pane adds `shape.js` PANE_INSET on top of this: what
// shows between the panel's edge and the artwork is the two together, 32.
const PADDING = 32 - PANE_INSET;

// The hero fills the pane's height, less its padding and the two action
// buttons beneath it, up to this cap. It stops well short of a big screen:
// the popup is a panel the size of a folder's, not the work area.
const HERO_MAX_HEIGHT = 560;
const HERO_RESERVED = 2 * 52 + 28;         // two action buttons and the gaps
const HERO_MAX_WIDTH_FRACTION = 0.34;      // of the pane width
// The hero's floor on a small work area — see `_heroSize`.
const HERO_MIN = 132;
// 14px type at the stylesheet's line-height: 1.5.
const SUMMARY_LINE = 21;
const SUMMARY_LINES = 5;
// A game's details run to three rows, but the list is built the way every
// list here is: a screenful first — the one that is staggered in — and the
// rest as it scrolls.
const FIRST_ROWS = 24;
const ROWS_PER_BATCH = 16;

export class DetailView {
    constructor({onOpen}) {
        this._onOpen = onOpen;
        this._list = null;
        this._listHost = null;
        this._width = 0;
        this._height = 0;
        this._deferredList = 0;
        this._deferredMain = 0;
        this._columns = null;
        this._main = null;
        this._buildPendingMain = null;
        this.hero = null;
        this.side = null;
        this.item = null;

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
    }

    destroy() {
        this._cancelDeferred();
        this.actor.destroy();
    }

    setSize(width, height) {
        this._width = width;
        this._height = height;
    }

    _cancelDeferred() {
        if (this._deferredList) {
            GLib.source_remove(this._deferredList);
            this._deferredList = 0;
        }
        if (this._deferredMain) {
            GLib.source_remove(this._deferredMain);
            this._deferredMain = 0;
        }
    }

    // What the pane keeps between its edge and its columns, in physical
    // pixels — St has already scaled the stylesheet's copy of it. Public
    // because the popup sizes its panel around the side column and has to add
    // it back.
    get padding() {
        return PADDING * this._scale;
    }

    get _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    // Hero size for this screen: as tall as the pane allows, capped so the
    // text column keeps its share of the width.
    _heroSize(aspect) {
        const scale = this._scale;
        const room = this._height - 2 * this.padding - HERO_RESERVED * scale;
        const byHeight = Math.min(HERO_MAX_HEIGHT * scale, room);
        const byWidth = Math.round(this._width * HERO_MAX_WIDTH_FRACTION * aspect);
        // A small screen at the smallest `detail-size` leaves less room than
        // the buttons under the artwork take, and the artwork would come out
        // at nothing or below it. HERO_MIN is the floor; the panel grows
        // around it, since it is sized from the column's own height.
        const height = Math.max(HERO_MIN * scale, Math.min(byHeight, byWidth));
        return {width: Math.round(height / aspect), height};
    }

    // `mainColumn` is when the second column — the title, the facts and the
    // list — joins the first: 'auto' as soon as the frame it was built on is
    // free, 'held' when whatever is opening the pane will call `revealMain()`
    // itself (the popup does, as it starts to widen onto it).
    populate(item, section, {mainColumn = 'auto'} = {}) {
        this._cancelDeferred();
        this.actor.destroy_all_children();
        this.item = item;
        this._list = null;
        this._listHost = null;
        this._main = null;

        // The pane stacks an optional backdrop (the game's wide hero art,
        // dimmed) beneath the two-column content, both clipped to the pane's
        // corners — the panel's own curve less the frame it keeps, so the two
        // stay concentric.
        const pane = new St.Widget({
            style_class: 'gm-pane',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
            style: radiusStyle('paneInner'),
        });
        this.actor.add_child(pane);

        if (item.backdrop) {
            const backdrop = new St.Widget({style_class: 'gm-backdrop', x_expand: true, y_expand: true});
            backdrop.set_style(artworkStyle(item.backdrop, 'paneInner'));
            pane.add_child(backdrop);
            // A dark veil keeps the text readable over bright artwork.
            pane.add_child(new St.Widget({
                style_class: 'gm-backdrop-veil',
                x_expand: true,
                y_expand: true,
                style: radiusStyle('paneInner'),
            }));
        }

        const columns = new St.BoxLayout({style_class: 'gm-pane-content', x_expand: true, y_expand: true});
        pane.add_child(columns);
        this._columns = columns;
        this.side = this._buildSide(item, section);
        columns.add_child(this.side);

        // Only the artwork and its buttons are built now. The rest is built on
        // the next idle, off the frames of the zoom that is opening the pane,
        // and the list inside it later still, once the pane has landed.
        this._buildPendingMain = () => this._buildMain(item);
        this._deferredMain = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._deferredMain = 0;
            this._addMain();
            if (mainColumn === 'auto')
                this.revealMain();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Build the second column, hidden, if it is not there yet.
    _addMain() {
        if (!this._buildPendingMain)
            return;
        const build = this._buildPendingMain;
        this._buildPendingMain = null;
        if (this._deferredMain) {
            GLib.source_remove(this._deferredMain);
            this._deferredMain = 0;
        }
        this._main = build();
        this._main.opacity = 0;
        this._columns.add_child(this._main);
    }

    // Fade the second column in — as the popup's panel opens out onto it, or
    // on its own once built when the pane is already the width it will be.
    // The list under it follows the fade rather than joining it: see _fillList.
    revealMain({delay = 0} = {}) {
        this._addMain();
        this._main?.ease({opacity: 255, delay, duration: Duration.NORMAL, mode: Ease.OUT});
        this._fillList(delay + Duration.NORMAL);
    }

    // The first screenful of the list, once the pane has stopped moving. It is
    // the one piece of building left that could be felt, so the zoom and the
    // widen that opened the pane get every frame before this to themselves. A
    // timer and not an idle: an idle falls in the middle of an animation,
    // which is the whole of what this avoids. Whatever fills it afterwards is
    // `lazyList` as it scrolls.
    _fillList(after) {
        if (this._deferredList || this._list || !this._listHost)
            return;
        this._deferredList = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            adjustAnimationTime(after), () => {
                this._deferredList = 0;
                this._showList();
                return GLib.SOURCE_REMOVE;
            });
    }

    // And back out, as the panel closes back down to its artwork.
    hideMain({duration = Duration.FAST} = {}) {
        this._main?.ease({opacity: 0, duration, mode: Ease.OUT});
    }

    // Left: artwork, Play, and the install folder.
    _buildSide(item, section) {
        // x_expand is set explicitly to false: Clutter otherwise treats a parent
        // as expanding when any descendant expands (the buttons do), and the
        // side column would swallow half of the free width.
        const side = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'gm-detail-side', x_expand: false, y_expand: true});

        const {width: heroW, height: heroH} = this._heroSize(section.aspect);
        this.hero = createArtwork({
            path: item.art,
            title: item.title,
            icon: section.icon,
            width: heroW,
            height: heroH,
            styleClass: 'gm-art gm-hero',
            radius: 'hero',
        });
        side.add_child(this.hero);

        // A PS2 disc with no PCSX2 to boot it has nothing to launch.
        if (item.playPath) {
            const play = createActionButton({
                label: item.playLabel,
                icon: 'media-playback-start-symbolic',
            });
            play.set_x_expand(true);
            play.connect('clicked', () => this._onOpen(item.playPath));
            side.add_child(play);
        }

        if (item.folder) {
            const folder = createActionButton({
                label: 'Show in Files',
                icon: 'folder-symbolic',
                styleClass: 'button gm-action-secondary',
            });
            folder.set_x_expand(true);
            folder.connect('clicked', () => this._onOpen(item.folder));
            side.add_child(folder);
        }

        return side;
    }

    // Right: title, facts, synopsis, details.
    _buildMain(item) {
        const main = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true, style_class: 'gm-detail-main'});

        main.add_child(createLabel(item.title, 'gm-detail-title'));

        const facts = new St.BoxLayout({style_class: 'gm-facts', y_align: Clutter.ActorAlign.CENTER});
        if (item.subtitle)
            facts.add_child(createPill(item.subtitle, 'gm-fact gm-fact-strong'));
        if (item.year)
            facts.add_child(createPill(String(item.year), 'gm-fact'));
        if (item.rating)
            facts.add_child(createPill(`★ ${item.rating}`, 'gm-fact gm-fact-rating'));
        if (item.countLabel)
            facts.add_child(createPill(item.countLabel, 'gm-fact'));
        for (const tag of item.tags)
            facts.add_child(createPill(tag, 'gm-fact gm-fact-tag'));
        if (facts.get_n_children())
            main.add_child(facts);

        if (item.summary) {
            const summary = new St.Label({text: item.summary, style_class: 'gm-summary', x_expand: true});
            summary.clutter_text.line_wrap = true;
            summary.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            summary.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            // Height bounds the text so Pango ellipsises the last visible line.
            summary.height = SUMMARY_LINE * this._scale * SUMMARY_LINES;
            summary.y_expand = false;
            main.add_child(summary);
        }

        main.add_child(new St.Label({text: item.details.name, style_class: 'gm-group-heading'}));

        this._listHost = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
        });
        main.add_child(this._listHost);
        // The list itself is `revealMain`'s to start, once the pane has
        // landed (_fillList).
        return main;
    }

    _showList() {
        const {entries} = this.item.details;
        this._list = entries.length
            ? this._buildList(entries)
            : new St.Label({text: 'Nothing here yet.', style_class: 'gm-empty-hint', x_expand: true});
        this._listHost.add_child(this._list);
    }

    _buildList(entries) {
        const scroll = new St.ScrollView({x_expand: true, y_expand: true, overlay_scrollbars: true, style_class: 'vfade gm-list-scroll'});
        scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'gm-list'});
        scroll.set_child(box);

        let next = 0;
        let first = true;
        fillOnScroll(scroll, () => {
            const limit = Math.min(entries.length, next + (first ? FIRST_ROWS : ROWS_PER_BATCH));
            const batch = [];
            for (; next < limit; next++) {
                const entry = entries[next];
                const row = createRow({
                    index: entry.index,
                    title: entry.title,
                    subtitle: entry.subtitle,
                    badges: entry.badges,
                    size: entry.size,
                    icon: entry.icon,
                    onActivate: () => this._onOpen(entry.path),
                });
                // Keyboard focus has to drag the view after it, or a Tab past
                // the fold never scrolls and so never tops the list up.
                row.connect('key-focus-in', () => ensureActorVisibleInScrollView(scroll, row));
                batch.push(row);
                box.add_child(row);
            }
            // Only the arriving screenful is staggered; the rest are appended
            // below the fold, where an animation would go unseen.
            if (first)
                staggerIn(batch, {step: 12, cap: 160, fromY: 8});
            first = false;
            return next < entries.length;
        });
        return scroll;
    }
}
