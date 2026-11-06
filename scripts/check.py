"""Check that the widget manifest and its referenced files are present."""
from pathlib import Path
import json
import xml.etree.ElementTree as XML
import re

# Chromium 85 lacks these, and a newer preview browser would hide the break until the TV.
ABSENT_CSS = {
    r'(?<![-\w])linear\(': 'linear() easing',
    r'(?<![-\w])color-mix\(': 'color-mix()',
    r'(?<![-\w])(?:oklch|oklab|lch|lab|hwb|color)\(': 'modern colour functions',
    r'(?<![-\w])image-set\(': 'unprefixed image-set()',
    r'(?:^|[;{}])\s*aspect-ratio\s*:': 'aspect-ratio',
    r'(?:^|[;{}])\s*(?:translate|rotate|scale)\s*:': 'individual transform properties',
    r'(?:^|[;{}])\s*accent-color\s*:': 'accent-color',
    r'(?:^|[;{}])\s*text-wrap\s*:': 'text-wrap',
    r'(?:^|[;{}])\s*(?:margin|padding)-(?:inline|block)\s*:': 'logical margin and padding shorthands',
    r'(?:^|[;{}])\s*overflow(?:-[xy])?\s*:\s*clip\b': 'overflow: clip',
    r':(?:is|where|has)\(': ':is(), :where() and :has()',
    r':not\([^)]*,': 'selector lists in :not()',
    r'@(?:container|layer)\b': '@container and @layer',
    r'\d(?:d|s|l)v[hw]\b': 'dynamic viewport units',
}
ABSENT_JS = {
    r'\.at\(': 'Array.prototype.at()',
    r'Object\.hasOwn\b': 'Object.hasOwn()',
    r'\bstructuredClone\b': 'structuredClone()',
    r'\.replaceChildren\(': 'replaceChildren()',
    r'\.findLast(?:Index)?\(': 'findLast()',
    r'\.to(?:Sorted|Reversed|Spliced)\(': 'copying array methods',
    r'\brandomUUID\b': 'crypto.randomUUID()',
    r'AbortSignal\.timeout\b': 'AbortSignal.timeout()',
    r'\bstartViewTransition\b': 'view transitions',
}

root = Path(__file__).resolve().parents[1]
app = root / 'app'
manifest = XML.parse(app / 'config.xml').getroot()
ns = {'w': 'http://www.w3.org/ns/widgets', 't': 'http://tizen.org/ns/widgets'}
identity = manifest.find('t:application', ns)
assert identity is not None, 'Missing application identity'
assert identity.get('package') == 'nClrkHome1', 'Keep the installed package identity stable'
assert identity.get('id') == 'nClrkHome1.FrameHome', 'Keep the installed application ID stable'
assert manifest.get('version') == json.loads((root / 'package.json').read_text())['version'], 'Manifest/package versions differ'
for tag in ['content', 'icon']:
    node = manifest.find('w:' + tag, ns)
    assert node is not None and (app / node.get('src', '')).is_file(), 'Missing ' + tag + ' file'
assert all((app / name).is_file() for name in ['main.js', 'style.css'])
for reference in ['assets/wallpapers/catalog.js', 'assets/adaptive-ink.js', 'assets/font-catalog.js', 'assets/duo-catalog.js']:
    assert (app / reference).is_file(), 'Missing runtime catalogue: ' + reference
# A public build must not name private files: the real Duo catalogue only exists in the build overlay.
assert (app / 'assets/duo-catalog.js').read_text().strip() == 'window.CleanFrameDuo = null;', 'The Duo catalogue in app/ must stay empty'
assert not (app / 'assets/duo').exists(), 'Duo wallpaper and glass must stay in .local/duo/'
duo_clock = json.loads(re.sub(r'^window\.CleanFrameDuoClock = |;\s*$', '', (app / 'assets/duo-clock/clock.js').read_text()))
assert set(duo_clock['glyphs']) == set('0123456789:'), 'The Duo clock needs every digit and the colon'
for glyph in duo_clock['glyphs'].values():
    for scheme in ['day', 'night']:
        assert (app / ('assets/duo-clock/' + scheme + '/' + glyph['file'] + '.webp')).is_file(), 'Missing Duo digit: ' + scheme + '/' + glyph['file']
# The sounds stay in the source: they are computed here, or CC0 with their licence beside them.
sounds = json.loads(re.sub(r'^window\.CleanFrameSounds = |;\s*$', '', (app / 'assets/sounds/bank.js').read_text()))
assert set(sounds['families']) == {'verre', 'goutte', 'zen', 'galet', 'bois', 'feutre', 'bronze', 'ardoise'}, 'The Duo needs its eight sound styles'
gestures = {'edge', 'switch', 'ok', 'back', 'panelIn', 'panelOut', 'wake', 'launch', 'sourceOn', 'sourceOff', 'error'} | {'select%d' % i for i in range(sounds['notes'])}
for name, family in sounds['families'].items():
    assert set(family['sounds']) == gestures, 'Missing a gesture in the sound style: ' + name
    assert (app / 'assets/sounds' / family['file']).stat().st_size == 2 * sum(count for _, count in family['sounds'].values()), 'The sound table and samples differ: ' + name
assert (app / 'assets/sounds/LICENSE-AUDIO').is_file(), 'Zen keeps its licence beside the sounds'
for filename in ['index.html']:
    source = (app / filename).read_text()
    pattern = r'(?:src|href)=[\"\']([^\"\']+)' if filename.endswith('.html') else r'from\s+[\"\']([^\"\']+)'
    for reference in re.findall(pattern, source):
        if ':' in reference or reference.startswith('$'):
            continue
        assert (app / reference).is_file(), 'Missing bundled resource: ' + reference
        if filename.endswith('.js'):
            assert reference.startswith(('./', '../')), 'Module imports must be relative paths'
for css in app.rglob('*.css'):
    source = re.sub(r'/\*.*?\*/', '', css.read_text(), flags=re.S)
    assert not re.search(r'(?:^|[;{}])\s*inset\s*:', source, re.I), 'Use explicit edges for Chromium 85: ' + str(css.relative_to(app))
    assert not re.search(r'(?:^|[;{}])\s*(?:row-|column-)?gap\s*:', source, re.I), 'Use child margins for older flex engines: ' + str(css.relative_to(app))
    for pattern, feature in ABSENT_CSS.items():
        assert not re.search(pattern, source, re.I), 'Chromium 85 lacks ' + feature + ': ' + str(css.relative_to(app))
    for reference in re.findall(r'url\([\"\']?([^\)\"\']+)', source):
        if ':' not in reference:
            assert (css.parent / reference.split('?')[0]).is_file(), 'Missing CSS resource: ' + reference
for script in app.rglob('*.js'):
    source = script.read_text()
    for pattern, feature in ABSENT_JS.items():
        assert not re.search(pattern, source), 'Chromium 85 lacks ' + feature + ': ' + str(script.relative_to(app))
# These resource names are constructed at runtime, so HTML/CSS reference checks cannot find them.
walls = json.loads((app / 'assets/wallpapers/SOURCES.json').read_text())
for wall in walls:
    for field in ['src', 'thumb']:
        assert (app / wall[field]).is_file(), 'Missing wallpaper: ' + wall[field]
    wall_id = wall['id']
    for suffix in ['study-soft', 'field-blur', 'field-frost', 'field-clear']:
        assert (app / ('assets/materials/' + wall_id + '-' + suffix + '.jpg')).is_file(), 'Missing registered material: ' + wall_id + '/' + suffix
    assert (app / ('assets/wallpapers/' + wall_id + '-panel.jpg')).is_file(), 'Missing panel backdrop: ' + wall_id
for icon in ['stremio', 'netflix', 'disneyplus', 'youtube', 'appletv', 'primevideo', 'abciview', 'sbs', 'applemusic', 'art', 'apps', 'settings']:
    assert (app / ('assets/icons/' + icon + '.svg')).is_file(), 'Missing icon: ' + icon
print('Widget identity, version and bundled resources are valid.')
