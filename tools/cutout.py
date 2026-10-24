#!/usr/bin/env python3
"""Cut a painted cat out of its white background: flood-fill the white from the edges (the thick dark
outline stops it), soften the edge a little, trim to a square with some room, and save a 512px WebP
with transparency. Needs Pillow.
    python3 tools/cutout.py <in.png> <out.webp> [--size 512] [--thresh 42] [--sat 30] [--seal 0]
--seal N closes gaps of up to 2N pixels in the outline first, for fluffy white fur that the walk
would otherwise get into. --wide keeps the picture's own shape (a garland) instead of a square, with
its longer side --size pixels."""
import sys
from PIL import Image, ImageFilter

args = sys.argv[1:]
def opt(k, d):
    if f'--{k}' in args:
        i = args.index(f'--{k}'); v = args[i + 1]; del args[i:i + 2]; return type(d)(v)
    return d
size, thresh, sat, specks = opt('size', 512), opt('thresh', 42), opt('sat', 30), opt('specks', 80)  # --sat: how colorful a shadow may be and still go; --specks: smallest bit kept
seal = opt('seal', 0)
wide = '--wide' in args
if wide: args.remove('--wide')
src, dst = args[0], args[1]

im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()

# Background = light, colorless pixels you can reach from the edge: the white, the white sticker rim
# and any soft grey shadow. The thick dark outline stops the walk, so white or cream fur stays.
def bgish(c):
    r, g, b = c
    return (r + g + b) / 3 >= 255 - thresh * 2.4 and max(c) - min(c) <= sat
# With --seal, the outline is thickened before the walk (so it can't slip through a gap), and the
# background found is grown back afterwards by the same amount, over light pixels only.
wall = None
if seal:
    dark = Image.frombytes('L', (w, h), bytes(255 if sum(px[x, y]) < 3 * 150 else 0 for y in range(h) for x in range(w)))
    wall = dark.filter(ImageFilter.MaxFilter(2 * seal + 1)).load()
seen = bytearray(w * h)
stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
while stack:
    x, y = stack.pop()
    i = y * w + x
    if seen[i] or not bgish(px[x, y]) or (wall and wall[x, y]):
        continue
    seen[i] = 1
    if x > 0: stack.append((x - 1, y))
    if x < w - 1: stack.append((x + 1, y))
    if y > 0: stack.append((x, y - 1))
    if y < h - 1: stack.append((x, y + 1))
if seal:
    grown = Image.frombytes('L', (w, h), bytes(255 if v else 0 for v in seen)).filter(ImageFilter.MaxFilter(2 * seal + 1)).load()
    seen = bytearray(1 if (seen[y * w + x] or (grown[x, y] and bgish(px[x, y]))) else 0 for y in range(h) for x in range(w))

# Drop specks: bits of foreground smaller than a sparkle (stray dots of a soft shadow).
mask = bytearray(0 if v else 1 for v in seen)
label = bytearray(w * h)
for start in range(w * h):
    if not mask[start] or label[start]:
        continue
    comp, stack = [], [start]
    label[start] = 1
    while stack:
        i = stack.pop()
        comp.append(i)
        x, y = i % w, i // w
        for j in ((i - 1) if x > 0 else -1, (i + 1) if x < w - 1 else -1, (i - w) if y > 0 else -1, (i + w) if y < h - 1 else -1):
            if j >= 0 and mask[j] and not label[j]:
                label[j] = 1
                stack.append(j)
    if len(comp) < specks:
        for i in comp:
            mask[i] = 0
fg = Image.frombytes('L', (w, h), bytes(255 if v else 0 for v in mask))
fg = fg.filter(ImageFilter.MinFilter(3))        # eat the light fringe just outside the outline
fg = fg.filter(ImageFilter.GaussianBlur(0.8))   # and soften it
out = im.convert('RGBA')
out.putalpha(fg)

bbox = fg.point(lambda v: 255 if v > 40 else 0).getbbox()
if not bbox:
    sys.exit(f'{src}: nothing left after cutting')
x0, y0, x1, y1 = bbox
if wide:
    pad = int(max(x1 - x0, y1 - y0) * 0.03)
    canvas = out.crop((max(0, x0 - pad), max(0, y0 - pad), min(w, x1 + pad), min(h, y1 + pad)))
    k = size / max(canvas.size)
    canvas = canvas.resize((round(canvas.width * k), round(canvas.height * k)), Image.LANCZOS)
    canvas.save(dst, 'WEBP', quality=86, method=6)
    sys.exit(print(f'{dst}: {canvas.size}'))
side = int(max(x1 - x0, y1 - y0) * 1.08)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
canvas.paste(out.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)), (0, 0))
canvas = canvas.resize((size, size), Image.LANCZOS)
canvas.save(dst, 'WEBP', quality=86, method=6)
kept = sum(1 for a in canvas.getchannel('A').getdata() if a > 128) / (size * size)
print(f'{dst}: {canvas.size}, {kept:.0%} cat')
