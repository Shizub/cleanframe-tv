"""Collect a finished bake into the folders the app loads. Needs Pillow.

    python pack.py <work-dir> <theme-dir> --name NAME [--credit TEXT] [--source URL]
    python pack.py <work-dir> <pack-dir> --shared

The first form writes one wallpaper with everything baked on it. The second
writes what every wallpaper shares: the app tiles, the glyphs and the lens.
"""
import argparse
import json
import shutil
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('work', type=Path)
parser.add_argument('target', type=Path)
parser.add_argument('--shared', action='store_true')
parser.add_argument('--name')
parser.add_argument('--credit')
parser.add_argument('--source')
args = parser.parse_args()
out = args.work / 'out'


def webp(path, target, quality):
    target.parent.mkdir(parents=True, exist_ok=True)
    Image.open(path).convert('RGBA').save(target, quality=quality, alpha_quality=100, method=6)


if args.shared:
    for folder in ('icons', 'ui'):
        shutil.rmtree(args.target / folder, ignore_errors=True)
    for path in sorted(out.glob('icon-*.png')):
        webp(path, args.target / 'icons' / (path.stem[len('icon-'):] + '.webp'), 94)
    for path in sorted(out.glob('glyph-*.png')):
        webp(path, args.target / 'ui' / (path.stem + '.webp'), 95)
    for name in ('lens-day', 'lens-night'):
        shutil.copyfile(args.work / 'ui' / (name + '.webp'), args.target / 'ui' / (name + '.webp'))
else:
    shutil.rmtree(args.target, ignore_errors=True)
    (args.target / 'glass').mkdir(parents=True)
    for name in ('wall-day', 'wall-night', 'frost-day', 'frost-night', 'thumb'):
        shutil.copyfile(args.work / (name + '.webp'), args.target / (name + '.webp'))
    for path in sorted(out.glob('glass-*.png')):
        webp(path, args.target / 'glass' / (path.stem[len('glass-'):] + '.webp'), 93)
    manifest = json.loads((out / 'glass-manifest.json').read_text())
    (args.target / 'glass/manifest.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
    info = {key: value for key, value in (('name', args.name), ('credit', args.credit), ('source', args.source)) if value}
    (args.target / 'theme.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')

files = [path for path in args.target.rglob('*') if path.is_file()]
print(len(files), 'files,', sum(path.stat().st_size for path in files) // 1024, 'KB in', args.target)
