# CleanFrame TV 0.8.0

The first public release of this fork: a new home screen, Duo, on top of CleanFrame 0.7.0 by Nathan Clark.

- **Duo home screen:** a tall clock, baked Liquid Glass and apps and HDMI sources in one row.
- **Change the wallpaper at will:** a gallery in Réglages → Fond d’écran, with free photographs included. `npm run duo:add` turns any photograph into a wallpaper, night version and glass included, and keeps it private by default.
- **Day and night from the real sun**, computed offline.
- **Motion and sound:** an ES5 spring engine played by the compositor, and eight sound styles.
- **Tried on a real 2018 Frame** (Tizen 4.0, Chromium 56). The wallpaper gallery itself has not been tried on a TV yet.

## Downloads

- `CleanFrame-demo.zip`: unzip it and open `index.html` in a browser. It runs on a simulated TV, and nothing is launched.
- `CleanFrame-public-unsigned.wgt`: the TV package, **unsigned**. A Samsung TV only installs a package signed with your own certificate. Follow [the setup guide](docs/for-agents.md), and create your own app identity.

Third-party assets keep the terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). CleanFrame TV is an independent project, not affiliated with Samsung, Apple or any streaming service.
