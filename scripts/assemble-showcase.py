"""Builds the README's hero picture and short film from what capture-showcase.mjs recorded."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FILM_FPS = 22

work, images = Path(sys.argv[1]), Path(sys.argv[2])
day = np.asarray(Image.open(work / 'hero-day.png').convert('RGB'), dtype=np.float32)
night = np.asarray(Image.open(work / 'hero-night.png').convert('RGB'), dtype=np.float32)
height, width = day.shape[:2]
yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
# A diagonal running through the colon of the clock, softened so it reads as dusk rather than a cut.
line = xx - 960 + (yy - 340) * .34
t = np.clip((line + 90) / 180, 0, 1)
mask = (t * t * (3 - 2 * t))[..., None]
hero = day * (1 - mask) + night * mask
Image.fromarray(hero.round().clip(0, 255).astype(np.uint8), 'RGB').save(images / 'hero.jpg', quality=90, optimize=True, progressive=True)
print('hero')

kept, stamps = [], []
for stamp, path in zip(json.loads((work / 'frames.json').read_text()), sorted((work / 'frames').glob('*.jpg'))):
    if not stamps or stamp - stamps[-1] >= 1 / FILM_FPS:
        kept.append(path)
        stamps.append(stamp)
durations = [max(30, round((after - before) * 1000)) for before, after in zip(stamps, stamps[1:])] + [1500]
pictures = [Image.open(path).convert('RGB') for path in kept]
pictures[0].save(images / 'duo-motion.webp', save_all=True, append_images=pictures[1:], duration=durations, loop=0, quality=74, method=4, minimize_size=False)
print('duo-motion', len(pictures), 'frames', sum(durations) / 1000, 's', (images / 'duo-motion.webp').stat().st_size // 1024, 'KB')
