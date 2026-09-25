// Small St building blocks shared by the views. Everything paints through the
// stylesheet (gm-* classes); JS only sets sizes and wires behaviour.

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import {radiusStyle} from './shape.js';

// St bakes the corner radius into the artwork only when it renders the
// background image itself, so the radius has to travel in the same inline
// style as the image rather than being left to the stylesheet.
export function artworkStyle(path, part = 'art') {
    return `background-image: url("file://${encodeURI(path)}"); background-size: cover; ${radiusStyle(part)}`;
}

// A single line of text that ellipsises rather than wraps: every title and
// subtitle in the design, on a tile, a row or in the detail pane.
export function createLabel(text, styleClass, props = {}) {
    const label = new St.Label({text, style_class: styleClass, ...props});
    label.clutter_text.single_line_mode = true;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return label;
}

// A poster: the image when there is one, otherwise a tinted placeholder built
// from the section icon and the title. Placeholders live in the stylesheet so
// they follow the system accent colour.
export function createArtwork({path, title, icon, width, height, styleClass = 'gm-art', radius = 'art'}) {
    const art = new St.Widget({
        style_class: styleClass,
        width,
        height,
        layout_manager: new Clutter.BinLayout(),
        // Not clipped: the focus ring is a box-shadow and has to show past
        // the allocation. The placeholder's icon/label stack gets its own
        // clip below instead.
        // Explicit, because a placeholder's inner box expands to centre its
        // icon, and Clutter would otherwise let that expansion leak upwards
        // and stretch the artwork itself.
        x_expand: false,
        y_expand: false,
    });
    if (path) {
        art.set_style(artworkStyle(path, radius));
        return art;
    }

    art.set_style(radiusStyle(radius));
    art.add_style_class_name('gm-art-placeholder');
    const stack = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        clip_to_allocation: true,
        style_class: 'gm-art-placeholder-content',
    });
    // `width` is physical pixels but `icon_size` is logical, so the share of
    // the artwork the icon takes is divided back down (iconGrid.js:143-147).
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    stack.add_child(new St.Icon({
        icon_name: icon,
        icon_size: Math.max(24, Math.round(width * 0.22 / scale)),
        style_class: 'gm-art-placeholder-icon',
        x_align: Clutter.ActorAlign.CENTER,
    }));
    if (title && width >= 120) {
        const label = new St.Label({
            text: title,
            style_class: 'gm-art-placeholder-title',
            x_align: Clutter.ActorAlign.CENTER,
            width: Math.round(width * 0.8),
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.x_align = Clutter.ActorAlign.CENTER;
        label.height = Math.min(64, Math.round(height * 0.3));
        stack.add_child(label);
    }
    art.add_child(stack);
    return art;
}

// A primary action: the shell's own `button.default`, which brings the accent
// fill along with the hover, focus and pressed states; only the pill shape is
// ours. `gm-action-secondary` is the theme's plain button.
export function createActionButton({label, icon, styleClass = 'button default gm-action'}) {
    const content = new St.BoxLayout({style_class: 'gm-action-content', y_align: Clutter.ActorAlign.CENTER});
    if (icon)
        content.add_child(new St.Icon({icon_name: icon, icon_size: 16, y_align: Clutter.ActorAlign.CENTER}));
    content.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    return new St.Button({
        style_class: styleClass,
        reactive: true,
        can_focus: true,
        track_hover: true,
        child: content,
    });
}

// The library's name over its count: the whole header of the modal library's
// panel, which needs no buttons beside it — the way out is the button it came
// from, Escape, or a click away.
export function createTitles(title = '', subtitle = '') {
    const actor = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        style_class: 'gm-header-titles',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const titleLabel = new St.Label({style_class: 'gm-header-title', text: title});
    const subtitleLabel = new St.Label({style_class: 'gm-header-subtitle', text: subtitle});
    actor.add_child(titleLabel);
    actor.add_child(subtitleLabel);
    return {actor, titleLabel, subtitleLabel};
}

// A small rounded label: a fact in the detail pane, a badge on a row. The class
// is not optional — there is no bare `gm-pill` rule for one to fall back to.
export function createPill(text, styleClass, style = null) {
    return new St.Label({text, style_class: styleClass, style, y_align: Clutter.ActorAlign.CENTER});
}

// One entry in a detail list: numbered circle, title/subtitle, badges, size and
// an icon saying what the row is. Hover is a single background change on the
// row itself — nothing inside it restyles, so one pointer crossing is one
// repaint rather than four.
export function createRow({index, title, subtitle, badges = [], size, icon, onActivate}) {
    const row = new St.Button({
        // The theme's flat button: hover, focus and pressed come with it, and
        // the inline radius below overrides the one it brings.
        style_class: 'button flat gm-row',
        reactive: true,
        can_focus: true,
        track_hover: true,
        x_expand: true,
        style: radiusStyle(),
    });
    const content = new St.BoxLayout({x_expand: true, y_align: Clutter.ActorAlign.CENTER});

    // A disc with the number centred in it. A label given the disc's size
    // in CSS draws its text at the top, so the disc is a bin around it.
    content.add_child(new St.Bin({
        style_class: 'gm-row-index',
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Label({
            text: String(index),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        }),
    }));

    const titleLabel = createLabel(title, 'gm-row-title', {x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    if (subtitle) {
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'gm-row-text'});
        text.add_child(titleLabel);
        text.add_child(createLabel(subtitle, 'gm-row-subtitle'));
        content.add_child(text);
    } else {
        // One line needs no column to stack in; it takes the column's margins.
        titleLabel.add_style_class_name('gm-row-text');
        content.add_child(titleLabel);
    }

    for (const badge of badges)
        content.add_child(createPill(badge, 'gm-badge', radiusStyle('badge')));
    if (size)
        content.add_child(new St.Label({text: size, style_class: 'gm-row-size', y_align: Clutter.ActorAlign.CENTER}));

    content.add_child(new St.Icon({
        icon_name: icon,
        icon_size: 16,
        style_class: 'gm-row-icon',
        y_align: Clutter.ActorAlign.CENTER,
    }));

    row.set_child(content);
    row.connect('clicked', () => onActivate?.());
    return row;
}
