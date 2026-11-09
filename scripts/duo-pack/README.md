# Duo wallpapers

Every Duo wallpaper is a folder of finished images: the picture by day and by night, its frost, and its Liquid Glass pieces for one to nine apps. The TV only ever shows those images, so changing the wallpaper costs it nothing.

## Add a wallpaper

```sh
npm ci
python3 -m pip install numpy pillow
npm run duo:add -- ~/Pictures/photo.jpg --name "Mon fond"
```

Restart the preview and open **Réglages → Fond d’écran**. On a TV, build and install the package again.

| Option | Effect |
| --- | --- |
| `--name "…"` | The name in the gallery. By default, the file's name |
| `--night photo.jpg` | A real night photograph of the same view, instead of the computed night |
| `--sky-from 545` | The row below which the land starts: the night sky is redrawn, with a glow that follows the ridge |
| `--public --credit "…"` | Publish it with the repository, in `duo-pack/themes/`. Only for a picture you may redistribute |
| `--remove <id>` | Remove a wallpaper, with `--public` for a published one |

**Private by default.** Without `--public`, a wallpaper goes to `.local/duo-themes/`, which Git ignores. It enters your own preview and package, and never a public build. `npm run check:public` fails if a published wallpaper has no credit.

## How it is made

1. `make-walls.py` crops the photograph to 1920 × 1080, dims it where the clock and the row need contrast, and computes the night version and the blurred frost.
2. `bake.mjs` opens `lab.html` in a headless browser. A real WebGL refraction shader, in `renderer/`, runs once for each piece of glass, day and night, and the result is flattened with its soft shadow.
3. `pack.py` writes WebP files into the wallpaper's folder.

It takes a minute or two on a computer, then about 1.5 MB per wallpaper on the TV. Only the chosen wallpaper is loaded.

`renderer/` is a copy of the source of [webgl-apple-liquid-glass](https://github.com/Oliverrr2424/webgl-apple-liquid-glass) by Oliver Nemo, under the MIT licence.
