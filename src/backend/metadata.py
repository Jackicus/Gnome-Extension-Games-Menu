"""Online metadata and artwork, cached under ~/.cache/games-menu.

Sources, an ordered list in the preferences:

  steam   keyless: Valve's store record and library art, for Steam apps
  igdb    Twitch client id/secret: covers, synopses and ratings, for PS2 discs

A game's source is decided by the game rather than by the list: a Steam app has
its own keyless store record and artwork CDN, and a PS2 disc image has neither,
so it falls to IGDB when the Twitch credentials are set and to the drawn
placeholder when they are not. The list still decides which IGDB credential
is tried first, and a source whose credential is not set skips itself rather
than failing, which is why IGDB can sit in the default list unkeyed.

A source entry is a name, optionally with a credential slot — "igdb" is the
same as "igdb@1", "igdb@2" is a second IGDB key to fall back to. Credentials
arrive from the preferences (the `credentials` setting, read by
scan_library.py) or, for a standalone run, from the environment
(GAMES_MENU_IGDB_CLIENT_ID, GAMES_MENU_IGDB_CLIENT_SECRET). Neither is ever
argv, so they do not show up in `ps`.

Everything degrades to "no metadata" on failure: the UI draws a placeholder
tile from the title when poster_path is null, so nothing is ever generated on
disk for a lookup that failed.

Every artwork path this module hands back is a file inside the cache, scaled to
the size the desktop draws it at. Both halves of that matter: St decodes an
image at its full resolution on the compositor thread and keeps the decoded
copy, so a Steam hero at 3840 pixels wide costs tens of megabytes to draw a
dimmed backdrop, and a path outside the cache is a path into someone else's
folder — Steam's cache, PCSX2's covers, a disc folder that may be a network
mount where a single read stalls the whole desktop for seconds.
"""

import hashlib
import html
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

CACHE_DIR = os.path.expanduser("~/.cache/games-menu")
POSTER_CACHE_DIR = os.path.join(CACHE_DIR, "posters")
BACKDROP_CACHE_DIR = os.path.join(CACHE_DIR, "backdrops")
METADATA_CACHE_DIR = os.path.join(CACHE_DIR, "metadata")
# One file for every cached record.
METADATA_INDEX = os.path.join(METADATA_CACHE_DIR, "index.json")
# The index is rewritten this often as well as at the end, so a scan that is
# interrupted loses at most this many freshly fetched records (never artwork,
# which is on disk the moment it lands).
INDEX_FLUSH_EVERY = 25
USER_AGENT = "GamesMenu/1.0"

# The largest the desktop ever draws each kind of artwork, doubled where a
# HiDPI monitor would ask for twice the pixels, and no further — everything
# above this is memory the compositor holds and never uses.
#   poster    a 320px grid tile (mediaGrid.js iconSize, floored by MIN_ART) at
#             scale 2, and the 560px detail hero (detailView.js
#             HERO_MAX_HEIGHT) at scale 1
#   backdrop  the detail pane's own backing, dimmed under a veil
POSTER_BOX = (512, 768)
BACKDROP_BOX = (960, 540)
ART_CACHES = (
    (POSTER_CACHE_DIR, POSTER_BOX),
    (BACKDROP_CACHE_DIR, BACKDROP_BOX),
)
# Remembers the caps the cache was last swept to; see fit_cached_art.
ART_FIT_STAMP = os.path.join(CACHE_DIR, "art-fit.json")

# Steam publishes the same library art the client caches, keyless and sessionless.
STEAM_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps"
STEAM_STORE_API = "https://store.steampowered.com/api/appdetails"

# IGDB is a Twitch property: the client id/secret pair is exchanged for an app
# access token, which is then sent as a bearer alongside the Client-ID header.
IGDB_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_API = "https://api.igdb.com/v4"
IGDB_IMAGE = "https://images.igdb.com/igdb/image/upload"
IGDB_PS2_PLATFORM = 8

# Every source there is, and the list used when nothing was passed in — a
# standalone run with no preferences to read. It matches the schema's default.
PROVIDERS = ("steam", "igdb")
DEFAULT_SOURCES = ("steam", "igdb@1")
# How many fields a source's credential is made of; absent means it needs none.
# Must match the `fields` each source declares in prefs.js.
CREDENTIAL_FIELDS = {"igdb": 2}
# Fields of one credential are tab-separated, as the `credentials` setting
# stores them.
FIELD_SEP = "\t"
CACHED_FIELDS = ("summary", "genres", "rating", "year")


def source_id(entry):
    """The source a list entry names. "igdb@2" is IGDB with its second key."""
    return entry.split("@", 1)[0]


def normalise_entry(entry):
    """A list entry with its credential slot spelled out.

    "igdb" and "igdb@1" are the same first IGDB key; a source that takes no
    credential never carries a slot at all. Doing this once, on the way in,
    is what lets everything below look a credential up by the entry itself.
    """
    name = source_id(entry)
    if not CREDENTIAL_FIELDS.get(name):
        return name
    return entry if "@" in entry else f"{name}@1"


def path_key(path):
    """A short, stable, filesystem-safe name for a path: what a cached copy
    of the file there is called, and what a disc image's id is made from."""
    return hashlib.sha1(path.encode("utf-8", "surrogateescape")).hexdigest()[:20]


# source -> the call that asks it. One table rather than one built per item:
# enrich runs once per game, and a library can be hundreds of them.
_LOOKUPS = {
    "steam": lambda svc, item, entry: svc._steam(item),
    "igdb": lambda svc, item, entry: svc._igdb(item, entry),
}

for _d in (POSTER_CACHE_DIR, BACKDROP_CACHE_DIR, METADATA_CACHE_DIR):
    os.makedirs(_d, exist_ok=True)


# --------------------------------------------------------------------------
# Scaling
# --------------------------------------------------------------------------
_SCALER = "?"


def _scaler():
    """(name, module) of whatever can scale an image here, or None.

    Pillow if it happens to be installed, otherwise GdkPixbuf, which is already
    on any machine running GNOME. Resolved once: every item on the pool asks.
    """
    global _SCALER
    if _SCALER == "?":
        try:
            from PIL import Image
            _SCALER = ("pil", Image)
        except ImportError:
            try:
                import gi
                gi.require_version("GdkPixbuf", "2.0")
                from gi.repository import GdkPixbuf
                _SCALER = ("pixbuf", GdkPixbuf)
            except (ImportError, ValueError):
                _SCALER = None
    return _SCALER


def image_size(path):
    """(width, height) read from the file's header, without decoding it."""
    scaler = _scaler()
    if scaler is None:
        return None
    kind, module = scaler
    try:
        if kind == "pil":
            with module.open(path) as img:
                return img.size
        fmt, width, height = module.Pixbuf.get_file_info(path)
        return (width, height) if fmt else None
    except Exception:
        return None


def fit_image(src, box, dest=None):
    """Write `src` into `dest`, or over itself, no larger than `box`.

    Aspect is kept and a small image is never blown up: the point is to stop the
    shell decoding artwork at a resolution it will not draw, not to make
    anything sharper. JPEG stays JPEG at quality 88; anything carrying an alpha
    channel is written as PNG, so a transparent cover does not gain a black
    backing — and with a `dest` it takes the .png name to match, which is why
    the path written is returned rather than assumed. The file is put in place
    with a rename, since the shell may be reading the old one.

    Returns None when nothing here can scale an image, which is the caller's cue
    that there is no artwork rather than an invitation to use the original.
    """
    scaler = _scaler()
    size = image_size(src)
    if scaler is None or size is None:
        return None
    kind, module = scaler
    scale = min(1.0, box[0] / size[0], box[1] / size[1])
    if dest is None and scale == 1.0:
        return src  # already within the box: leave the file untouched
    out = dest or src
    tmp = f"{out}.tmp"
    try:
        if kind == "pil":
            from PIL import ImageOps
            img = module.open(src)
            # JPEG can decode straight to a smaller size instead of paying for
            # the full original and then throwing most of it away; the box is
            # squared so a 90-degree EXIF rotation still decodes the long side
            # at full size. Must come before exif_transpose, which loads the
            # image and makes draft() a no-op from then on.
            img.draft("RGB", (max(box), max(box)))
            img = ImageOps.exif_transpose(img)
            img.thumbnail(box, module.LANCZOS)  # keeps aspect, never enlarges
            if img.mode in ("RGBA", "LA") or "transparency" in img.info:
                out = _png_name(out, dest)
                img.save(tmp, "PNG")
            else:
                img.convert("RGB").save(tmp, "JPEG", quality=88)
        else:
            if scale < 1.0:
                pb = module.Pixbuf.new_from_file_at_scale(
                    src, max(1, round(size[0] * scale)), max(1, round(size[1] * scale)), True)
            else:
                pb = module.Pixbuf.new_from_file(src)
            pb = pb.apply_embedded_orientation() or pb
            if pb.get_has_alpha():
                out = _png_name(out, dest)
                pb.savev(tmp, "png", [], [])
            else:
                pb.savev(tmp, "jpeg", ["quality"], ["88"])
        os.replace(tmp, out)
        return out
    except Exception as e:
        print(f"Could not scale {src}: {e}")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None


def _png_name(out, dest):
    """A fresh copy switches to .png for alpha; a file rewritten in place keeps
    the name library.json already points at, whatever is inside it."""
    return f"{os.path.splitext(out)[0]}.png" if dest else out


def _cached_copy(dest):
    """The copy already written for `dest`, under either extension."""
    for path in (dest, f"{os.path.splitext(dest)[0]}.png"):
        if os.path.exists(path):
            return path
    return None


def cache_local_art(path, kind="poster"):
    """A scaled copy, inside the cache, of artwork that lives outside it.

    Steam's own library cache, PCSX2's covers folder: handing either of those
    to the shell puts a read of someone else's folder on the compositor thread,
    and a covers folder kept beside the discs may be an automount where one
    read blocks for ten seconds. The copy is named after the source path and
    its mtime, so it is written once and rewritten only when the file behind it
    changes. Getting that mtime is itself a stat of that folder, which is fine
    out here — the scanner has just walked it.
    """
    if not path:
        return None
    directory, box = (BACKDROP_CACHE_DIR, BACKDROP_BOX) if kind == "backdrop" else (POSTER_CACHE_DIR, POSTER_BOX)
    try:
        mtime = int(os.path.getmtime(path))
    except OSError:
        return None
    dest = os.path.join(directory, f"local_{path_key(path)}_{mtime}.jpg")
    return _cached_copy(dest) or fit_image(path, box, dest)


def fit_cached_art():
    """Shrink cached artwork to the caps above, when the caps have changed.

    Everything written is fitted as it is written, so this is only for what is
    already on disk from before a change to POSTER_BOX or BACKDROP_BOX — and
    reading one file's dimensions costs about as much as opening it, which is
    too much to pay per poster on every scan. So the caps are stamped beside
    the cache and the sweep is skipped until they change. Nothing is refetched:
    the files are rewritten from themselves.
    """
    caps = {os.path.basename(directory): list(box) for directory, box in ART_CACHES}
    try:
        with open(ART_FIT_STAMP, "r", encoding="utf-8") as f:
            if json.load(f) == caps:
                return 0
    except (OSError, ValueError):
        pass
    fitted = 0
    for directory, box in ART_CACHES:
        for name in sorted(os.listdir(directory)):
            path = os.path.join(directory, name)
            size = image_size(path)
            if size and (size[0] > box[0] or size[1] > box[1]) and fit_image(path, box):
                fitted += 1
    try:
        with open(ART_FIT_STAMP, "w", encoding="utf-8") as f:
            json.dump(caps, f)
    except OSError:
        pass  # the sweep simply runs again next time
    return fitted


def prune_art(sections):
    """Delete cached artwork nothing in the library points at any more.

    Posters and backdrops are orphaned by games that were uninstalled, and a
    local copy carries its source's mtime in its name, so a cover that changed
    leaves the previous copy behind for good. `sections` must be the whole
    library that was just written, so this belongs inside the scan lock,
    beside the write.
    """
    keep = set()
    for items in sections.values():
        for item in items or []:
            keep.update(p for p in (item.get("poster_path"), item.get("backdrop_path")) if p)
    removed = 0
    for directory, _box in ART_CACHES:
        for name in os.listdir(directory):
            path = os.path.join(directory, name)
            if path in keep or not os.path.isfile(path):
                continue
            try:
                os.remove(path)
                removed += 1
            except OSError:
                pass
    return removed


def _fetch(url, timeout, data=None, headers=None):
    """GET with a polite retry: servers answer bursts with 429.

    Passing `data` makes it a POST, which is the only way to talk to IGDB: it
    speaks Apicalypse, a query language sent as the request body.
    """
    req = urllib.request.Request(
        url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})}
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))


def _get_json(url, timeout=6):
    return json.loads(_fetch(url, timeout).decode("utf-8"))


def _download(url, dest, box, timeout=10):
    """Fetch artwork and leave it no larger than the desktop will draw it.

    Several sources only publish the full-resolution original, so the shrink
    after the download is the guarantee rather than the fallback.
    """
    data = _fetch(url, timeout)
    with open(dest, "wb") as f:
        f.write(data)
    fit_image(dest, box)
    return dest


def _strip_html(text):
    """Tags out, entities decoded — the store hands back both (`<p>`, `&quot;`)."""
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip() or None


def clean_query(title):
    """Turn a disc image's cleaned title into a search term.

    'Final Fantasy X (2001)' -> 'Final Fantasy X';
    'Ratchet - Deadlocked' -> 'Ratchet: Deadlocked'.
    """
    q = re.sub(r"\s*[\(\[]\d{4}[\)\]]", "", title)
    return q.replace(" - ", ": ").strip()


class MetadataService:
    """Enrichment for one scan. `enrich` is called from a worker pool, so every
    piece of shared state below it — the record index, the IGDB token, the
    one-shot warning — is taken under `_lock`."""

    def __init__(self, online=True, sources=None, credentials=None):
        self.online = online
        listed = DEFAULT_SOURCES if sources is None else sources
        self.sources = tuple(normalise_entry(e) for e in listed if source_id(e) in PROVIDERS)
        self._credentials = dict(credentials or {})
        # Slot 1 of each service falls back to the environment, which is how a
        # standalone run (no preferences to read) is given a key.
        self._env_credentials = {
            "igdb": FIELD_SEP.join((
                (os.environ.get("GAMES_MENU_IGDB_CLIENT_ID") or "").strip(),
                (os.environ.get("GAMES_MENU_IGDB_CLIENT_SECRET") or "").strip(),
            )),
        }
        self._igdb_tokens = {}        # slot -> (value, expiry); one per credential per run
        self._warned = set()          # source names already complained about
        self._lock = threading.Lock()
        self._igdb_lock = threading.Lock()
        self._index = self._load_index()
        self._unflushed = 0

    # -- sources ---------------------------------------------------------
    def credential(self, entry):
        """One source entry's credential, split into its fields."""
        raw = self._credentials.get(entry)
        if not raw and entry.endswith("@1"):
            raw = self._env_credentials.get(source_id(entry))
        fields = CREDENTIAL_FIELDS.get(source_id(entry), 0)
        parts = (raw or "").split(FIELD_SEP)
        return [(parts[i] if i < len(parts) else "").strip() for i in range(fields)]

    def _usable(self, entry):
        """Whether this entry can run at all. A source whose credential is
        missing skips itself, which is what lets IGDB sit unkeyed in the
        default list rather than being an error."""
        if not CREDENTIAL_FIELDS.get(source_id(entry)):
            return True
        if all(self.credential(entry)):
            return True
        name = source_id(entry)
        with self._lock:
            warn = name not in self._warned
            self._warned.add(name)
        if warn:
            print(f"{name}: no credential set, skipping it wherever it is listed.")
        return False

    def sources_for(self, item):
        """The sources that may answer for one game, in the order they are tried.

        Decided by the game rather than by the order: a Steam app has a store
        record and an artwork CDN of its own, and a PS2 disc image has neither,
        so only IGDB can know it. The list still says which IGDB credential is
        reached for first.
        """
        want = "steam" if item.get("platform") == "steam" else "igdb"
        return [e for e in self.sources if source_id(e) == want and self._usable(e)]

    # -- cache helpers ---------------------------------------------------
    def _load_index(self):
        try:
            with open(METADATA_INDEX, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _paths(self, item):
        safe = re.sub(r"[^a-zA-Z0-9_]", "", f"game_{item['id']}")
        return (
            safe,
            os.path.join(POSTER_CACHE_DIR, f"{safe}.jpg"),
            os.path.join(BACKDROP_CACHE_DIR, f"{safe}.jpg"),
        )

    def _apply_cached(self, item, provider, key, poster_file, backdrop_file):
        with self._lock:
            data = self._index.get(key)
        # A changed provider means fetch afresh.
        if not isinstance(data, dict) or data.get("provider") != provider:
            return False
        for field in CACHED_FIELDS:
            if data.get(field) is not None and item.get(field) in (None, [], ""):
                item[field] = data[field]
        if not item.get("poster_path"):
            if not os.path.exists(poster_file):
                return False  # text was cached but the artwork never arrived: retry
            item["poster_path"] = poster_file
        if not item.get("backdrop_path") and os.path.exists(backdrop_file):
            item["backdrop_path"] = backdrop_file
        item["provider"] = provider
        return True

    def _save(self, item, provider, key):
        record = {field: item.get(field) for field in CACHED_FIELDS}
        record["genres"] = item.get("genres") or []
        record["provider"] = provider
        with self._lock:
            self._index[key] = record
            self._unflushed += 1
            due = self._unflushed >= INDEX_FLUSH_EVERY
        if due:
            self.flush()

    def flush(self):
        """Write the record index out. Atomic, so a scan killed mid-write
        leaves the previous index rather than a truncated one."""
        with self._lock:
            if not self._unflushed:
                return
            snapshot = dict(self._index)
            self._unflushed = 0
        tmp = f"{METADATA_INDEX}.tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(snapshot, f, indent=1)
            os.replace(tmp, METADATA_INDEX)
        except OSError as e:
            print(f"Could not write the metadata index: {e}")

    # -- public ----------------------------------------------------------
    def enrich(self, item):
        """Fill summary/genres/rating/artwork in place, from cache or online.

        The game's sources are tried in order until one comes back with the
        artwork. A source that knows the facts but has no poster leaves the
        next one to try for one — it has already written what it knew into the
        item, and whatever answers last overwrites it — so a list is worth
        arranging richest-first.
        """
        entries = self.sources_for(item)
        if not entries:
            return
        key, poster_file, backdrop_file = self._paths(item)
        # A cached record was written by one source; any entry naming that
        # source is still the answer, wherever it now sits in the order.
        for entry in entries:
            if self._apply_cached(item, source_id(entry), key, poster_file, backdrop_file):
                return
        if not self.online:
            return

        answered = None
        for entry in entries:
            name = source_id(entry)
            lookup = _LOOKUPS.get(name)
            if lookup is None:
                continue
            try:
                art = lookup(self, item, entry)
            except Exception as e:  # network errors, odd JSON, anything
                print(f"{name} lookup failed for '{item['title']}': {e}")
                continue
            if not art:  # nothing found here; the next source gets its turn
                continue

            answered = name
            if art.get("poster") and not item.get("poster_path"):
                try:
                    item["poster_path"] = _download(art["poster"], poster_file, POSTER_BOX)
                except Exception as e:
                    print(f"Artwork download failed for '{item['title']}': {e}")
            if art.get("backdrop") and not item.get("backdrop_path"):
                try:
                    item["backdrop_path"] = _download(art["backdrop"], backdrop_file, BACKDROP_BOX)
                except Exception as e:
                    print(f"Backdrop download failed for '{item['title']}': {e}")
            if item.get("poster_path"):
                break

        if answered:
            item["provider"] = answered
            self._save(item, answered, key)

    # -- providers -------------------------------------------------------
    def _steam(self, item):
        """A Steam app, from Valve's own keyless endpoints.

        The store record (synopsis, genres, release year, Metacritic score) and
        the library art come from two different hosts, and neither takes a key
        or a session. Artwork is only asked for when the local client has not
        already cached it: the scanner fills poster_path/backdrop_path from
        appcache/librarycache first, and that cache is lazy — the client
        downloads only what it has had to draw — so the CDN covers the rest.
        """
        appid = str(item.get("app_id") or "").strip()
        if not appid:
            return None

        try:
            record = _get_json(f"{STEAM_STORE_API}?appids={appid}&l=english", timeout=8).get(appid) or {}
        except Exception as e:
            print(f"Steam store lookup failed for '{item['title']}': {e}")
            record = {}
        data = record.get("data") or {} if record.get("success") else {}
        if data:
            item["summary"] = _strip_html(data.get("short_description") or data.get("about_the_game"))
            item["genres"] = [g["description"] for g in data.get("genres") or [] if g.get("description")]
            score = (data.get("metacritic") or {}).get("score")
            # Ratings are out of 10 everywhere here; Metacritic rates out of 100.
            item["rating"] = round(score / 10, 1) if score else None
            released = (data.get("release_date") or {}).get("date") or ""
            year = re.search(r"\b(\d{4})\b", released)
            if not item.get("year") and year:
                item["year"] = int(year.group(1))

        art = {}
        if not item.get("poster_path"):
            art["poster"] = f"{STEAM_CDN}/{appid}/library_600x900.jpg"
        if not item.get("backdrop_path"):
            art["backdrop"] = f"{STEAM_CDN}/{appid}/library_hero.jpg"
        return art

    def _igdb_access_token(self, entry):
        """The Twitch app access token for one credential slot, minted once per run.

        Tokens are good for weeks, so one scan needs exactly one per slot. The
        lock is held across the exchange as well as the check, so a pool of
        workers all reaching PS2 games at once still mints a single token
        between them. None on any failure — an unreachable IGDB must leave the
        PS2 games with the drawn placeholder, not stop the scan.
        """
        with self._igdb_lock:
            return self._igdb_access_token_locked(entry)

    def _igdb_access_token_locked(self, entry):
        held = self._igdb_tokens.get(entry)
        if held and time.time() < held[1]:
            return held[0]
        client_id, client_secret = self.credential(entry)
        params = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "client_credentials",
        })
        try:
            data = json.loads(_fetch(f"{IGDB_TOKEN_URL}?{params}", 10, data=b"").decode("utf-8"))
        except Exception as e:
            print(f"IGDB authentication failed: {e}")  # never the credentials themselves
            return None
        value = data.get("access_token")
        if not value:
            return None
        # A minute of headroom, so a token cannot expire mid-request.
        self._igdb_tokens[entry] = (
            value, time.time() + max(0, int(data.get("expires_in") or 3600) - 60))
        return value

    def _igdb(self, item, entry):
        """A PS2 game from IGDB: cover, synopsis, genres, rating and year.

        IGDB speaks Apicalypse — one POST body, one round trip for the whole
        record. The search is pinned to the PlayStation 2 platform so a
        remake on another console cannot outrank the disc actually on disk.
        """
        token = self._igdb_access_token(entry)
        if not token:
            return None
        query = clean_query(item["title"]).replace('"', "")
        body = (
            f'search "{query}"; '
            "fields name,summary,storyline,first_release_date,total_rating,genres.name,"
            "cover.image_id,artworks.image_id,screenshots.image_id; "
            f"where platforms = ({IGDB_PS2_PLATFORM}); limit 5;"
        )
        raw = _fetch(
            f"{IGDB_API}/games", 10,
            data=body.encode("utf-8"),
            headers={
                "Client-ID": self.credential(entry)[0],
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
        )
        results = json.loads(raw.decode("utf-8")) or []
        if not results:
            return None

        best = results[0]
        item["summary"] = best.get("summary") or best.get("storyline") or None
        item["genres"] = [g["name"] for g in best.get("genres") or [] if g.get("name")]
        rating = best.get("total_rating")
        item["rating"] = round(rating / 10, 1) if rating else None
        released = best.get("first_release_date")
        if not item.get("year") and released:
            item["year"] = int(time.strftime("%Y", time.gmtime(released)))

        cover = (best.get("cover") or {}).get("image_id")
        wide = next(
            (w.get("image_id") for w in (best.get("artworks") or []) + (best.get("screenshots") or []) if w.get("image_id")),
            None,
        )
        return {
            "poster": f"{IGDB_IMAGE}/t_cover_big/{cover}.jpg" if cover else None,
            "backdrop": f"{IGDB_IMAGE}/t_1080p/{wide}.jpg" if wide else None,
        }
