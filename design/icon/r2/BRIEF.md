# Kavana icon, round 2: the window

The window won round 1. Round 1's brief still holds
(`../r1/BRIEF.md`: flat or nearly flat, one subject, no spirals, no letters, no clip-art cat head,
must read at 16 px, the Dock test beside Moshe and Daf). Start from round 1's drawing:
`../r1/window/icon.svg`, its generator `../r1/window/gen.py` and its notes `../r1/window/notes.md`.

## Keep

- The café wall as the tile: cream, `#FDF5E8` to `#F5E4CB`.
- The round window cut into it, with a cream frame, and the sky inside it.
- Miso (`#EEA45C`) on the sill. It's the app's Focus tab in one picture.
- The calm: a cat settled in a window while you work.

## Fix (round 1's own notes)

1. **The cat is too small:** about 30% of the tile's width. The window, not the cat, is what you
   see first. The cat must be the first thing you see, at every size.
2. **At 16 px it's "something orange in a window"** and could be a keyhole. Every take in this
   round comes with its own simpler drawing for 16 and 32 px (`icon-small.svg`), and that drawing
   has to say cat.
3. **Orange on teal is mostly a hue contrast,** so check it in greyscale too.

## Four takes, one each

- **A. Breaking the frame:** a bigger window that fills most of the tile, and a bigger Miso from
  behind whose head and ears rise above the window's frame onto the wall. The tail hangs over the
  sill. Fixes the size problem head on.
- **B. Over the shoulder:** Miso on the sill turned three-quarters, looking back at you over her
  shoulder (one eye, the near cheek, both ears), so her face says cat at 16 px.
- **C. The night window:** the end of a block, the sky gone deep teal-blue with a few stars, Miso
  on the sill. No moon: a cat and a moon reads as Halloween.
- **D. The home window:** the Focus tab as it is: Miso facing you, sitting on her teal cushion in
  the window, a day sky behind her, and the window's frame as the timer ring with part of it
  filled. Keep the face simple (two eyes, a nose, no whiskers or mouth).

## Deliver, in `r2/<letter>/`

- `icon.svg`, `icon-small.svg` (for 16 and 32 px), `icon-1024.png`, `sheet.png`
  (`kit.sheet(out, [icon.svg, icon-small.svg])`), and `notes.md`: 3 to 5 honest lines.
