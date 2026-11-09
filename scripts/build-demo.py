"""Build the browser demo: the real app, the public wallpapers and a simulated TV.

dist/site/ is what GitHub Pages serves, and dist/CleanFrame-demo.zip is the same
page to download and open offline. Nothing here needs a TV, a certificate or a
private file.
"""
from pathlib import Path
import shutil
import tempfile
import zipfile

from font_assets import ROOT, write_widget_archive

site = ROOT / 'dist/site'
if site.exists():
    shutil.rmtree(site)
(site / 'app').mkdir(parents=True)
with tempfile.TemporaryDirectory() as work:
    widget = Path(work) / 'public.wgt'
    write_widget_archive(widget, include_private=False)
    with zipfile.ZipFile(widget) as archive:
        archive.extractall(site / 'app')

page = (site / 'app/index.html').read_text(encoding='utf-8')
marker = '<script src="device.js"></script>'
assert marker in page, 'The app page no longer loads device.js as expected'
(site / 'app/index.html').write_text(page.replace(marker, '<script src="demo-tv.js"></script>\n' + marker, 1), encoding='utf-8')
shutil.copyfile(ROOT / 'demo/demo-tv.js', site / 'app/demo-tv.js')
shutil.copyfile(ROOT / 'demo/index.html', site / 'index.html')
for notice in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
    shutil.copyfile(ROOT / notice, site / notice)
(site / '.nojekyll').touch()

output = ROOT / 'dist/CleanFrame-demo.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(site.rglob('*')):
        if path.is_file() and path.name != '.nojekyll':
            archive.write(path, Path('CleanFrame-demo') / path.relative_to(site))
print('Built ' + str(site.relative_to(ROOT)) + ' and ' + str(output.relative_to(ROOT)))
