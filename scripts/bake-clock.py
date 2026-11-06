"""Draw the Duo clock digits as images: tall, narrow figures drawn here, with no font file.

Writes to ignored staging and never replaces app assets automatically. Needs NumPy and
Pillow (development dependencies only); see docs/assets.md.

Glyph units: cap height = 1000, y down, 0 at the top of the digits, 1000 on the baseline.
"""
import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.local/materials/duo-clock'

CAP = 359  # cap height on the 1920 x 1080 stage, in pixels
PAD = 6  # empty margin around each glyph, in pixels
OVERSAMPLE = 8
OPACITY = .96
NAMES = {':': 'colon'}
# Digit colour from top (0) to bottom (1).
STOPS = {
    'day': [(0, (208, 225, 240)), (.34, (215, 230, 242)), (.5, (223, 234, 240)), (.66, (236, 237, 237)), (.82, (238, 239, 233)), (1, (238, 238, 231))],
    'night': [(0, (150, 178, 228)), (.27, (167, 195, 235)), (.5, (194, 202, 239)), (.73, (233, 218, 241)), (1, (246, 232, 246))],
}

STROKE = 100
W = 395  # width of a round digit
OVERSHOOT = 11  # curves pass the top and the baseline by this much
XL, XR, XC = STROKE / 2, W - STROKE / 2, W / 2
RX = (W - STROKE) / 2
RY = RX * 1.02
YT, YB = -OVERSHOOT + STROKE / 2, 1000 + OVERSHOOT - STROKE / 2
SQUARENESS = 2.12  # curves very slightly squarer than a circle
SOFTEN = 5  # very slight rounding of the corners


def arc(cx, cy, rx, ry, a0, a1, steps=120):
    pts = []
    for i in range(steps + 1):
        t = math.radians(a0 + (a1 - a0) * i / steps)
        c, s = math.cos(t), math.sin(t)
        pts.append((cx + rx * math.copysign(abs(c) ** (2 / SQUARENESS), c),
                    cy + ry * math.copysign(abs(s) ** (2 / SQUARENESS), s)))
    return pts


def bezier(p0, p1, p2, steps=60):
    return [((1 - t) ** 2 * p0[0] + 2 * t * (1 - t) * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * t * (1 - t) * p1[1] + t * t * p2[1])
            for t in (i / steps for i in range(steps + 1))]


def loop(y0, y1, inset=0):
    """A closed loop between two horizontal centre lines."""
    rx, ry = RX - inset, (RX - inset) * 1.02
    return arc(XC, y0 + ry, rx, ry, 180, 360) + arc(XC, y1 - ry, rx, ry, 0, 180) + [(XC - rx, y0 + ry)]


def rotate(glyph):
    width = glyph['w']
    turn = lambda p: (width - p[0], 1000 - p[1])
    return {
        'w': width,
        'strokes': [[turn(p) for p in line] for line in glyph.get('strokes', [])],
        'polys': [[turn(p) for p in poly] for poly in glyph.get('polys', [])],
    }


BOTTOM_TO_TERMINAL = arc(XC, YB - RY, RX, RY, 0, 180)
TOP_FROM_TERMINAL = arc(XC, YT + RY, RX, RY, 180, 360)

NINE_BOWL = 590
NINE = {
    'w': W,
    'strokes': [
        loop(YT, NINE_BOWL),
        [(XR, NINE_BOWL - RY)] + BOTTOM_TO_TERMINAL + [(XL, 712)],
    ],
}

GLYPHS = {
    '0': {'w': W, 'strokes': [loop(YT, YB)]},
    '1': {'w': 231, 'polys': [[(135, 0), (231, 0), (231, 1000), (131, 1000), (131, 109), (0, 196), (0, 102)]]},
    '2': {
        'w': W,
        'strokes': [
            [(XL, 292)] + TOP_FROM_TERMINAL + [(XR, 310)] + bezier((XR, 310), (XR, 408), (285, 510)) + [(36, 936)],
        ],
        'polys': [[(0, 900), (W + 4, 900), (W + 4, 1000), (0, 1000)]],
        'clip': (0, -40, W + 4, 1000),
    },
    '3': {
        'w': W,
        'strokes': [
            [(XL, 292)] + TOP_FROM_TERMINAL + [(XR, 470 - RY)] + arc(XC, 470 - RY, RX, RY, 0, 90) + [(160, 470)],
            [(160, 470)] + arc(XC, 470 + RY, RX, RY, 270, 360) + [(XR, YB - RY)] + BOTTOM_TO_TERMINAL + [(XL, 708)],
        ],
    },
    '4': {
        'w': 409,
        'polys': [
            [(190, 0), (346, 0), (346, 715), (409, 715), (409, 807), (346, 807), (346, 1000), (246, 1000), (246, 807), (0, 807), (0, 715)],
        ],
        'holes': [[(246, 134), (246, 715), (96, 715)]],
    },
    '5': {
        'w': W,
        'polys': [[(20, 0), (W - 18, 0), (W - 18, 100), (120, 100), (120, 530), (20, 530)]],
        'strokes': [
            arc(XC, 396 + RY, RX, RY, 208, 360) + [(XR, YB - RY)] + BOTTOM_TO_TERMINAL + [(XL, 716)],
        ],
    },
    '6': rotate(NINE),
    '7': {
        'w': 372,
        'polys': [[(0, 0), (372, 0), (372, 92), (160, 1000), (57, 1000), (267, 100), (0, 100)]],
    },
    '8': {'w': W, 'strokes': [loop(YT, 474, inset=13), loop(474, YB)]},
    '9': NINE,
    ':': {'w': 116, 'dots': [(58, 281, 58), (58, 715, 58)]},
}

# Left and right side bearings.
BEARINGS = {
    '0': (24, 24), '1': (6, 36), '2': (24, 20), '3': (20, 24), '4': (15, 5), '5': (22, 24),
    '6': (24, 24), '7': (12, 8), '8': (24, 24), '9': (24, 26), ':': (26, 26),
}


def glyph_mask(ch):
    """Return (mask of floats 0..1, margin): the digit's origin is at (margin, margin) in the image."""
    glyph = GLYPHS[ch]
    ss = OVERSAMPLE
    scale = CAP / 1000.0 * ss
    pad = PAD * ss + OVERSHOOT * scale + 2 * ss
    width = int(math.ceil(glyph['w'] * scale + 2 * pad))
    height = int(math.ceil(1000 * scale + 2 * pad))
    # Sizes aligned on the final grid, so downsampling is exact.
    width += (-width) % ss
    height += (-height) % ss
    im = Image.new('L', (width, height), 0)
    draw = ImageDraw.Draw(im)
    tx = lambda p: (p[0] * scale + pad, p[1] * scale + pad)
    half = STROKE * scale / 2
    for line in glyph.get('strokes', []):
        closed = line[0] == line[-1] or math.dist(line[0], line[-1]) < 1
        pts = [tx(p) for p in line]
        lengths = [0.0]
        for i in range(1, len(pts)):
            lengths.append(lengths[-1] + math.dist(pts[i - 1], pts[i]))
        for i in range(len(pts) - 1):
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            dx, dy = x1 - x0, y1 - y0
            length = math.hypot(dx, dy)
            if length < 1e-6:
                continue
            nx, ny = -dy / length * half, dx / length * half
            draw.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=255)
            # No round join near an end: it would spill past the straight cut.
            if closed or (lengths[i] > half * 1.02 and lengths[-1] - lengths[i] > half * 1.02):
                draw.ellipse((x0 - half, y0 - half, x0 + half, y0 + half), fill=255)
    for poly in glyph.get('polys', []):
        draw.polygon([tx(p) for p in poly], fill=255)
    for hole in glyph.get('holes', []):
        draw.polygon([tx(p) for p in hole], fill=0)
    for cx, cy, r in glyph.get('dots', []):
        x, y = tx((cx, cy))
        rr = r * scale
        draw.ellipse((x - rr, y - rr, x + rr, y + rr), fill=255)
    if 'clip' in glyph:
        x0, y0 = tx(glyph['clip'][:2])
        x1, y1 = tx(glyph['clip'][2:])
        if y0 > 0:
            draw.rectangle((0, 0, width, y0), fill=0)
        draw.rectangle((0, y1, width, height), fill=0)
        if x0 > 0:
            draw.rectangle((0, 0, x0, height), fill=0)
        draw.rectangle((x1, 0, width, height), fill=0)
    im = im.filter(ImageFilter.GaussianBlur(SOFTEN * scale)).point(lambda v: 255 if v >= 128 else 0)
    small = im.resize((width // ss, height // ss), Image.BOX)
    return np.asarray(small, dtype=np.float32) / 255.0, pad / ss


def gradient(stops, t):
    xs = [s[0] for s in stops]
    raw = np.stack([np.interp(t, xs, [s[1][c] for s in stops]) for c in range(3)], axis=-1)
    # Smoothed, so no break shows where one stop meets the next.
    radius = 90
    kernel = np.exp(-.5 * (np.arange(-radius, radius + 1) / 30) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(raw, ((radius, radius), (0, 0)), mode='edge')
    return np.stack([np.convolve(padded[:, c], kernel, mode='valid') for c in range(3)], axis=-1)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--output', type=Path, default=OUTPUT)
    output = parser.parse_args().output
    meta = {'cap': CAP, 'glyphs': {}}
    for ch, glyph in GLYPHS.items():
        mask, origin = glyph_mask(ch)
        h, w = mask.shape
        t = np.clip((np.arange(h) - origin) / CAP, 0, 1)
        lsb, rsb = BEARINGS[ch]
        name = NAMES.get(ch, ch)
        meta['glyphs'][ch] = {'file': name, 'w': w, 'h': h, 'origin': origin, 'width': glyph['w'] * CAP / 1000, 'lsb': lsb * CAP / 1000, 'rsb': rsb * CAP / 1000}
        for scheme, stops in STOPS.items():
            colors = gradient(stops, t)[:, None, :].repeat(w, axis=1)
            rgba = np.dstack([colors, mask * 255 * OPACITY]).clip(0, 255).astype(np.uint8)
            target = output / scheme
            target.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, 'RGBA').save(target / f'{name}.webp', lossless=True, quality=100, method=4)
    (output / 'clock.js').write_text('window.CleanFrameDuoClock = ' + json.dumps(meta, separators=(',', ':')) + ';\n')
    print(f'{len(meta["glyphs"])} glyphs in {output}')


if __name__ == '__main__':
    main()
