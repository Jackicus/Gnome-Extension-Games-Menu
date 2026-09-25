#!/usr/bin/env python3
"""A made-up library for screenshots: `demo_library.py CACHE_HOME`.

Writes CACHE_HOME/games-menu/ exactly as the scanner would — library.json,
with posters and backdrops in its own posters/ and backdrops/ folders at the
cache's own caps — but for games that do not exist, with artwork drawn here.
The README's screenshots are of this rather than of anyone's real library:
nobody's collection goes into a public repo, and nobody's artwork either.

`nested.sh start --demo` runs it and points the nested session's
XDG_CACHE_HOME at the result, so the extension reads it and nothing else.
Every folder inside is under /demo and is never opened, and Play runs
`true`, so a press of it launches nothing.
"""
import json
import math
import os
import random
import sys
import time

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError:
    sys.exit("demo_library.py needs Pillow (python-pillow).")

# The cache's own caps (backend/metadata.py POSTER_BOX, BACKDROP_BOX).
POSTER = (512, 768)
BACKDROP = (960, 540)
FONT = "/usr/share/fonts/Adwaita/AdwaitaSans-Regular.ttf"

# (title, year, rating, genres, palette, motif, minutes played, size MB, summary)
STEAM = [
    ("Starfall Tactics", 2023, 8.6, ["Strategy", "Indie"], ("#0b1d3a", "#ffb703"), "rings", 6347, 5820,
     "Command a patchwork fleet across a collapsing star cluster, one turn at a time. "
     "Every ship you lose stays lost, and every captain remembers who sent them."),
    ("Lantern Keep", 2021, 8.9, ["Action", "Adventure"], ("#1b1b2f", "#e94560"), "moon", 2210, 3140,
     "Relight the beacons of a sunken castle before the dark climbs the stairs to the "
     "village above. A hand-drawn action adventure about a very small knight."),
    ("Tidebreaker", 2020, 7.8, ["Racing", "Sports"], ("#023e8a", "#90e0ef"), "stripes", 845, 12400,
     "Race hydrofoils through storm-lashed archipelagos where the course changes with "
     "the tide. Forty islands, six seasons of weather and a rival who never sleeps."),
    ("Moss & Iron", 2022, 8.2, ["RPG", "Adventure"], ("#1b3022", "#b5c99a"), "peaks", 4120, 21800,
     "A retired automaton tends the forest that grew over the war it was built for — "
     "until the war comes looking for it."),
    ("Neon Courier", 2024, 7.5, ["Action", "Indie"], ("#10002b", "#ff4d9d"), "grid", 312, 2260,
     "Deliver anything, anywhere, across a city that rewires its own streets every "
     "night. Learn the routes, then watch them change."),
    ("Frostline", 2019, 8.0, ["Simulation", "Strategy"], ("#0d1b2a", "#e0fbfc"), "peaks", 1570, 7600,
     "Keep a mountain railway running through the longest winter on record. Plough "
     "the passes, feed the crews and decide which towns the last train reaches."),
    ("Paper Kingdoms", 2021, 8.4, ["Strategy", "Casual"], ("#3d2c2e", "#f2cc8f"), "sun", 980, 1480,
     "Fold, cut and crease your way to an empire on a kitchen table, one paper "
     "province at a time. Mind the teacups."),
    ("Deep Signal", 2023, 8.1, ["Adventure", "Indie"], ("#001219", "#0a9396"), "rings", 58, 4310,
     "A lone diver follows a radio pulse to the bottom of an ocean trench, and "
     "finds that something down there has been answering."),
    ("Clockwork Harvest", 2018, 7.6, ["Simulation", "Casual"], ("#3a2e1f", "#e9c46a"), "sun", 2890, 960,
     "Run a farm where the seasons are wound by hand and the crows keep the accounts. "
     "Grow, trade and oil the sun before it runs down."),
    ("Voidrunners", 2022, 7.9, ["Action", "Massively Multiplayer"], ("#14213d", "#fca311"), "hex", 7420, 38900,
     "Four-player heists on derelict stations where the loot fights back. Plan the "
     "job, crack the vault and argue about the split on the way home."),
    ("Ember Valley", 2020, 8.7, ["RPG", "Indie"], ("#370617", "#f48c06"), "peaks", 3615, 6120,
     "The volcano woke up, the dragons left, and someone has to run the inn. A cosy "
     "role-playing game about rebuilding a valley one neighbour at a time."),
    ("Glass Garden", 2025, 8.3, ["Casual", "Indie"], ("#073b3a", "#8ce99a"), "moon", None, 1210,
     "Grow a garden of light inside a greenhouse built from old stained-glass windows. "
     "No timers, no failure, just colour."),
    ("Orbital Drift", 2017, 7.3, ["Racing", "Sports"], ("#1a1423", "#b8f2e6"), "rings", 125, 9340,
     "Zero-gravity racing around the rings of a gas giant, where the fastest line is "
     "the one that nearly kills you."),
    ("The Quiet Archive", 2024, 8.8, ["Adventure"], ("#212529", "#ffd166"), "pixels", None, 3580,
     "A librarian on the last night of a closing archive finds a book that writes "
     "back. A narrative mystery told across one very long night."),
]

# (title, year, rating, genres, palette, motif, serial, disc format, size MB, summary)
PS2 = [
    ("Dragonglass Saga", 2002, 8.5, ["Role-playing (RPG)"], ("#2b2d42", "#ef8354"), "sun",
     "SLUS-20513", "chd", 2310,
     "Six heroes, one shattered dragon's eye and a world that remembers the last time it "
     "broke. A sprawling role-playing epic across two continents."),
    ("Gridiron Blitz 2004", 2003, 7.4, ["Sport"], ("#003049", "#eae2b7"), "grid",
     "SLUS-20877", "iso", 3890,
     "Arcade football with full-contact tackles, flaming passes and a season mode that "
     "never ends."),
    ("Shadow Temple Chronicles", 2005, 8.1, ["Platform", "Adventure"], ("#132a13", "#90a955"), "moon",
     "SCES-51207", "chd", 1740,
     "Leap, climb and swing through a jungle temple that rearranges itself after dark."),
    ("Thunder Kart Grand Prix", 2003, 7.7, ["Racing"], ("#240046", "#ff9e00"), "stripes",
     "SLUS-20941", "iso", 2980,
     "Twenty karts, sixteen tracks and a weather machine. Split-screen for four."),
]


def rgb(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", size)
    draw = ImageDraw.Draw(img)
    for y in range(h):
        draw.line([(0, y), (w, y)], fill=mix(top, bottom, y / max(1, h - 1)))
    return img


def motif(img, kind, dark, light, seed):
    """The picture on the cover: a shape or two in the palette."""
    w, h = img.size
    rnd = random.Random(seed)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    glow = light + (235,)
    faint = mix(dark, light, 0.35) + (150,)
    if kind == "sun":
        r = w * 0.32
        cx, cy = w * 0.5, h * 0.42
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=glow)
        for i in range(6):
            y = cy + r * 0.2 + i * r * 0.22
            d.rectangle([0, y, w, y + r * 0.08], fill=dark + (255,))
    elif kind == "rings":
        cx, cy = w * 0.5, h * 0.4
        for i in range(9, 0, -1):
            r = w * 0.06 * i
            d.ellipse([cx - r, cy - r, cx + r, cy + r],
                      outline=mix(dark, light, i / 9) + (255,), width=max(3, w // 90))
    elif kind == "peaks":
        base = h * 0.72
        for i in range(4):
            x = rnd.uniform(-0.2, 0.9) * w
            peak = rnd.uniform(0.25, 0.5) * h
            width = rnd.uniform(0.5, 0.9) * w
            colour = mix(dark, light, 0.25 + i * 0.18) + (255,)
            d.polygon([(x, base), (x + width / 2, peak), (x + width, base)], fill=colour)
        d.rectangle([0, base, w, h], fill=dark + (255,))
        d.ellipse([w * 0.66, h * 0.12, w * 0.8, h * 0.12 + w * 0.14], fill=glow)
    elif kind == "stripes":
        step = w // 7
        for i in range(-8, 16):
            x = i * step
            colour = (glow if i % 3 == 0 else faint)
            d.polygon([(x, 0), (x + step * 0.45, 0), (x + step * 0.45 - h * 0.6, h), (x - h * 0.6, h)],
                      fill=colour)
    elif kind == "moon":
        r = w * 0.26
        cx, cy = w * 0.55, h * 0.33
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=glow)
        # Drawing replaces rather than blends, so a clear disc cuts the crescent.
        d.ellipse([cx - r * 0.55, cy - r * 1.05, cx + r * 1.35, cy + r * 0.85], fill=(0, 0, 0, 0))
        for _ in range(60):
            x, y = rnd.uniform(0, w), rnd.uniform(0, h * 0.7)
            s = rnd.uniform(1, 3)
            d.ellipse([x, y, x + s, y + s], fill=light + (200,))
    elif kind == "grid":
        gap = w / 9
        for gx in range(10):
            for gy in range(12):
                x, y = gx * gap, gy * gap
                dist = math.hypot(x - w * 0.5, y - h * 0.4) / w
                s = max(2, gap * 0.45 * (1 - dist))
                d.ellipse([x - s / 2, y - s / 2, x + s / 2, y + s / 2], fill=mix(dark, light, 1 - dist) + (255,))
    elif kind == "hex":
        r = w / 10
        for row in range(-1, int(h / (r * 1.5)) + 2):
            for col in range(-1, int(w / (r * 1.73)) + 2):
                cx = col * r * 1.73 + (row % 2) * r * 0.87
                cy = row * r * 1.5
                dist = min(1, math.hypot(cx - w * 0.5, cy - h * 0.38) / (w * 0.75))
                points = [(cx + r * 0.9 * math.cos(math.pi / 6 + k * math.pi / 3),
                           cy + r * 0.9 * math.sin(math.pi / 6 + k * math.pi / 3)) for k in range(6)]
                d.polygon(points, outline=mix(light, dark, dist) + (255,), width=max(2, w // 120))
    elif kind == "pixels":
        cell = w // 16
        for gx in range(16):
            for gy in range(int(h * 0.7) // cell):
                if rnd.random() < 0.55 - gy * 0.03:
                    colour = mix(dark, light, rnd.uniform(0.3, 1)) + (255,)
                    d.rectangle([gx * cell + 2, gy * cell + 2, (gx + 1) * cell - 2, (gy + 1) * cell - 2],
                                fill=colour)
    img.paste(layer, (0, 0), layer)
    return img


def font(size):
    try:
        face = ImageFont.truetype(FONT, size)
        try:
            face.set_variation_by_name("Black")
        except Exception:
            pass
        return face
    except OSError:
        return ImageFont.load_default(size)


def wrap(draw, text, face, width):
    words, lines, line = text.upper().split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=face) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def poster(path, title, label, palette, kind, seed):
    dark, light = rgb(palette[0]), rgb(palette[1])
    img = gradient(POSTER, dark, mix(dark, light, 0.35))
    img = motif(img, kind, dark, light, seed)
    # A darker foot for the title to stand on.
    foot = gradient((POSTER[0], POSTER[1] // 3), dark, mix(dark, (0, 0, 0), 0.5))
    mask = gradient((POSTER[0], POSTER[1] // 3), (0, 0, 0), (255, 255, 255)).convert("L")
    img.paste(foot, (0, POSTER[1] - POSTER[1] // 3), mask)
    draw = ImageDraw.Draw(img)
    # As large as the longest word allows.
    width = POSTER[0] - 64
    size = 58
    face = font(size)
    while size > 30 and max(draw.textlength(w, font=face) for w in title.upper().split()) > width:
        size -= 4
        face = font(size)
    lines = wrap(draw, title, face, width)
    step = round(size * 1.1)
    y = POSTER[1] - 70 - step * len(lines)
    for line in lines:
        x = (POSTER[0] - draw.textlength(line, font=face)) / 2
        draw.text((x, y), line, font=face, fill=(250, 250, 251))
        y += step
    small = font(24)
    draw.text(((POSTER[0] - draw.textlength(label, font=small)) / 2, POSTER[1] - 52),
              label, font=small, fill=mix(light, (250, 250, 251), 0.5))
    img.save(path, "JPEG", quality=88)


def backdrop(path, palette, kind, seed):
    dark, light = rgb(palette[0]), rgb(palette[1])
    img = gradient(BACKDROP, dark, mix(dark, light, 0.3))
    img = motif(img, kind, dark, light, seed).filter(ImageFilter.GaussianBlur(6))
    img.save(path, "JPEG", quality=85)


def slug(text):
    return "".join(c.lower() if c.isalnum() else "-" for c in text).strip("-")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = os.path.join(os.path.abspath(sys.argv[1]), "games-menu")
    posters = os.path.join(root, "posters")
    backdrops = os.path.join(root, "backdrops")
    for folder in (posters, backdrops):
        os.makedirs(folder, exist_ok=True)

    steam = []
    for n, (title, year, rating, genres, palette, kind, played, size, summary) in enumerate(STEAM):
        appid = 3100000 + n * 1370
        poster_path = os.path.join(posters, f"steam_{appid}.jpg")
        backdrop_path = os.path.join(backdrops, f"steam_{appid}.jpg")
        poster(poster_path, title, str(year), palette, kind, n)
        backdrop(backdrop_path, palette, kind, n)
        steam.append({
            "id": f"steam_{appid}", "kind": "game", "title": title, "platform": "steam",
            "year": year, "folder_path": f"/demo/SteamLibrary/steamapps/common/{title}",
            "launch": ["true"], "poster_path": poster_path, "backdrop_path": backdrop_path,
            "summary": summary, "genres": genres, "rating": rating,
            "playtime_minutes": played, "last_played": None, "app_id": str(appid),
            "steam_root": "/demo/Steam", "size_mb": size, "provider": "demo",
        })

    ps2 = []
    for n, (title, year, rating, genres, palette, kind, serial, fmt, size, summary) in enumerate(PS2):
        key = slug(title)
        poster_path = os.path.join(posters, f"ps2_{key}.jpg")
        poster(poster_path, title, "PlayStation 2", palette, kind, 100 + n)
        disc = f"/demo/PS2/{title} ({serial}).{fmt}"
        ps2.append({
            "id": f"ps2_{key}", "kind": "game", "title": title, "platform": "ps2",
            "year": year, "folder_path": "/demo/PS2", "launch": ["true"],
            "poster_path": poster_path, "backdrop_path": None,
            "summary": summary, "genres": genres, "rating": rating,
            "playtime_minutes": None, "serial": serial, "disc_path": disc,
            "disc_format": fmt, "size_mb": size, "provider": "demo",
        })

    # Steam first, then PS2, each by title, as the scanner orders them.
    games = sorted(steam, key=lambda g: g["title"].lower()) + sorted(ps2, key=lambda g: g["title"].lower())
    library = {
        "version": 1,
        "generated": time.time(),
        "sections": {"games": games},
        "scanned": {"games": {"path": "demo", "count": len(games),
                              "steam": len(steam), "ps2": len(ps2)}},
    }
    with open(os.path.join(root, "library.json"), "w") as f:
        json.dump(library, f, indent=1)
    print(root)


if __name__ == "__main__":
    main()
