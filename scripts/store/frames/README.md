# Store graphics kit

- `feature-graphic-1024x500.png` — Google Play feature graphic (rendered from `feature.html`).
- `render.py` + `frame.html` — turns raw app captures into captioned store screenshots.

## Make the 8 screenshots
1. In Caddie, turn on **Settings → Screenshot mode** (hides the status bar).
2. Capture these 8 screens, in order, named `01.png` … `08.png` into one folder:
   01 caddie answering a spoken question · 02 hole view with the club call · 03 yardages (front/middle/back)
   04 swing analysis result · 05 any clean in-round screen (no-hardware message) · 06 scorecard
   07 history / Kevin's Read · 08 caddie picker (Kevin, Serena, build your own)
3. `python3 render.py <that folder> out` → `out/play/` (1080×1920) and `out/apple/` (1290×2796, no alpha).

Captions live in `CAPTIONS` in `render.py`. Requires Google Chrome and Pillow.
