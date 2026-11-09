"""Build the exact private-font overlay used by preview and local packaging.

Pangram binaries remain in ignored .local/ storage. A public checkout ships
Manrope, Geist and Newsreader. Complete local Pangram pairs are added directly
to the widget ZIP; they are never copied into app/.
"""
from pathlib import Path
import json
import re
import zipfile
from local_config import override_floor, override_identity
from private_files import check_widget, generated_path, private_path, secret_content

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FONT_IDS = ['geist', 'newsreader']
DEFAULT_DUO_WALL, PRIVATE_DUO_WALL = 'mon-fond', 'perso'
DUO_THEME_FILES = ['wall-day.webp', 'wall-night.webp', 'frost-day.webp', 'frost-night.webp', 'thumb.webp']
PRIVATE_FONTS = [
    {
        'id': 'montreal', 'family': 'Study Montreal', 'folder': 'neue-montreal',
        'files': [('PPNeueMontreal-Light.ttf', 300), ('PPNeueMontreal-Regular.ttf', 400)],
        'metrics': 'size-adjust:100.699301%;ascent-override:105.859722%;descent-override:29.791667%;line-gap-override:0%',
    },
    {
        'id': 'mori', 'family': 'Study Mori', 'folder': 'mori',
        'files': [('PPMori-Extralight.ttf', 200), ('PPMori-Regular.ttf', 400)],
        'metrics': 'size-adjust:102.857143%;ascent-override:103.638889%;descent-override:29.166667%;line-gap-override:0%',
    },
    {
        'id': 'pangram', 'family': 'Study Pangram', 'folder': 'pangram-sans',
        'files': [('PPPangramSans-Light.ttf', 300), ('PPPangramSans-Regular.ttf', 400)],
        'metrics': 'size-adjust:101.408451%;ascent-override:105.119444%;descent-override:29.583333%;line-gap-override:0%',
    },
]


def is_runtime_source(name):
    """Keep retained rendering tools and legacy layout assets out of the widget."""
    if name in ['grid.css', 'optics.js']:
        return False
    if name.startswith(('assets/grid/', 'assets/vendor/')):
        return False
    return not re.fullmatch(r'assets/wallpapers/[^/]+-glass-\d+\.png', name)


def duo_theme(folder, theme_id, fallback_name):
    """One Duo wallpaper with everything baked on it, or None when the folder holds no finished bake."""
    folder = folder.resolve()
    try:
        glass = json.loads((folder / 'glass/manifest.json').read_text())
    except (OSError, ValueError):
        return None
    try:
        info = json.loads((folder / 'theme.json').read_text())
    except (OSError, ValueError):
        info = {}
    files = {}
    for path in [folder / name for name in DUO_THEME_FILES] + sorted((folder / 'glass').glob('*.webp')):
        # Exclude symlinks that leave the folder.
        if path.is_file() and path.resolve().is_relative_to(folder):
            files['assets/duo/themes/' + theme_id + '/' + path.relative_to(folder).as_posix()] = path
    return {'id': theme_id, 'name': info.get('name') or fallback_name, 'glass': glass, 'files': files,
            'thumb': (folder / 'thumb.webp').is_file()}


def duo_overlay(root, include_private=True):
    """Duo's wallpapers: the public ones in duo-pack/, and in a personal build an owner's own from .local/, which come first."""
    pack, private = root / 'duo-pack', root / '.local/duo'
    candidates = []
    if include_private:
        candidates.append((private, PRIVATE_DUO_WALL, 'Dunes'))
        candidates += [(folder, folder.name, folder.name) for folder in sorted((root / '.local/duo-themes').glob('*/'))]
    public = sorted((pack / 'themes').glob('*/'), key=lambda folder: (folder.name != DEFAULT_DUO_WALL, folder.name))
    candidates += [(folder, folder.name, folder.name) for folder in public]
    themes = {}
    for folder, theme_id, name in candidates:
        theme = duo_theme(folder, theme_id, name) if re.fullmatch(r'[a-z0-9-]+', theme_id) else None
        # Every wallpaper shares one geometry, because the app places the glass from a single manifest.
        if theme and theme_id not in themes and (not themes or theme['glass'] == next(iter(themes.values()))['glass']):
            themes[theme_id] = theme
    if not themes:
        return {}
    assets = {}
    for source in ([private] if include_private else []) + [pack]:
        source = source.resolve()
        for path in sorted(list(source.glob('icons/*.webp')) + list(source.glob('ui/*.webp'))):
            if path.resolve().is_relative_to(source) and path.is_file():
                assets.setdefault('assets/duo/' + path.relative_to(source).as_posix(), path)
    for theme in themes.values():
        assets.update(theme['files'])
    listed = list(themes.values())
    default = PRIVATE_DUO_WALL if PRIVATE_DUO_WALL in themes else DEFAULT_DUO_WALL if DEFAULT_DUO_WALL in themes else listed[0]['id']
    catalog = {'glass': listed[0]['glass'], 'icons': sorted(name[len('assets/duo/icons/'):-len('.webp')] for name in assets if name.startswith('assets/duo/icons/')),
               'walls': [{'id': theme['id'], 'name': theme['name'], 'thumb': theme['thumb']} for theme in listed], 'wall': default}
    assets['assets/duo-catalog.js'] = ('window.CleanFrameDuo = ' + json.dumps(catalog, separators=(',', ':'), ensure_ascii=False) + ';\n').encode()
    return assets


def font_overlay(root=ROOT, include_private=True, include_duo=True):
    """Return package-relative paths mapped to bytes or allowlisted private files."""
    sources = (root / '.local/research/font-candidates').resolve()
    assets = {}
    private_ids = []
    css = ['/* Local font overlay. Proprietary binaries are not part of app/. */']
    if include_private:
        for font in PRIVATE_FONTS:
            files = [(sources / font['folder'] / name).resolve() for name, _ in font['files']]
            # Exclude incomplete pairs and symlinks that leave the private font folder.
            if not all(path.is_relative_to(sources) and path.is_file() for path in files):
                continue
            private_ids.append(font['id'])
            for (name, weight), source in zip(font['files'], files):
                relative = font['folder'] + '/' + name
                assets['assets/private-fonts/' + relative] = source
                css.append("@font-face{font-family:'" + font['family'] + "';font-style:normal;"
                           'font-weight:' + str(weight) + ";src:url('private-fonts/" + relative + "') format('truetype');"
                           'font-display:block;' + font['metrics'] + '}')
    assets['assets/private-fonts.css'] = ('\n'.join(css) + '\n').encode()
    assets['assets/font-catalog.js'] = ('window.CleanFramePrivateFontIDs = '
                                       + json.dumps(private_ids + PUBLIC_FONT_IDS) + ';\n').encode()
    assets['assets/duo-catalog.js'] = b'window.CleanFrameDuo = null;\n'
    if include_duo:
        assets.update(duo_overlay(root, include_private))
    return assets


def write_widget_archive(output, root=ROOT, include_private=True, identity=None, floor=None):
    """Create an unsigned archive without reading signing or device settings."""
    app = root / 'app'
    overlay = font_overlay(root, include_private)
    if identity is not None or floor is not None:
        manifest = (app / 'config.xml').read_bytes()
        if identity is not None:
            manifest = override_identity(manifest, identity)
        if floor is not None:
            manifest = override_floor(manifest, floor)
        overlay['config.xml'] = manifest
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED, allowZip64=False) as package:
        for source in sorted(app.rglob('*')):
            name = source.relative_to(app).as_posix()
            # SDK build output is never an input, even for a personal build.
            # Skip it before inspecting copied keys, fonts or symlinks.
            if generated_path(name):
                continue
            if source.is_symlink():
                raise ValueError('Widget assets must be regular files, not symlinks: ' + name)
            if not source.is_file():
                continue
            if private_path(name) or secret_content(source.read_bytes()):
                raise ValueError('Private material in app source: ' + name)
            if name.startswith(('assets/private-fonts/', 'assets/duo/')):
                raise ValueError('Private font and Duo files must stay in .local/, not app/.')
            if name not in overlay and is_runtime_source(name):
                package.write(source, name)
        for name, source in sorted(overlay.items()):
            if isinstance(source, Path):
                package.write(source, name)
            else:
                package.writestr(name, source)
    check_widget(output)

