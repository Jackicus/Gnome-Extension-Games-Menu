# Private and deep GNOME Shell API

Games Menu puts a grid of its own in the overview's app-grid slot, a button
beside Show Apps (in the dash, or in Dash to Panel's panel), and pop-up panels
that open the way an app folder does. None of that has a public API. This is
everything it reaches into, for reviewers on extensions.gnome.org and for
whoever ports it to the next GNOME.

Every entry was checked against the GNOME Shell 50.5 JavaScript on the test
machine (extracted from `/usr/lib/gnome-shell/libshell-18.so`) and against the
`48.0`, `49.0` and `51.0` tags of `GNOME/gnome-shell` and `GNOME/mutter` on
gitlab.gnome.org. The Dash to Panel entries were checked against Dash to Panel
74, and the Blur my Shell entry against Blur my Shell 72, both as installed on
the test machine. Unless an entry says otherwise, the field or method exists
with the same meaning in all of them. Line numbers are left out on purpose,
because `src/` is changing; functions are named instead.

## At a glance

| Expression | File | If it changes in a future GNOME | Checked in code |
|---|---|---|---|
| `Main.overview._overview?.controls`, `controls.appDisplay._box` | mediaMenu.js | No `menu` library and no button in that place | Yes, logs a warning |
| `controls._searchController` (`searchActive`) | mediaMenu.js | Starting a search with the games up closes an overview the button opened | Yes, silently |
| `controls._stateAdjustment` (`value`, `gestureInProgress`) | mediaMenu.js | The row of workspaces stays over the top of the grid | Yes, silently |
| `controls._workspacesDisplay`, `setPrimaryWorkspaceVisible()` | mediaMenu.js | Same | Yes, silently |
| Wrapping the layout's `_getAppDisplayBoxForState()` | mediaMenu.js | The grid is built for more room than it is given | Yes, silently |
| `DASH_MAX_HEIGHT_RATIO`, `VERTICAL_SPACING_RATIO` (copied) | mediaMenu.js | The first grid after a rebuild is the wrong size until the next press | No |
| `BaseAppView`, as `Object.getPrototypeOf(AppDisplay.AppDisplay)` | mediaGrid.js | The first press throws, and there is no library in either place | No |
| `BaseAppView`'s `_box`, `_parentalControlsManager`, `_appFavorites`, `_pageIndicators`, `_adjustment`, `_addItem()`; overrides of `_createGrid()`, `_loadApps()`, `_compareItems()` | mediaGrid.js | Same | No |
| `IconGridLayout`'s `_pageWidth`, `_pageHeight`, `_pages[].visibleChildren`, `_pageSizeChanged`, `_shouldEaseItems` | mediaGrid.js | Empty pages | Yes, silently |
| `AppViewItem(params, isDraggable, expandTitleOnHover)`, `_id`, `_name`; `BaseIcon`'s `icon` | mediaGrid.js | Tiles behave differently; the pop-up zooms out of the whole tile | Partly, silently |
| `class extends Dash.ShowAppsIcon`: `_createIcon()`, `_iconActor`, `_canRemoveApp()` | sectionButtons.js | No button, or the wrong icon on it | Partly: a throw logs a warning |
| `Main.overview.dash._dashContainer`, `dash._hookUpLabel()` | sectionButtons.js | No button in the dash; no tooltip | Yes, silently |
| `global.dashToPanel.panels`, its `panels-created` signal | sectionButtons.js | The button goes into the dash, which Dash to Panel hides | Yes, silently |
| Wrapping Dash to Panel's `panel._updateGroupedElements()`; `_elementGroups`, `showAppsIconWrapper.realShowAppsIcon`, `panel.panel` | sectionButtons.js | No button in the panel | Partly: a throw logs a warning |
| `controls._appDisplay._folderIcons`, `icon._dialog`, `dialog._viewBox` | panel.js | The pop-ups shade where Blur my Shell's folders blur | Yes, silently |
| `DIALOG_SHADE_NORMAL` (copied) | panel.js | The shade no longer matches a folder's | No |
| `Meta.Workspace._keepAliveId` (read only) | app.js | "Play on a new workspace" can pick a workspace someone else is holding | No |
| `Clutter.get_default_backend()` | controls.js | `enable()` stops at its first line and nothing is built. **Removed in GNOME 51** | No |
| `global.focus_manager.navigate_from_event()` | panel.js | A key press in either pop-up panel throws. **Removed in GNOME 51** | No |

"Silently" means it degrades without a line in the journal, so the symptom is
the only sign. The last two are public API, listed because 51 removed them
([compatibility.md](compatibility.md#gnome-51)).

A throw that reaches `GamesMenuApp.enable()` never reaches the shell.
`extension.js` catches it and logs `[Games Menu] Failed to load lib/app.js:`,
and the shell records a successful enable. So wherever an entry below says
`enable()` throws, the extension shows as on in the Extensions app and nothing
is on screen ([below](#not-shell-internals-staging-lib)).

## The menu library (mediaMenu.js)

The `menu` library shows the games in the overview's app-grid slot. It adds a
view of its own to the app display, hides the app grid's own box while the
view is up, grows the slot over the row of small workspaces, and fades that row
out. The `modal` library uses none of this section.

### `Main.overview._overview?.controls` and `controls.appDisplay._box`

`MediaMenu.enable()`:

```js
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
```

and `_show()` and `_view()`:

```js
this._appsBox.visible = !key;
...
this._appDisplay.add_child(view);
```

**What for.** `_overview` is the `OverviewActor` that `Main.overview` keeps.
`controls` is a public getter on it for the `ControlsManager`, and `appDisplay`
a public getter on that. `_box` is the `St.BoxLayout` a `BaseAppView` keeps its
scroll view and page dots in. `AppDisplay._init()` gives the app display a
`Clutter.BinLayout` at every tag checked, so a view added beside `_box` gets the
same box, and hiding `_box` puts the games where the apps were. The overview
then allocates the view, slides it with the app grid and hides it for a search,
because as far as the overview knows it is still showing the app grid.

**Why nothing public.** The overview has no way to show anything but the apps
in that slot.

**If it changes.** No view is built and no button is attached, so the `menu`
place has nothing. The shortcut and a controller's Home do nothing either.

**Checked.** Yes, with the warning above, once per build, when there are games
to show.

### `controls._searchController`

The Show Apps `notify::checked` handler in `enable()`:

```js
const leaving = this._current && this._forced &&
    Main.overview.visible && !Main.overview.animationInProgress &&
    !this._adjustment?.gestureInProgress &&
    !this._controls._searchController?.searchActive;
this._show(null);
if (leaving)
    Main.overview.hide();
```

and, also in `enable()`:

```js
this._controls._searchController?.connectObject('notify::search-active', controller => {
    if (!controller.searchActive && this._current)
        this._syncWorkspaces(true);
}, this);
```

**What for.** In an overview the button opened, Show Apps unchecked with the
games up means "leave", and the overview goes down whole. But the shell also
unchecks Show Apps as a search starts. `searchActive` tells the two apart.

**Why nothing public.** There is a public way: `ControlsManager` has a
`searchController` getter at every tag checked. The code reads the private
field instead. Using the getter would take this entry off the list.

**If it changes.** `searchActive` reads as undefined. Starting a search with
the games up, in an overview the button opened, then closes the overview
instead of searching.

**Checked.** Yes, silently.

### `controls._stateAdjustment`

`enable()` and `_syncWorkspaces()`:

```js
this._adjustment = this._controls._stateAdjustment ?? null;
this._adjustment?.connectObject('notify::value', () => this._syncWorkspaces(), this);
...
const state = this._adjustment?.value ?? ControlsState.WINDOW_PICKER;
const fold = this._current
    ? Math.clamp(state - ControlsState.WINDOW_PICKER, 0, 1) : 0;
```

**What for.** The overview's state as a number: 1 in the window picker, 2 in
the app grid, and every value between during a transition or a swipe. The row
of workspaces is faded by how far the overview is into the app grid, so it
moves with whatever moves the overview rather than on a timer of its own.
`gestureInProgress` is a plain property the `ControlsManager` sets on the
adjustment during a swipe (`gestureBegin()` and `gestureEnd()` in
`overviewControls.js`). The Show Apps handler uses it to leave a swipe to the
shell.

**Why nothing public.** No public getter reaches the adjustment. The signals
and `visible` on `Main.overview` say whether the overview is up, not how far it
is into the app grid.

**If it changes.** The row of workspaces is never folded. It stays drawn, and
clickable, over the top of the grown slot, covering the top of the first row of
posters. If only `gestureInProgress` goes, a swipe down from the games in an
overview the button opened can close the overview instead of stopping at the
window picker.

**Checked.** Yes, silently.

### `controls._workspacesDisplay` and `setPrimaryWorkspaceVisible()`

`_syncWorkspaces()`:

```js
const workspaces = this._controls?._workspacesDisplay;
if (!workspaces || this._controls._searchController?.searchActive)
    return;
...
workspaces.opacity = opacity;
if (fold === 1) {
    workspaces.reactive = false;
    workspaces.setPrimaryWorkspaceVisible?.(false);
}
```

**What for.** The `WorkspacesDisplay` is the row of small workspaces above the
app grid. It lies over the top of the grown slot, so fading it is not enough:
a transparent workspace still takes a poster's click. It is taken out of
picking the way the shell hides it for a search, where `_onSearchChanged()`
calls `setPrimaryWorkspaceVisible()`.

**Why nothing public.** As above.

**If it changes.** As above: the row stays over the top of the grid.

**Checked.** Yes, silently.

### Wrapping the layout's `_getAppDisplayBoxForState()`

`_foldWorkspaces()`:

```js
const layout = this._controls.layout_manager;
if (typeof layout._getAppDisplayBoxForState !== 'function')
    return;
const own = Object.prototype.hasOwnProperty.call(layout, '_getAppDisplayBoxForState')
    ? layout._getAppDisplayBoxForState : null;
const menu = this;
const folded = function (state, box, searchHeight, dashHeight, workspacesBox, spacing) {
    const shell = Object.getPrototypeOf(this)._getAppDisplayBoxForState;
    const slot = (own ?? shell).call(this, state, box, searchHeight, dashHeight, workspacesBox, spacing);
    if (menu._foldedBox !== folded)
        return slot;
    ...
    const extra = workspacesBox.get_height() + spacing;
    slot.set_origin(x, state === ControlsState.APP_GRID ? y - extra : y);
    slot.set_size(width, height + extra);
    return slot;
};
this._stockBox = own;
this._foldedBox = layout._getAppDisplayBoxForState = folded;
```

`_unfoldWorkspaces()` takes it off again in `disable()`.

**What for.** `ControlsManagerLayout.vfunc_allocate()` asks this method for the
app grid's box in each overview state and interpolates between them. While the
games are up, the wrapper grows the box upward over the row of workspaces, by
the row's height and one spacing, so the posters get that room. It also records
the shell's own measurement of the grown slot (`menu._slot`) for the next view
to be built. The six arguments are the same at `48.0`, `49.0`, `50.5` and
`51.0`.

**Why nothing public.** Nothing lets an extension resize the app grid's slot.

**Next to other extensions.** The wrapper is an own property of the layout
instance, not a prototype patch. Dash to Dock patches the same method on
`ControlsManagerLayout.prototype` (Dash to Dock 109, `docking.js`), which is why
the wrapper looks the class's method up on every call rather than keeping it.
Another extension with a view of its own may wrap the same instance. Each
wrapper calls what it found, and each grows the slot only while its own view is
up. `_unfoldWorkspaces()` takes ours off only while it is still the outermost,
by putting back exactly what it found: the other wrapper, or a `delete` to show
the class's method again. Under someone else's wrapper it stays, and passes
straight through.

**If it changes.** If the method goes, the `typeof` check skips the wrap. The
row of workspaces is still faded out, but the grid keeps the app grid's smaller
slot, below an empty band where the row was. It is also built for the grown
slot (`_slotSize()`, next), so it does not fit the one it is given. If the
method stays and its arguments change meaning, the slot is grown by the wrong
amount.

**Checked.** Yes, silently.

### The shell's layout, done again: `_slotSize()`

```js
// The overview gives the dash no more than this share of its height, and
// leaves this much of it between its rows (DASH_MAX_HEIGHT_RATIO and
// VERTICAL_SPACING_RATIO, overviewControls.js, which it does not export).
const DASH_MAX_SHARE = 0.16;
const VERTICAL_SPACING_SHARE = 0.02;
...
const {width, height} = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
const spacing = Math.round(height * VERTICAL_SPACING_SHARE);
const maxDash = Math.round(height * DASH_MAX_SHARE);
const search = Main.overview.searchEntry?.get_parent();
const searchHeight = search ? search.get_preferred_height(width)[0] : 0;
const dash = Main.overview.dash;
dash.setMaxSize(width, maxDash);
const dashHeight = Math.min(dash.get_preferred_height(width)[1], maxDash);
return [width, height - searchHeight - dashHeight - 2 * spacing];
```

**What for.** The layout asks for the app grid's box only while the app
display is visible. So a library just built, at login or by any rebuild, has
no measured slot for its first press, and this works one out step for step as
`ControlsManagerLayout.vfunc_allocate()` does. It is used until the wrapper has
measured the real slot once.

**If it changes.** If the shell's constants or steps change, the first grid
after a build is made for a slightly different box. `_view()` compares the box
each view was built for with the one it would build for now, and builds the
view again when they differ, so the next press is right. Nothing is logged.

**Checked.** No. The constants and `vfunc_allocate()` are the same at every
tag checked, apart from `let` becoming `const`.

## The grid (mediaGrid.js)

The library grid is the shell's app grid with posters in it. Subclassing the
shell's own classes brings the paging, the swipe, the page dots, the hover
arrows, scroll-wheel paging and keyboard focus without copying any of them.
Both places use it. Most of what it touches are exported classes; their
insides are not API.

The classes are subclassed at module scope. If an exported class disappears,
importing `lib/` throws, and the extension shows nothing. If only a field is
renamed, the import succeeds, and the failure comes at the first press.

### `BaseAppView`, reached as `AppDisplay`'s prototype

```js
// Not exported by the shell, but it is what AppDisplay extends.
const BaseAppView = Object.getPrototypeOf(AppDisplay.AppDisplay);
...
const MediaView = GObject.registerClass(
class GamesMenuMediaView extends BaseAppView {
```

**What for.** `BaseAppView` is the class both the app grid and an app folder's
view are built on: the scroll view, the pages, the page dots and arrows, and
paging by swipe and by scroll wheel. A view of posters is one more subclass.

**Why nothing public.** `appDisplay.js` declares it with `var` and does not
export it, at every tag checked. `AppDisplay` is exported. At `51.0` it is
declared with a static `GObject.registerClass(this)` block, but it still
`extends BaseAppView`, so the prototype is still the class wanted.

**If it changes.** If `AppDisplay` stops extending it directly, the view
extends something else. The import still succeeds, and the first press throws
inside the button's click handler, when the view's `_init()` reaches `_box`. In
the `menu` place nothing opens. In the `modal` place the panel opens with its
header and no grid. The error is in the journal as an exception from a signal
handler.

**Checked.** No.

### What the view touches of `BaseAppView`

`MediaView._init()` and its methods:

```js
this.add_child(this._box);
this._parentalControlsManager.disconnectObject(this);
this._appFavorites.disconnectObject(this);
...
const dots = this._pageIndicators;
...
this._addItem(item, Math.floor(order / this._perPage), order % this._perPage);
...
const {value, page_size: pageSize} = this._adjustment;
```

plus overrides of `_createGrid()`, `_loadApps()`, `_compareItems()` and
`goToPage()`.

**What for.**

- `_box` is added as the view's child, as `AppDisplay` adds it.
- `BaseAppView._init()` connects the parental-controls manager and the dash
  favourites to `_redisplay()`, a diff over every tile built so far. Neither has
  anything to do with games, so both connections are dropped.
- `_pageIndicators` are the page dots. The shell hides them for a single page,
  which re-centres the grid, so the view keeps their room by fading them
  instead.
- `_addItem()` puts a tile at an exact page and position, so the library's
  order stands. Tiles are built a couple of pages ahead of the one showing,
  not all at once.
- `_adjustment` is the scroll view's horizontal adjustment, which says which
  page is showing.
- `_createGrid()` is called from `BaseAppView._init()` and returns the poster
  grid. `_loadApps()` answers any redisplay with the tiles already built, and
  `_compareItems()` keeps the library's order.

**Why nothing public.** None of it is API; it is the class's own working.

**If it changes.** A renamed field makes the view's `_init()` throw at the
first press (previous entry). A renamed hook leaves the override here unused,
and what the shell does instead is unverified.

**Checked.** No.

### Replacing `IconGridLayout.vfunc_allocate()`

`PosterGridLayout`, which `MediaGrid` sets as the grid's `layout_manager`:

```js
vfunc_allocate() {
    if (!this._pageWidth || !this._pageHeight)
        return;
    const first = this._pages[0]?.visibleChildren[0];
    if (!first)
        return;
    ...
    const hGap = this.columnSpacing || GAP * scale;
    const vGap = this.rowSpacing || GAP * scale;
    const {columnsPerPage: columns, rowsPerPage: rows, pagePadding: pad} = this;
    ...
    this._pageSizeChanged = false;
    this._shouldEaseItems = false;
}
```

**What for.** The shell's layout makes every cell a square the size of the
larger side of an icon. Posters are not square, so this replaces the parent's
allocation whole: cells of the tile's own shape, the theme's gap apart, the
block centred on the page, and a part-full last row placed by `grid-align`.
Paging is still the parent's. `_pageWidth`, `_pageHeight` and `_pages` (each
page with its `visibleChildren`) are what the parent's own `vfunc_allocate()`
reads, and the two flags are what it clears at the end.

**Why nothing public.** `IconGridLayout` has no option for cells that are not
square. `columnsPerPage`, `rowsPerPage`, `pagePadding`, `columnSpacing` and
`rowSpacing` are its GObject properties, and are public.

**If it changes.** If the page size or the pages are renamed, the early
returns fire, nothing is allocated, and the pages come up empty.

**Checked.** Yes, silently, by the two early returns.

### `AppViewItem` and `BaseIcon`

```js
class GamesMenuMediaItem extends AppDisplay.AppViewItem {
    _init({item, section, order, onActivate}) {
        super._init({style_class: 'overview-tile'}, false, true);
        this._id = `${section.key}/${item.id}`;
        this._name = item.title;
        ...
        this.icon = new PosterIcon(item.title, {
            setSizeManually: true,
            createIcon: size => createArtwork({...}),
        });
        ...
    }

    get artwork() {
        return this.icon.icon;
    }
}
```

and `PosterIcon`, which extends `IconGrid.BaseIcon` and overrides its two
preferred-size vfuncs.

**What for.** `AppViewItem` is the app grid's tile: the `overview-tile` look,
the focus ring, the hover, and a title that wraps onto a second line while the
tile is hovered or focused. Its arguments are positional: `isDraggable` false,
since a poster is not dragged anywhere, and `expandTitleOnHover` true. `_id`
and `_name` are what its public `id` and `name` getters return, and
`BaseAppView._addItem()` keys its map of items by `id`. `BaseIcon` keeps what
its `createIcon` built as `icon`; that is the artwork the pop-up zooms out of.
`PosterIcon` asks for its child's size rather than a square.

**If it changes.** A change to the positional arguments makes the tiles
draggable, or stops the title wrapping. If `BaseIcon` stops keeping `icon`, the
pop-up zooms out of the whole tile, label and all, because `panel.js`
`_sourceArt()` falls back to the source itself. If `_id` stops being read,
every tile has the same id in the view's map of items, and what that does to
the grid is unverified.

**Checked.** Only the zoom has a fallback; the rest is not checked.

## The button (sectionButtons.js)

### Subclassing `Dash.ShowAppsIcon`

```js
class GamesMenuSectionIcon extends Dash.ShowAppsIcon {
    _init(section) {
        this._section = section;
        super._init();
        this.setLabelText(section.title);
    }

    _createIcon(size) {
        this._iconActor = new St.Icon({icon_name: this._section.icon, ...});
        return this._iconActor;
    }

    _canRemoveApp() {
        return false;
    }
}
```

**What for.** `ShowAppsIcon` is a `DashItemContainer` around a toggle button
with a `BaseIcon` in it, so the dash's sizing, hover, focus and tooltip come
with it. The subclass changes the icon and the label and nothing else.
`ShowAppsIcon` hands `_createIcon()` to its `BaseIcon` as `createIcon`, so
overriding it is the only way to change the icon. `_iconActor` is the field
`setDragApp()` reads. `_canRemoveApp()` answers false because Show Apps is also
the dash's target for unpinning an app, and the button inherits its
`handleDragOver()` and `acceptDrop()`. The class body of `ShowAppsIcon` is the
same at every tag checked, apart from `let` becoming `const` and one
`return GLib.SOURCE_REMOVE`.

**Why nothing public.** No API adds a button to the dash.

**If it changes.** A throw while building the button is caught in `_attach()`
and logged as `[Games Menu] No button beside Show Apps: ...`, and there is no
button. If `_createIcon()` stops being called, the button shows the Show Apps
icon. If `_canRemoveApp()` is renamed, an app dropped on the games button could
be unpinned from the dash. Neither of those is logged.

**Checked.** Partly: a throw logs a warning.

### `Main.overview.dash._dashContainer` and `dash._hookUpLabel()`

`_attach()` and `_attachToDash()`:

```js
else if (Main.overview.dash?._dashContainer)
    this._attachToDash(Main.overview.dash);
...
dash._hookUpLabel?.(container);
dash._dashContainer.add_child(container);
...
dash.connectObject('icon-size-changed', () => { ... dash.iconSize ... }, this);
```

**What for.** `_dashContainer` is the box that holds the app icons' box and
then Show Apps; the button goes in after Show Apps. `_hookUpLabel()` is how the
dash shows an item's label on hover and hides it on a click and when the
overview hides. `iconSize` and `icon-size-changed` are public, and keep the
button the size of the dash's icons.

**Why nothing public.** The dash has no API for adding an item.

**If it changes.** Without `_dashContainer` neither branch of `_attach()` runs,
and there is no button. Without `_hookUpLabel()` the button has no tooltip.

**Checked.** Yes, silently.

### Dash to Panel: `global.dashToPanel`, `panels` and `panels-created`

`attach()`, `_armDashToPanel()` and `_attach()`:

```js
Main.extensionManager.connectObject('extension-state-changed',
    () => this._reattach(), this);
...
dashToPanel.connectObject?.('panels-created', () => this._reattach(), this);
...
const panel = global.dashToPanel?.panels?.[0];
try {
    if (panel?.showAppsIconWrapper && panel.panel && panel._updateGroupedElements)
        this._attachToPanel(panel);
    else if (Main.overview.dash?._dashContainer)
        this._attachToDash(Main.overview.dash);
} catch (e) {
    console.warn(`[Games Menu] No button beside Show Apps: ${e}`);
    this._detach();
}
```

**What for.** Dash to Panel moves Show Apps into its own panel and hides the
overview's dash, unless its `stockgs-keep-dash` setting is on (default off;
`toggleDash()` in its `overview.js`). So the button goes where Show Apps went.

- `global.dashToPanel` is an `EventEmitter` from the shell's `misc/signals.js`,
  which has `connectObject()` at every tag checked. Dash to Panel creates it in
  its `enable()` "to conveniently expose functionalities to other extensions"
  (its `extension.js`).
- Its panel manager sets `panels` and emits `panels-created` every time it
  builds its panels, including on a monitor change, which no extension state
  reflects.
- `panels[0]` is Dash to Panel's primary panel: the manager pushes that one
  first. Only that panel gets a button.
- `extension-state-changed` is the shell's own, public signal. It catches Dash
  to Panel being enabled or disabled after this extension.

**Why nothing public.** Dash to Panel offers `panels` and the signal to other
extensions, but no way to add an element to a panel.

**If it changes.** If `panels`, or any of the three fields tested, goes, the
button falls through to the dash. Dash to Panel hides the dash by default, so
there is no visible button, and nothing in the journal.

**Checked.** Yes, silently.

### Dash to Panel: wrapping `panel._updateGroupedElements()`

`_attachToPanel()`:

```js
const showApps = panel.showAppsIconWrapper.realShowAppsIcon;
...
const stock = panel._updateGroupedElements;
const stockWasOwn = Object.prototype.hasOwnProperty.call(panel, '_updateGroupedElements');
let element = {actor: box, box: new Clutter.ActorBox()};
const wrapper = function (positions) {
    stock.call(this, positions);
    if (!element)
        return;
    for (const group of this._elementGroups ?? []) {
        const at = group.elements.findIndex(e => e.actor === showApps);
        if (at < 0)
            continue;
        element.position = group.elements[at].position;
        group.elements.splice(at + 1, 0, element);
        if (group.expandableIndex > at)
            group.expandableIndex++;
        break;
    }
    box.visible = showApps.visible;
};
...
panel.panel.add_child(box);
panel._updateGroupedElements = wrapper;
panel.updateElementPositions?.();
```

**What for.** Dash to Panel lays out only the elements it knows.
`_updateGroupedElements()` turns its position settings into `_elementGroups`.
Each group is a list of `{actor, box, position}` entries, the shape of its
`allocationMap`, with an `expandableIndex` for the taskbar, and its
`vfunc_allocate()` places them. The wrapper adds one entry, the button's box,
straight after Show Apps's own in the same group, every time the groups are
made. `realShowAppsIcon` is Dash to Panel's own `Dash.ShowAppsIcon`, whose
`icon.iconSize` and `toggleButton` style are copied onto the button so that it
matches. `panel.panel` is the actor the elements are children of, and
`updateElementPositions()` is what Dash to Panel calls to regroup.

**Why nothing public.** As in the previous entry.

**Next to other extensions.** The same rules as the overview wrapper. It is an
own property of the panel, it calls whatever was there, and `release()` takes
it off only while it is still the outermost, by putting back exactly what it
found. Under someone else's wrapper it stays, and does nothing once `element`
is cleared.

**If it changes.** A throw while attaching is caught and logged as above, and
there is no button. If `_elementGroups` or its entries change shape, the box is
a child of the panel that Dash to Panel never places, so it does not show, and
nothing is logged.

**Checked.** Partly: the attach is inside the `try`; the wrapper is silent.

## The pop-ups (panel.js)

The modal library's panel and the detail pop-up are one class, `MediaPanel`.
It is the shell's `AppFolderDialog` rebuilt with the folder taken out: the
shade, the zoom out of the icon, the grab, the click-away and the settle. It
extends `St.Bin` and is built from exported pieces (below) rather than
subclassing `AppFolderDialog`, which needs a folder. Two things are read from
the shell's internals.

### `folderLook()`: what the desktop puts behind a folder

```js
function folderLook() {
    const icons = Main.overview._overview?.controls?._appDisplay?._folderIcons ?? [];
    for (const icon of icons) {
        const dialog = icon._dialog;
        if (!dialog)
            continue;
        const blur = dialog.get_effects().find(e => e instanceof Shell.BlurEffect);
        const classes = (dialog._viewBox?.get_style_class_name() ?? '')
            .split(/\s+/).filter(c => c && c !== 'app-folder-dialog');
        if (blur || classes.length) {
            return {
                blur: blur ? {radius: blur.radius, brightness: blur.brightness} : null,
                classes,
            };
        }
    }
    return null;
}
```

**What for.** Stock GNOME shades the screen behind an open folder. Blur my
Shell replaces that for the folders. It calls `_ensureFolderDialog()` on every
folder icon, adds a `Shell.BlurEffect` named `appfolder-blur` to each
`_dialog`, and adds a style class of its own to each dialog's `_viewBox`
(Blur my Shell 72, `components/appfolders.js`). A pop-up that went on shading
beside those would not look like the folders it copies. So on each open, the
first folder dialog that carries either is read. Its blur's radius and
brightness are matched by a blur of our own, `games-menu-panel-blur`, in place
of the shade, and its extra classes go on our panel, so Blur my Shell's
stylesheet paints both. `_folderIcons` is the app display's list of
`FolderIcon`s, `_dialog` the `AppFolderDialog` each one makes, and `_viewBox`
the dialog's panel.

**Why nothing public.** Neither the shell nor Blur my Shell says what is put
behind a folder. Reading the folders avoids reading Blur my Shell's settings.

**If it changes.** Optional chaining turns a missing link into no folders, and
the pop-ups shade as stock GNOME does. That is right on a desktop without Blur
my Shell, and wrong beside blurred folders. With no folders in the app grid
there is nothing to read, with the same result.

**Checked.** Yes, silently. `controls.appDisplay` is a public getter at every
tag checked, and could replace `controls._appDisplay` here, as `mediaMenu.js`
already uses it.

### `DIALOG_SHADE_NORMAL`, copied

```js
// The shade behind the panel: the shell's DIALOG_SHADE_NORMAL, not exported.
const SHADE = new Cogl.Color({red: 0, green: 0, blue: 0, alpha: 204});
```

The value is the same at every tag checked. If the shell changes it, the
pop-ups shade differently from a folder. Not checked.

## Launching (app.js)

### `Meta.Workspace._keepAliveId`

`_emptyWorkspace()`:

```js
const free = ws => ws && !ws._keepAliveId &&
    !ws.list_windows().some(w => !w.is_on_all_workspaces());
```

**What for.** "Play on a new workspace" moves to an empty workspace before a
game is launched. The shell's workspace tracker sets `_keepAliveId`, a GLib
source id, on a `Meta.Workspace` it is keeping open
(`WorkspaceTracker.keepWorkspaceAlive()` in `windowManager.js`). The shell does
that briefly for a new workspace an app has just been dropped on in the
overview's thumbnails, while the app starts (`workspaceThumbnail.js`). An
extension that holds a workspace for itself may set the same field. Such a
workspace is empty but not free. It is only read here, never set.

**Why nothing public.** `Main.wm.keepWorkspaceAlive()` sets it, but nothing
public reads it back.

**If it changes.** A held workspace looks free, so a game can be launched onto
a workspace another extension has claimed, or one an app is about to open on.
Nothing is logged.

**Checked.** No.

## Public, but worth knowing

- **`Clutter.get_default_backend()`** (controls.js `Controls.enable()`). It is
  removed in mutter 51. `global.stage.context.get_backend()` works on every
  claimed version ([compatibility.md](compatibility.md#remotes-and-controllers-as-keys-controlsjs)).
- **`global.focus_manager.navigate_from_event()`** (panel.js
  `vfunc_key_press_event()`). It is removed in 51, where a focus group moves
  focus itself
  ([compatibility.md](compatibility.md#keyboard-navigation-inside-the-panels-paneljs)).
- **`Main.overview.dash.showAppsButton` and its `checked`** (mediaMenu.js). This
  is what says the app grid is up. `appDisplay.visible` does not: the shell's
  `_updateAppDisplayVisibility()` takes the larger of the two states it is
  moving between, so it stays on for the whole slide down to the window
  picker. The field has no underscore, but nothing documents it. It is read
  without a check in `MediaMenu.enable()`, so if it went, `enable()` would
  throw.
- **`captured-event::key` on `global.stage`** (mediaMenu.js `_force()`), for
  Escape in an overview the button opened. It is a detailed signal at mutter
  `48.0` and `51.0`. The handler checks for `KEY_PRESS` before asking for a key
  symbol, because releases and input-method events carry the same detail.
- **`Main.wm.addKeybinding()` and `removeKeybinding()`** (app.js), with
  `Shell.ActionMode.POPUP` among the modes. This is how the shell grabs its own
  keys from a GSettings key. The shortcut does not appear in GNOME Settings.
- **`Main.modalCount` and `Main.actionMode`** (app.js, mediaMenu.js), which
  keep a controller's Home and the shortcut from acting over someone else's
  popup or overview.
- **Exported shell classes and helpers:** `GrabHelper.GrabHelper` (with
  `Shell.ActionMode.POPUP`, the folder's own mode), `Layout.MonitorConstraint`,
  `Dash.ShowAppsIcon`, `AppDisplay.AppGrid` and `AppViewItem`,
  `IconGrid.IconGridLayout` and `BaseIcon`, `ControlsState`,
  `animationUtils.js` `adjustAnimationTime()` and
  `ensureActorVisibleInScrollView()`, and `Util.spawn()`. They are all at every
  tag checked, with the same shape. But they are the shell's own modules, not an
  API, and can change in any release. At `51.0`, `GrabHelper` takes Escape with
  a `Clutter.KeyController` in the capture phase instead of a `captured-event`
  handler, which does not change how it is called.
- **`Clutter.ClickGesture`** (49 and later) and **`Clutter.ClickAction`** (48)
  for the click-away. Chosen by feature test
  ([compatibility.md](compatibility.md#closing-a-panel-from-the-shade-paneljs)).
- **`Shell.BlurEffect`** (panel.js), with `radius`, `brightness` and
  `Shell.BlurMode.BACKGROUND`, all in `src/shell-blur-effect.h` at `51.0`. An
  effect cannot be eased with `ease()`, so `anim.js` `easeProps()` runs a
  `Clutter.Timeline` of its own, with its duration from
  `adjustAnimationTime()`, as `ease()` takes it.
- **libmanette** is not the shell's. It is optional and loaded on demand; see
  [compatibility.md](compatibility.md#controllers-controlsjs-prefsjs).

## Not shell internals: staging lib/

`extension.js`:

```js
async enable() {
    const enabling = this._enabling = {};
    try {
        const runDir = this._stageLib();
        const module = await import(`file://${runDir}/app.js`);
        if (this._enabling !== enabling)
            return;
        this._app = new module.GamesMenuApp(this);
        this._app.enable();
        console.log(`[Games Menu] Enabled from ${runDir}`);
    } catch (e) {
        console.error('[Games Menu] Failed to load lib/app.js:', e);
    }
}
```

`_stageLib()` copies `lib/*.js` into
`$XDG_RUNTIME_DIR/games-menu/lib-<stamp>/`. The stamp is a SHA-256 of each
file's name, size and modification time. It then deletes every other stage in
that folder, and `enable()` imports from the copy. GJS caches a module by URL
for the life of the shell, so this is how an edit under `lib/` is picked up by
a disable and enable without logging out. An unlock re-enables into the same
stamp, and so into the modules GJS already has.

It is not a shell internal, but a reviewer will ask about it. It is in the zip,
it copies and deletes files synchronously in `enable()`, and it imports code
from outside the extension directory.
[publishing.md](publishing.md#the-development-path-in-extensionjs) has the plan
to move it out of what ships. Two consequences for this page:

- **GType names.** The shell sets `GObject.gtypeNameBasedOnJSPath = true`
  (`ui/environment.js` at every tag checked), so each class's GType name comes
  from its module's path, and each stage registers its classes under new
  names. An unlock reuses the stage and registers nothing. Each edit leaves the
  previous stage's types registered for the life of the shell: one set per
  edit, in development only.
- **Errors.** The `catch` also catches a throw from `GamesMenuApp.enable()`, and
  logs it as a load failure. The shell never sees it, so the extension shows as
  on with nothing built. That is what every "`enable()` throws" above looks
  like.
