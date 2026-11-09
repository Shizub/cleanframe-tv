// Turns any photograph into a Duo wallpaper, glass included.
//   npm run duo:add -- photo.jpg --name "Mon fond"
//   npm run duo:add -- --remove mon-fond
// A wallpaper stays private, in the ignored .local/duo-themes/, unless --public
// asks for the repository's duo-pack/, which needs --credit.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { root } from '../browser.mjs';

const USAGE = `Add a wallpaper to the Duo gallery:
  npm run duo:add -- <photo> [--name "Name"] [--id some-id] [--night <photo>] [--sky-from <row>]
  npm run duo:add -- <photo> --public --credit "Author, licence" [--source <url>]
Remove one:
  npm run duo:add -- --remove <id> [--public]`;

const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
  name: { type: 'string' }, id: { type: 'string' }, night: { type: 'string' }, 'sky-from': { type: 'string' },
  public: { type: 'boolean', default: false }, credit: { type: 'string' }, source: { type: 'string' },
  remove: { type: 'string' }, help: { type: 'boolean', default: false },
} });

function stop(message) { console.error(message); process.exit(2); }
const slug = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const folderFor = id => join(root, options.public ? 'duo-pack/themes' : '.local/duo-themes', id);

if (options.help) { console.log(USAGE); process.exit(0); }
if (options.remove) {
  const folder = folderFor(slug(options.remove));
  if (!existsSync(folder)) stop('No such wallpaper: ' + folder);
  rmSync(folder, { recursive: true });
  console.log('Removed ' + folder);
  process.exit(0);
}
const photo = positionals[0] && resolve(positionals[0]);
if (!photo) stop(USAGE);
if (!existsSync(photo)) stop('No such photograph: ' + photo);
if (options.public && !options.credit) stop('--public needs --credit: only add a picture you may redistribute, and say whose it is.');

const name = options.name || basename(photo, extname(photo));
const id = slug(options.id || name);
if (!id) stop('Give this wallpaper a --name made of letters or digits.');
if (id === 'perso') stop('"perso" is kept for the private set in .local/duo/.');

const venv = join(root, '.local/venv/bin/python');
const python = process.env.CLEANFRAME_PYTHON || (existsSync(venv) ? venv : 'python3');
if (spawnSync(python, ['-c', 'import numpy, PIL']).status !== 0) stop('This needs NumPy and Pillow: python3 -m pip install numpy pillow');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) stop('Stopped: ' + basename(args[0]) + ' failed.');
}

const script = file => join(root, 'scripts/duo-pack', file);
const work = mkdtempSync(join(tmpdir(), 'duo-wallpaper-'));
try {
  console.log('1/3 Wallpapers for day and night');
  run(python, [script('make-walls.py'), photo, work,
    ...(options.night ? ['--night', resolve(options.night)] : []), ...(options['sky-from'] ? ['--sky-from', options['sky-from']] : [])]);
  console.log('2/3 Glass, baked once (this takes a minute or two)');
  run(process.execPath, [script('bake.mjs'), work]);
  console.log('3/3 Into the gallery');
  run(python, [script('pack.py'), work, folderFor(id), '--name', name,
    ...(options.credit ? ['--credit', options.credit] : []), ...(options.source ? ['--source', options.source] : [])]);
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Added "${name}". Restart the preview, then open Settings > Fond d'écran.`);
console.log(options.public ? 'It will ship in the public repository and downloads.' : 'It stays on this computer: .local/ is never published.');
