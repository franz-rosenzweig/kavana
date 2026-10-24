"""Kavana icon, round 2, take C: the night window. python3 gen.py <round>

The end of a focus block: the sky in the round window has gone to night, a few stars, and Miso on
the sill seen from behind, bigger than in round 1. Drafts go to drafts/, finals to this folder.
"""
import math, os, sys
sys.path.insert(0, "/srv/dev/daf/design/icon")
import kit

HERE = "/srv/dev/kavana/design/icon/r2/C/"
DRAFTS = HERE + "drafts/"
os.makedirs(DRAFTS, exist_ok=True)

WALL = ("#FDF5E8", "#F5E4CB")
FRAME = "#FFF8EE"
SILL_SHADE = "#E6CFAC"
MISO = "#EEA45C"
STAR = "#FFF1CF"


# ---------- the cat: one path, mirrored halves (from round 1's window, gen.py v9) ----------
def _segs(start, segs):
    out, a = [], start
    for s in segs:
        if s[0] == "L":
            out.append((a, a, s[1], s[1])); a = s[1]
        else:
            out.append((a, s[0], s[1], s[2])); a = s[2]
    return out

def _mir(segs):
    f = lambda p: (-p[0], p[1])
    return [tuple(f(p) for p in s) for s in segs]

def _rev(segs):
    return [(s[3], s[2], s[1], s[0]) for s in reversed(segs)]

def _tf(segs, scale, tilt, c=(0, -232)):
    a = math.radians(tilt); ca, sa = math.cos(a), math.sin(a)
    def t(p):
        x, y = (p[0] - c[0]) * scale, (p[1] - c[1]) * scale
        return (c[0] + x * ca - y * sa, c[1] + x * sa + y * ca)
    return [tuple(t(p) for p in s) for s in segs]

def _d(segs):
    f = lambda p: f"{p[0]:.1f},{p[1]:.1f}"
    d = "M" + f(segs[0][0])
    for s in segs:
        d += f" C{f(s[1])} {f(s[2])} {f(s[3])}"
    return d + " Z"

BODY = [
    ("L", (104, 0)),
    ((136, 0), (150, -30), (144, -68)),       # haunch
    ((139, -100), (116, -120), (102, -142)),  # top of the haunch, curving in
    ((92, -158), (82, -180), (78, -204)),     # back up to the neck
]
HEAD_V9 = [
    ((76, -216), (90, -232), (94, -256)),     # the neck curving out into the cheek
    ((97, -278), (92, -296), (87, -306)),     # the skull curving in to the ear
    ((81, -318), (71, -352), (63, -375)),     # back of the ear
    ((60, -384), (52, -385), (47, -379)),     # ear tip, rounded
    ((39, -364), (30, -348), (21, -337)),     # ear, inner edge
    ((14, -340), (7, -341), (0, -341)),       # crown
]

def cat_path(head_scale=1.22, tilt=-3.0, body=BODY, head=HEAD_V9, smooth=0.0):
    rb = _segs((0, 0), body)
    N = rb[-1][3]
    rh = _segs(N, head)
    lb, lh = _mir(rb), _mir(rh)
    def tf(segs):
        out = _tf(segs, head_scale, tilt)
        out[0] = (segs[0][0],) + out[0][1:]
        if smooth:   # the neck: carry on the shoulder's direction, so the cheek grows out of it without a corner
            n = segs[0][0]; c2 = rb[-1][2] if n[0] > 0 else lb[-1][2]
            out[0] = (n, (n[0] + smooth * (n[0] - c2[0]), n[1] + smooth * (n[1] - c2[1]))) + out[0][2:]
        return out
    rh, lh = tf(rh), tf(lh)
    return _d(rb + rh + _rev(lh) + _rev(lb))


# ---------- stars: slim four-point sparkles and dots ----------
def sparkle(x, y, R, waist=0.16, rot=0):
    w = R * waist
    pts = [(0, -R), (R, 0), (0, R), (-R, 0)]
    d = f"M{x:.1f},{y - R:.1f} "
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        cx, cy = (a[0] + b[0]) * waist, (a[1] + b[1]) * waist
        d += f"Q{x + cx:.1f},{y + cy:.1f} {x + b[0]:.1f},{y + b[1]:.1f} "
    t = f' transform="rotate({rot} {x} {y})"' if rot else ""
    return f'<path d="{d}Z"{t}/>'

def dot(x, y, r):
    return f'<circle cx="{x}" cy="{y}" r="{r}"/>'


# ---------- the big icon ----------
def big(sky=(("0", "#1F2756"), ("1", "#2C4A6E")), cy=480, r=300, k=0.66, frame=20, cat_scale=1.08,
        head_scale=1.22, tilt=-3, stars=None, star_fill=STAR, cat_fill=MISO, reveal=0.22, reveal_col="#0B1230",
        tail="M28,-4 C33,38 18,72 26,104 C31,122 50,130 70,124", tail_w=38, frame_line=None, sill_h=34,
        glow=None, extra_cat="", wall=WALL, under_cat="", body=None, head=None, smooth=0.0, cat_grad=None):
    sill_y = cy + k * r
    half = r * math.sqrt(1 - k * k)
    sw = half + frame + 24
    defs = (f'<linearGradient id="sky" x1="0" y1="{cy - r}" x2="0" y2="{sill_y:.1f}" gradientUnits="userSpaceOnUse">'
            + "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in sky) + '</linearGradient>'
            f'<clipPath id="above-sill"><rect width="1024" height="{sill_y:.1f}"/></clipPath>'
            f'<clipPath id="pane"><circle cx="512" cy="{cy}" r="{r}"/></clipPath>')
    if glow:
        defs += (f'<radialGradient id="glow" cx="512" cy="{sill_y:.1f}" r="{r * 0.9:.1f}" gradientUnits="userSpaceOnUse">'
                 f'<stop offset="0" stop-color="{glow[0]}" stop-opacity="{glow[1]}"/><stop offset="1" stop-color="{glow[0]}" stop-opacity="0"/></radialGradient>')
    g = ['<g clip-path="url(#above-sill)">']
    if frame_line:
        g.append(f'<circle cx="512" cy="{cy}" r="{r + frame + 2}" fill="{frame_line}"/>')
    g.append(f'<circle cx="512" cy="{cy}" r="{r + frame}" fill="{FRAME}"/>')
    g.append(f'<circle cx="512" cy="{cy}" r="{r}" fill="url(#sky)"/>')
    if glow:
        g.append(f'<circle cx="512" cy="{cy}" r="{r}" fill="url(#glow)"/>')
    if stars:
        g.append(f'<g fill="{star_fill}" clip-path="url(#pane)">' + "".join(stars) + '</g>')
    if reveal:
        g.append(f'<path clip-path="url(#pane)" fill="{reveal_col}" opacity="{reveal}" fill-rule="evenodd" d="'
                 f'M{512 - r},{cy} a{r},{r} 0 1 1 {2 * r},0 a{r},{r} 0 1 1 {-2 * r},0 Z '
                 f'M{512 - r},{cy + 16} a{r},{r} 0 1 0 {2 * r},0 a{r},{r} 0 1 0 {-2 * r},0 Z"/>')
    g.append('</g>')
    g.append(f'<rect x="{512 - sw:.1f}" y="{sill_y + 8:.1f}" width="{2 * sw:.1f}" height="{sill_h + 2}" rx="13" fill="{SILL_SHADE}"/>')
    g.append(f'<rect x="{512 - sw:.1f}" y="{sill_y:.1f}" width="{2 * sw:.1f}" height="{sill_h}" rx="13" fill="{FRAME}"/>')
    if cat_grad:
        defs += (f'<linearGradient id="fur" x1="0" y1="-480" x2="0" y2="0" gradientUnits="userSpaceOnUse">'
                 f'<stop offset="0" stop-color="{cat_grad[0]}"/><stop offset="1" stop-color="{cat_grad[1]}"/></linearGradient>')
        cat_fill = "url(#fur)"
    g.append(f'<g transform="translate(512,{sill_y + 2:.1f}) scale({cat_scale})" fill="{cat_fill}">')
    g.append(under_cat)
    g.append(f'<path d="{cat_path(head_scale, tilt, body=body or BODY, head=head or HEAD_V9, smooth=smooth)}"/>')
    if tail_w:
        g.append(f'<path d="{tail}" fill="none" stroke="{cat_fill}" stroke-width="{tail_w}" stroke-linecap="round"/>')
    g.append(extra_cat)
    g.append('</g>')
    return kit.tile("".join(g), defs=defs, top=wall[0], bot=wall[1])


# ---------- checks ----------
def build(variants, sheet_name, render_first=True):
    paths = []
    for name, svg in variants:
        p = DRAFTS + name + ".svg"
        open(p, "w").write(svg)
        paths.append(p)
    kit.sheet(DRAFTS + sheet_name, paths, [n for n, _ in variants])
    return paths

def zoom(svgs, out, sizes=(16, 32), grey=True):
    """Each svg at 16 and 32 px, blown up 10x (nearest), on light and dark, plus a greyscale copy."""
    from PIL import Image, ImageOps
    rows = []
    for svg_path in svgs:
        tiles = []
        for n in sizes:
            p = DRAFTS + os.path.basename(svg_path).replace(".svg", f"-{n}.png")
            kit.render(svg_path, p, n)
            im = Image.open(p).convert("RGBA")
            for bg in ((244, 244, 244, 255), (30, 30, 30, 255)):
                b = Image.new("RGBA", im.size, bg); b.alpha_composite(im)
                tiles.append(b.resize((n * 8, n * 8), Image.NEAREST))
            if grey:
                b = Image.new("RGBA", im.size, (244, 244, 244, 255)); b.alpha_composite(im)
                tiles.append(ImageOps.grayscale(b.convert("RGB")).convert("RGB").resize((n * 8, n * 8), Image.NEAREST))
        rows.append(tiles)
    W = max(sum(t.width for t in r) + 16 * (len(r) + 1) for r in rows)
    H = sum(max(t.height for t in r) + 16 for r in rows) + 16
    sheet = Image.new("RGB", (W, H), (255, 255, 255))
    y = 16
    for r in rows:
        x = 16
        for t in r:
            sheet.paste(t.convert("RGB"), (x, y)); x += t.width + 16
        y += max(t.height for t in r) + 16
    sheet.save(out)

def grey(png, out, size=360):
    from PIL import Image, ImageOps
    im = Image.open(png).convert("RGBA")
    b = Image.new("RGBA", im.size, (255, 255, 255, 255)); b.alpha_composite(im)
    c = b.convert("RGB").resize((size, size), Image.LANCZOS)
    g = ImageOps.grayscale(c).convert("RGB")
    s = Image.new("RGB", (size * 2 + 30, size + 20), (255, 255, 255))
    s.paste(c, (10, 10)); s.paste(g, (size + 20, 10))
    s.save(out)

def dock(out, svgs, small=None):
    """Kavana between Moshe and Daf, at 128 and 64 (and 32 with the small drawing) on light and dark."""
    import base64
    def uri(p):
        mime = "image/svg+xml" if p.endswith(".svg") else "image/png"
        return f"data:{mime};base64," + base64.b64encode(open(p, "rb").read()).decode()
    moshe = uri("/srv/dev/moshe-next/frontend/public/icons/icon-512.png")
    daf = uri("/srv/dev/daf/web/icon-512.png")
    rows = ""
    for s in svgs:
        k = uri(s)
        ks = uri(small) if small else k
        for bg in ("#e9e6e1", "#1e1e1e"):
            for n in (128, 64, 32):
                kk = ks if n <= 32 else k
                rows += (f'<div style="background:{bg};display:flex;gap:{max(n // 6, 8)}px;padding:12px 22px;align-items:center">'
                         + "".join(f'<img src="{u}" width="{n}" height="{n}">' for u in (moshe, kk, daf)) + '</div>')
    html = f'<html><body style="margin:0;background:#fff">{rows}</body></html>'
    h = (152 + 88 + 56) * 2 * len(svgs) + 10
    p = kit._Page(560, h)
    try:
        p.shoot(html, out)
    finally:
        p.close()


STARS_A = [sparkle(330, 300, 26), sparkle(700, 268, 18), dot(612, 214, 6), dot(290, 452, 5), sparkle(742, 420, 12)]

if __name__ == "__main__":
    rnd = sys.argv[1] if len(sys.argv) > 1 else "1"

if __name__ == "__main__" and rnd == "1":
    BRIEF = (("0", "#1F2756"), ("1", "#2C4A6E"))
    APP = (("0", "#1F2756"), ("1", "#4A4F8C"))
    TEALNAVY = (("0", "#172E48"), ("1", "#235E6E"))
    v = [
        ("v1a", big(BRIEF, stars=STARS_A)),
        ("v1b", big(APP, stars=STARS_A)),
        ("v1c", big(TEALNAVY, stars=STARS_A)),
    ]
    ps = build(v, "sheet-v1.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)


# ---------- round 2: sky colour, calmer stars, a frame edge, a contact shadow under the cat ----------
STARS_B = [sparkle(334, 312, 20, waist=0.2), sparkle(706, 292, 13, waist=0.2), dot(630, 232, 5), dot(292, 470, 4.5),
           dot(748, 436, 6)]
SHADOW = '<ellipse cx="0" cy="6" rx="150" ry="9" fill="#D9BE96" opacity=".7"/>'

if __name__ == "__main__" and rnd == "2":
    IND_TEAL = (("0", "#1F2756"), ("1", "#2A5A6E"))
    THREE = (("0", "#1B2350"), ("0.55", "#25386A"), ("1", "#2C5C6F"))
    BRIEF = (("0", "#1F2756"), ("1", "#2C4A6E"))
    v = [
        ("v2a", big(IND_TEAL, stars=STARS_B, extra_cat=SHADOW)),
        ("v2b", big(THREE, stars=STARS_B, extra_cat=SHADOW, frame_line="#E9D5B5")),
        ("v2c", big(BRIEF, stars=STARS_B, extra_cat=SHADOW, r=290, cy=478, k=0.70, cat_scale=1.1, frame_line="#E9D5B5")),
    ]
    ps = build(v, "sheet-v2.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)


# ---------- round 3: the cat bigger again; shadow under the cat; a shorter tail ----------
SHADOW3 = '<ellipse cx="0" cy="3" rx="158" ry="8" fill="#DCC29C"/>'
THREE = (("0", "#1B2350"), ("0.55", "#25386A"), ("1", "#2C5C6F"))
TAIL_SHORT = "M28,-4 C32,30 20,60 26,88 C31,106 50,114 70,108"

def stars_for(cy, r, ears_y, s=1.0):
    """Stars placed relative to the window: brightest up-left where she looks, the rest scattered."""
    return [sparkle(512 - 0.60 * r, cy - 0.55 * r, 20 * s, waist=0.2), sparkle(512 + 0.64 * r, cy - 0.60 * r, 13 * s, waist=0.2),
            dot(512 + 0.38 * r, cy - 0.86 * r, 5 * s), dot(512 - 0.74 * r, cy - 0.02 * r, 4.5 * s), dot(512 + 0.80 * r, cy - 0.12 * r, 6 * s)]

if __name__ == "__main__" and rnd == "3":
    v = [
        ("v3a", big(THREE, stars=STARS_B, under_cat=SHADOW3, frame_line="#E9D5B5")),
        ("v3b", big(THREE, stars=stars_for(466, 305, 0), under_cat=SHADOW3, frame_line="#E9D5B5", r=305, k=0.72, cy=466, cat_scale=1.16)),
        ("v3c", big(THREE, stars=stars_for(470, 300, 0), under_cat=SHADOW3, frame_line="#E9D5B5", r=300, k=0.72, cy=470, cat_scale=1.16,
                    head_scale=1.28, tail=TAIL_SHORT)),
    ]
    ps = build(v, "sheet-v3.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)
    dock(DRAFTS + "dock-v3.png", ps[1:])


# ---------- round 4: between v3a and v3c (room above the ears), softer shadow, stars kept clear of the ears, tabby stripes ----------
SHADOW4 = '<ellipse cx="0" cy="2" rx="156" ry="6" fill="#E3CDA8"/>'
STARS4 = [sparkle(328, 302, 22, waist=0.2), sparkle(706, 266, 13, waist=0.2), dot(282, 470, 4.5), dot(748, 418, 6), dot(636, 214, 4)]

def stripes(col="#DE8E46", w=16):
    """Three short tabby stripes down the back of the head (cat coords, before scale)."""
    return (f'<g fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round">'
            '<path d="M0,-372 L0,-332"/><path d="M-30,-366 C-33,-352 -34,-342 -33,-330"/><path d="M30,-366 C33,-352 34,-342 33,-330"/></g>')

if __name__ == "__main__" and rnd == "4":
    base = dict(stars=STARS4, under_cat=SHADOW4, frame_line="#E9D5B5", r=302, k=0.70, cy=470, cat_scale=1.12,
                head_scale=1.26, tail=TAIL_SHORT)
    v = [
        ("v4a", big(THREE, **base)),
        ("v4b", big(THREE, extra_cat=stripes(), **base)),
        ("v4c", big((("0", "#1A2250"), ("0.5", "#243769"), ("1", "#2B6070")), extra_cat=stripes("#E39A50", 14), **base)),
    ]
    ps = build(v, "sheet-v4.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)


# ---------- the small drawing, for 16 and 32 px: the window fills the tile, the cat is chunkier and bigger ----------
BODY_S = [
    ("L", (150, 0)),
    ((196, 0), (214, -40), (206, -90)),       # haunch
    ((200, -132), (170, -168), (146, -196)),  # top of the haunch, curving in
    ((132, -214), (122, -232), (120, -250)),  # up to the neck
]
HEAD_S = [
    ((118, -262), (158, -282), (162, -330)),  # the neck out into the cheek
    ((165, -364), (158, -388), (150, -402)),  # the skull to the ear
    ((140, -430), (128, -478), (120, -512)),  # back of the ear
    ((117, -524), (106, -526), (99, -518)),   # ear tip
    ((84, -496), (68, -466), (52, -440)),     # ear, inner edge
    ((36, -444), (16, -446), (0, -446)),      # crown
]

def small(sky=(("0", "#1D2654"), ("1", "#2A5470")), cy=500, r=372, sill_y=712, scale=0.92, frame=0, frame_line=None,
          star=None, sill_h=46, tail="M38,-4 C42,40 34,72 44,100 C52,118 76,122 96,112", tail_w=62, sill_shade="#E2C9A2",
          body=BODY_S, head=HEAD_S):
    half = math.sqrt(max(r * r - (sill_y - cy) ** 2, 0))
    sw = half + frame + 18
    defs = (f'<linearGradient id="sky" x1="0" y1="{cy - r}" x2="0" y2="{sill_y}" gradientUnits="userSpaceOnUse">'
            + "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in sky) + '</linearGradient>'
            f'<clipPath id="above-sill"><rect width="1024" height="{sill_y}"/></clipPath>')
    g = ['<g clip-path="url(#above-sill)">']
    if frame_line:
        g.append(f'<circle cx="512" cy="{cy}" r="{r + frame + 4}" fill="{frame_line}"/>')
    if frame:
        g.append(f'<circle cx="512" cy="{cy}" r="{r + frame}" fill="{FRAME}"/>')
    g.append(f'<circle cx="512" cy="{cy}" r="{r}" fill="url(#sky)"/>')
    if star:
        g.append(f'<g fill="{STAR}">{star}</g>')
    g.append('</g>')
    g.append(f'<rect x="{512 - sw:.1f}" y="{sill_y + 10}" width="{2 * sw:.1f}" height="{sill_h}" rx="16" fill="{sill_shade}"/>')
    g.append(f'<rect x="{512 - sw:.1f}" y="{sill_y}" width="{2 * sw:.1f}" height="{sill_h}" rx="16" fill="{FRAME}"/>')
    g.append(f'<g transform="translate(512,{sill_y + 2}) scale({scale})" fill="{MISO}">')
    g.append(f'<path d="{cat_path(1.0, 0, body=body, head=head)}"/>')
    if tail_w:
        g.append(f'<path d="{tail}" fill="none" stroke="{MISO}" stroke-width="{tail_w}" stroke-linecap="round"/>')
    g.append('</g>')
    return kit.tile("".join(g), defs=defs, top=WALL[0], bot=WALL[1])

if __name__ == "__main__" and rnd == "s1":
    v = [
        ("s1a", small()),
        ("s1b", small(star=sparkle(318, 330, 44, waist=0.24))),
        ("s1c", small(r=352, cy=508, frame=22, frame_line="#E6CFAA", scale=0.86)),
    ]
    ps = build(v, "sheet-s1.png")
    kit.render(ps[0], DRAFTS + "s1a-1024.png", 1024)
    zoom(ps, DRAFTS + "zoom-s1.png")


# ---------- small, round 2: taller ears, a deeper dip between them, the head a touch bigger; sill snapped to the 16 px grid ----------
HEAD_S2 = [
    ((118, -262), (164, -282), (168, -332)),  # the neck out into the cheek
    ((171, -366), (164, -390), (156, -404)),  # the skull to the ear
    ((146, -436), (134, -494), (126, -536)),  # back of the ear
    ((123, -548), (112, -550), (105, -542)),  # ear tip
    ((88, -514), (72, -476), (56, -432)),     # ear, inner edge
    ((40, -424), (18, -422), (0, -422)),      # crown
]
HEAD_S3 = [   # ears set a little wider apart, straighter outer edge
    ((118, -262), (166, -282), (170, -332)),
    ((173, -366), (168, -392), (162, -408)),
    ((156, -440), (150, -500), (146, -540)),  # back of the ear, nearly upright
    ((144, -552), (133, -555), (126, -546)),  # ear tip
    ((104, -516), (84, -474), (64, -434)),    # ear, inner edge
    ((44, -424), (20, -422), (0, -422)),
]

if __name__ == "__main__" and rnd == "s2":
    v = [
        ("s2a", small(head=HEAD_S2, sill_y=704, cy=494, scale=0.9)),
        ("s2b", small(head=HEAD_S3, sill_y=704, cy=494, scale=0.9)),
        ("s2c", small(head=HEAD_S3, sill_y=704, cy=494, scale=0.9, sky=(("0", "#1B2350"), ("1", "#24406A")))),
    ]
    ps = build(v, "sheet-s2.png")
    kit.render(ps[1], DRAFTS + "s2b-1024.png", 1024)
    zoom(ps, DRAFTS + "zoom-s2.png")


# ---------- round 5: a touch more wall around the window; small drawing with a domed crown between leaning ears ----------
HEAD_S4 = [
    ((118, -262), (166, -282), (170, -332)),  # the neck out into the cheek
    ((173, -366), (166, -390), (158, -404)),  # the skull to the ear
    ((150, -436), (140, -496), (134, -536)),  # back of the ear, leaning in a little
    ((131, -548), (120, -551), (113, -543)),  # ear tip
    ((94, -514), (76, -476), (60, -440)),     # ear, inner edge
    ((40, -446), (20, -448), (0, -448)),      # crown, domed
]

def stars5(cy, r):
    return [sparkle(512 - 0.61 * r, cy - 0.55 * r, 21, waist=0.2), sparkle(512 + 0.64 * r, cy - 0.66 * r, 12.5, waist=0.2),
            dot(512 - 0.77 * r, cy + 0.0 * r, 4.5), dot(512 + 0.79 * r, cy - 0.18 * r, 5.5), dot(512 + 0.42 * r, cy - 0.85 * r, 4)]

if __name__ == "__main__" and rnd == "5":
    b5 = dict(under_cat=SHADOW4, frame_line="#E9D5B5", r=296, k=0.70, cy=474, frame=19, cat_scale=1.10,
              head_scale=1.25, tail=TAIL_SHORT)
    v = [
        ("v5a", big(THREE, stars=stars5(474, 296), **b5)),
        ("s5a", small(head=HEAD_S4, sill_y=704, cy=494, scale=0.9)),
        ("s5b", small(head=HEAD_S4, sill_y=704, cy=494, scale=0.9, sky=(("0", "#1B2350"), ("1", "#24406A")), frame=14, r=364, frame_line="#E6CFAA")),
    ]
    ps = build(v, "sheet-v5.png")
    kit.render(ps[0], DRAFTS + "v5a-1024.png", 1024)
    kit.render(ps[1], DRAFTS + "s5a-1024.png", 1024)
    zoom(ps, DRAFTS + "zoom-v5.png")
    dock(DRAFTS + "dock-v5.png", [ps[0]], small=ps[1])


# ---------- round 6: a smooth neck, a whisper of light from above on the fur ----------
if __name__ == "__main__" and rnd == "6":
    b6 = dict(stars=stars5(474, 296), under_cat=SHADOW4, frame_line="#E9D5B5", r=296, k=0.70, cy=474, frame=19, cat_scale=1.10,
              head_scale=1.25, tail=TAIL_SHORT)
    v = [
        ("v6a", big(THREE, smooth=0.5, **b6)),
        ("v6b", big(THREE, smooth=0.9, **b6)),
        ("v6c", big(THREE, smooth=0.6, cat_grad=("#F2AC64", "#EA9C52"), **b6)),
    ]
    ps = build(v, "sheet-v6.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)


# ---------- round 7: the neck again, the shoulder arriving straight up so the cheek grows out of it in one bend ----------
BODY7 = [
    ("L", (104, 0)),
    ((136, 0), (150, -30), (144, -68)),       # haunch
    ((139, -100), (116, -120), (102, -142)),  # top of the haunch, curving in
    ((92, -156), (84, -184), (84, -206)),     # up to the neck, arriving straight up
]
HEAD7 = [
    ((76, -216), (88, -238), (94, -258)),     # the neck curving out into the cheek
    ((97, -278), (92, -296), (87, -306)),
    ((81, -318), (71, -352), (63, -375)),
    ((60, -384), (52, -385), (47, -379)),
    ((39, -364), (30, -348), (21, -337)),
    ((14, -340), (7, -341), (0, -341)),
]

if __name__ == "__main__" and rnd == "7":
    b7 = dict(stars=stars5(474, 296), under_cat=SHADOW4, frame_line="#E9D5B5", r=296, k=0.70, cy=474, frame=19, cat_scale=1.10,
              head_scale=1.25, tail=TAIL_SHORT, body=BODY7, head=HEAD7)
    v = [
        ("v7a", big(THREE, smooth=0.5, **b7)),
        ("v7b", big(THREE, smooth=0.9, cat_grad=("#F2AC64", "#EA9C52"), **b7)),
        ("v7c", big(THREE, smooth=0.0, cat_grad=("#F2AC64", "#EA9C52"), **dict(b7, body=BODY, head=HEAD_V9))),
    ]
    ps = build(v, "sheet-v7.png")
    for p in ps:
        kit.render(p, p.replace(".svg", "-1024.png"), 1024)


# ---------- round 8: the candidates together ----------
FUR = ("#F1AA62", "#EB9E55")
B8 = dict(stars=stars5(474, 296), under_cat=SHADOW4, frame_line="#E9D5B5", r=296, k=0.70, cy=474, frame=19, cat_scale=1.10,
          head_scale=1.25, tail=TAIL_SHORT, cat_grad=FUR)
S8 = dict(head=HEAD_S4, sill_y=704, cy=494, scale=0.9, sky=THREE, frame=14, r=364, frame_line="#E6CFAA")

if __name__ == "__main__" and rnd == "8":
    v = [
        ("v8a", big(THREE, **B8)),
        ("s8a", small(**S8)),
        ("s8b", small(**dict(S8, r=372, frame=0, frame_line=None))),
    ]
    ps = build(v, "sheet-v8.png")
    kit.render(ps[0], DRAFTS + "v8a-1024.png", 1024)
    kit.render(ps[1], DRAFTS + "s8a-1024.png", 1024)
    grey(DRAFTS + "v8a-1024.png", DRAFTS + "grey-v8a.png")
    zoom(ps, DRAFTS + "zoom-v8.png")
    dock(DRAFTS + "dock-v8.png", [ps[0]], small=ps[1])


# ---------- final: v8a and s8a written out as clean, commented SVGs ----------
def _sky_defs(cy, r, sill_y):
    return (f'<linearGradient id="sky" x1="0" y1="{cy - r}" x2="0" y2="{sill_y:.1f}" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#1B2350"/><stop offset="0.55" stop-color="#25386A"/><stop offset="1" stop-color="#2C5C6F"/></linearGradient>'
            f'<clipPath id="above-sill"><rect width="1024" height="{sill_y:.1f}"/></clipPath>')

def final_svg(cy=474, r=296, k=0.70, frame=19, scale=1.10, head_scale=1.25, tilt=-3):
    sill_y = cy + k * r
    half = r * math.sqrt(1 - k * k)
    sw = half + frame + 24
    defs = (_sky_defs(cy, r, sill_y)
            + f'<clipPath id="pane"><circle cx="512" cy="{cy}" r="{r}"/></clipPath>'
            '<linearGradient id="fur" x1="0" y1="-480" x2="0" y2="0" gradientUnits="userSpaceOnUse">'
            '<stop offset="0" stop-color="#F1AA62"/><stop offset="1" stop-color="#EB9E55"/></linearGradient>')
    stars = "".join(stars5(cy, r))
    inner = (
        '<!-- the round window in the cafe wall: a cream frame with a hairline edge, the night sky, a few stars,'
        ' and the wall\'s thickness as a soft shade at the top -->'
        '<g clip-path="url(#above-sill)">'
        f'<circle cx="512" cy="{cy}" r="{r + frame + 2}" fill="#E9D5B5"/>'
        f'<circle cx="512" cy="{cy}" r="{r + frame}" fill="{FRAME}"/>'
        f'<circle cx="512" cy="{cy}" r="{r}" fill="url(#sky)"/>'
        f'<g fill="{STAR}">{stars}</g>'
        f'<path clip-path="url(#pane)" fill="#0B1230" opacity=".22" fill-rule="evenodd" d="M{512 - r},{cy} a{r},{r} 0 1 1 {2 * r},0 a{r},{r} 0 1 1 {-2 * r},0 Z M{512 - r},{cy + 16} a{r},{r} 0 1 0 {2 * r},0 a{r},{r} 0 1 0 {-2 * r},0 Z"/>'
        '</g>'
        '<!-- the sill, with its shadow on the wall -->'
        f'<rect x="{512 - sw:.1f}" y="{sill_y + 8:.1f}" width="{2 * sw:.1f}" height="36" rx="13" fill="{SILL_SHADE}"/>'
        f'<rect x="{512 - sw:.1f}" y="{sill_y:.1f}" width="{2 * sw:.1f}" height="34" rx="13" fill="{FRAME}"/>'
        '<!-- Miso from behind, looking out at the stars; the room light falls on her from above; her tail hangs over the sill -->'
        f'<g transform="translate(512,{sill_y + 2:.1f}) scale({scale})" fill="url(#fur)">'
        f'{SHADOW4}'
        f'<path d="{cat_path(head_scale, tilt)}"/>'
        f'<path d="{TAIL_SHORT}" fill="none" stroke="url(#fur)" stroke-width="38" stroke-linecap="round"/>'
        '</g>')
    return kit.tile(inner, defs=defs, top=WALL[0], bot=WALL[1])

def final_small(cy=494, r=364, sill_y=704, frame=14, scale=0.9):
    half = math.sqrt(r * r - (sill_y - cy) ** 2)
    sw = half + frame + 18
    tail = "M38,-4 C42,40 34,72 44,100 C52,118 76,122 96,112"
    inner = (
        '<!-- for 16 and 32 px: the window fills the tile, no stars, and a chunkier Miso with bigger ears -->'
        '<g clip-path="url(#above-sill)">'
        f'<circle cx="512" cy="{cy}" r="{r + frame + 4}" fill="#E6CFAA"/>'
        f'<circle cx="512" cy="{cy}" r="{r + frame}" fill="{FRAME}"/>'
        f'<circle cx="512" cy="{cy}" r="{r}" fill="url(#sky)"/>'
        '</g>'
        f'<rect x="{512 - sw:.1f}" y="{sill_y + 10}" width="{2 * sw:.1f}" height="46" rx="16" fill="#E2C9A2"/>'
        f'<rect x="{512 - sw:.1f}" y="{sill_y}" width="{2 * sw:.1f}" height="46" rx="16" fill="{FRAME}"/>'
        f'<g transform="translate(512,{sill_y + 2}) scale({scale})" fill="{MISO}">'
        f'<path d="{cat_path(1.0, 0, body=BODY_S, head=HEAD_S4)}"/>'
        f'<path d="{tail}" fill="none" stroke="{MISO}" stroke-width="62" stroke-linecap="round"/>'
        '</g>')
    return kit.tile(inner, defs=_sky_defs(cy, r, sill_y), top=WALL[0], bot=WALL[1])


if __name__ == "__main__" and rnd == "final":
    p, ps = HERE + "icon.svg", HERE + "icon-small.svg"
    open(p, "w").write(final_svg())
    open(ps, "w").write(final_small())
    kit.render(p, HERE + "icon-1024.png", 1024)
    kit.sheet(HERE + "sheet.png", [p, ps], ["The night window", "Small (16, 32 px)"],
              ["The end of a block: the sky has gone to night, and Miso sits on the sill looking at the stars.",
               "The window fills the tile, no stars, a chunkier Miso with bigger ears."])
    zoom([p, ps], DRAFTS + "zoom-final.png")
    dock(DRAFTS + "dock-final.png", [p], small=ps)
    grey(HERE + "icon-1024.png", DRAFTS + "grey-final.png")
