"""Turn one photograph into the Duo wallpapers, their frost and a thumbnail.

    python make-walls.py <photo> <work-dir> [--night <photo>] [--sky-from <row>]

Writes wall-day.png and wall-night.png for the glass lab, the same two as WebP,
frost-day.webp, frost-night.webp, thumb.webp and ui/lens-*.webp. Needs NumPy and
Pillow.

The night version comes from a second photograph when there is one. Otherwise
it is computed from the day: the whole picture is taken down to a cool blue
hour, with stars where it is calm and high up. --sky-from gives the row below
which the land starts: the sky is then redrawn from a gradient that hugs it.
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

WIDTH, HEIGHT = 1920, 1080
LUMA = np.array([.3, .59, .11], dtype=np.float32)
ROWS = np.arange(HEIGHT, dtype=np.float32)[:, None]
rng = np.random.default_rng(2026)


def gaussian(channel, sigma):
    pad = int(sigma * 4)
    padded = np.pad(channel, pad, mode='edge')
    fy = np.fft.fftfreq(padded.shape[0])[:, None]
    fx = np.fft.rfftfreq(padded.shape[1])[None, :]
    spectrum = np.fft.rfft2(padded) * np.exp(-2 * np.pi ** 2 * sigma ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.irfft2(spectrum, s=padded.shape)[pad:-pad, pad:-pad].astype(np.float32)


def load(path):
    """Fill 1920 x 1080, keeping the top of the picture, where the sky usually is."""
    image = Image.open(path).convert('RGB')
    scale = max(WIDTH / image.width, HEIGHT / image.height)
    size = (round(image.width * scale), round(image.height * scale))
    left = (size[0] - WIDTH) // 2
    return np.asarray(image.resize(size, Image.LANCZOS).crop((left, 0, left + WIDTH, HEIGHT)), dtype=np.float32)


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def legible(image):
    """A bright picture would swallow the clock or the row, so it is dimmed gently, just there."""
    luma = image @ LUMA
    clock, row = float(luma[78:530, 620:1300].mean()), float(luma[860:1040, 200:1720].mean())
    gain = np.ones_like(ROWS)
    if clock > 185:
        gain -= (1 - 185 / clock) * (1 - smoothstep(560, 700, ROWS))
    if row > 130:
        gain -= (1 - 130 / row) * smoothstep(760, 880, ROWS)
    return image * gain[..., None]


def rolling_median(values, reach):
    wide = np.pad(values, reach, mode='edge')
    return np.array([np.median(wide[i - reach:i + reach + 1]) for i in range(reach, reach + WIDTH)], dtype=np.float32)


def find_ridge(day, start):
    """The first real edge below the open sky, column by column. A streak of sun can look like one, so the neighbours overrule a lone column."""
    gradient = np.abs(np.diff(gaussian(day @ LUMA, 2), axis=0))[start:]
    found = gradient > 1.4
    hits = np.where(found.any(axis=0), found.argmax(axis=0) + start, -1).astype(np.float32)
    columns = np.arange(WIDTH)
    good = hits >= 0
    hits = np.interp(columns, columns[good], hits[good])
    baseline = rolling_median(hits, 60)
    hits = np.where(np.abs(hits - baseline) > 12, baseline, hits)
    return rolling_median(hits, 4)


def stars(fade_rows):
    """Fixed, seeded stars, thinning towards the horizon."""
    field = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    for _ in range(1500):
        x, y = rng.integers(2, WIDTH - 2), rng.integers(2, int(HEIGHT * .58))
        fade = max(0, 1 - y / fade_rows[x]) ** .55
        field[y, x] = max(field[y, x], fade * rng.power(.22) * 150)
    soft = gaussian(field, .7) * 2.4
    bright = np.zeros_like(field)
    for _ in range(46):
        x, y = rng.integers(4, WIDTH - 4), rng.integers(4, int(HEIGHT * .42))
        bright[y, x] = 520 + rng.random() * 300
    return soft + gaussian(bright, 1.05) * 3.4


STAR_TINT = np.array([.96, .98, 1], dtype=np.float32)


def night_with_new_sky(day, ridge):
    luma = day @ LUMA
    # The glow follows the land's broad shape: tracing every column would draw rays in the sky.
    broad = gaussian(ridge[None, :], 48).ravel()
    depth = np.clip(ROWS / broad[None, :], 0, 1)
    points = np.array([0, .46, .78, .93, 1], dtype=np.float32)
    colours = np.array([[10, 15, 34], [20, 26, 52], [52, 48, 80], [104, 76, 98], [150, 104, 104]], dtype=np.float32)
    sky = np.dstack([np.interp(depth, points, colours[:, c]) for c in range(3)]).astype(np.float32)
    # A trace of the day's clouds, low over the hills and away from the sun.
    streaks = np.clip(gaussian(luma, 2) - gaussian(luma, 34), -30, 30)
    away = np.clip((236 - gaussian(luma, 24)) / 50, 0, 1)
    sky += (streaks * .22 * depth ** 2.4 * away)[..., None] * np.array([1, .86, .96], dtype=np.float32)
    sky += stars(ridge)[..., None] * STAR_TINT
    land = ((luma / 255) ** 1.25 * .5)[..., None] * np.array([.86, .88, 1.12], dtype=np.float32) * 255
    edge = np.clip(ROWS - ridge[None, :] + .5, 0, 1)[..., None].astype(np.float32)
    return sky * (1 - edge) + land * edge


def blue_hour(day):
    """Any picture at nightfall: highlights fold down, so a sun or a white sky does not stay a lamp."""
    luma = day @ LUMA
    hue = day / np.maximum(luma[..., None], 1)
    tint = np.array([.84, .88, 1.14], dtype=np.float32)
    night = ((luma / 255) ** 1.25 * .46)[..., None] * (hue * .3 + tint * .7) * 255
    energy = gaussian(np.abs(np.diff(gaussian(luma, 1.2), axis=0, prepend=luma[:1])), 10)
    calm = np.clip(1 - energy / .35, 0, 1) * np.clip(1 - ROWS / (HEIGHT * .5), 0, 1)
    return night + (stars(np.full(WIDTH, HEIGHT * .62)) * calm)[..., None] * STAR_TINT


def quantize(image):
    """Triangular noise keeps a smooth sky from breaking into bands."""
    noise = rng.random(image.shape, dtype=np.float32) - rng.random(image.shape, dtype=np.float32)
    return Image.fromarray((image + noise * .7).round().clip(0, 255).astype(np.uint8), 'RGB')


def frost(image, sigma):
    pad = sigma * 3
    padded = np.pad(image, ((pad, pad), (pad, pad), (0, 0)), mode='reflect')
    blurred = np.dstack([gaussian(padded[..., c], sigma) for c in range(3)])[pad:-pad, pad:-pad]
    return Image.fromarray(blurred.round().clip(0, 255).astype(np.uint8), 'RGB')


def lens(fill_top, fill_bottom, rim_low, rim_high, shadow):
    """The sliding focus: one image with fill, rim and sheen, so nothing is drawn live."""
    scale, diam, margin, ss = 2, 116, 24, 3
    size = (diam + margin * 2) * scale
    n, r = size * ss, diam * scale * ss / 2
    c = n / 2
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) + .5
    dx, dy = xx - c, yy - c
    d = np.hypot(dx, dy)
    inside = np.clip(r - d + .5, 0, 1)
    t = np.clip((yy - (c - r)) / (2 * r), 0, 1)
    fill = fill_top + (fill_bottom - fill_top) * t
    glint = np.abs(np.cos(np.arctan2(dy, dx) + np.pi * .75)) ** 3
    edge = r - d
    rim = np.clip(1 - edge / (2.2 * scale * ss), 0, 1) ** 1.6 * inside
    glow = np.exp(-np.maximum(edge, 0) / (11 * scale * ss)) * inside
    sheen = np.clip(1 - t / .46, 0, 1) ** 2 * inside
    alpha = fill * inside
    alpha = 1 - (1 - alpha) * (1 - .10 * glow) * (1 - .12 * sheen)
    alpha = 1 - (1 - alpha) * (1 - (rim_low + (rim_high - rim_low) * glint) * rim)
    white = np.ones_like(alpha)
    image = np.dstack([white, white, white, alpha])
    picture = Image.fromarray((image * 255).clip(0, 255).astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS)
    mask = Image.fromarray((inside * 255).astype(np.uint8), 'L').resize((size, size), Image.LANCZOS)
    shade = np.roll(np.asarray(mask.filter(ImageFilter.GaussianBlur(9 * scale)), dtype=np.float32) / 255 * shadow, 4 * scale, axis=0)
    a = np.asarray(picture, dtype=np.float32) / 255
    top = a[..., 3]
    total = top + shade * (1 - top)
    rgb = (a[..., :3] * top[..., None]) / np.maximum(total, 1e-4)[..., None]
    return Image.fromarray((np.dstack([rgb, total]) * 255).clip(0, 255).astype(np.uint8), 'RGBA')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('photo', type=Path)
    parser.add_argument('work', type=Path)
    parser.add_argument('--night', type=Path, help='A photograph of the same view by night')
    parser.add_argument('--sky-from', type=int, help='Row below which the land starts, to redraw the night sky')
    args = parser.parse_args()
    (args.work / 'ui').mkdir(parents=True, exist_ok=True)
    day = legible(load(args.photo))
    if args.night:
        night = legible(load(args.night))
    elif args.sky_from:
        night = night_with_new_sky(day, find_ridge(day, args.sky_from))
    else:
        night = blue_hour(day)
    for name, image in (('day', day), ('night', night)):
        final = quantize(image)
        final.save(args.work / f'wall-{name}.png')
        final.save(args.work / f'wall-{name}.webp', quality=96, method=6)
        frost(image, 44).resize((480, 270), Image.LANCZOS).save(args.work / f'frost-{name}.webp', lossless=True, quality=100, method=4)
        if name == 'day':
            final.resize((480, 270), Image.LANCZOS).save(args.work / 'thumb.webp', quality=86, method=6)
    lens(.30, .16, .22, .92, .20).save(args.work / 'ui/lens-day.webp', quality=95, alpha_quality=100, method=4)
    lens(.22, .12, .18, .85, .34).save(args.work / 'ui/lens-night.webp', quality=95, alpha_quality=100, method=4)


if __name__ == '__main__':
    main()
