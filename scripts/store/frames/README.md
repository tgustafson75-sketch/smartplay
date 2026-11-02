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

## Apple product page (Asset Library, App Store Connect)
- `apple-header-3840x1646.png` (21:9, Product Page Header) — from `header.html` at 1920×823, scale 2.
- `apple-search-3840x2560.png` (3:2, Search Results) — from `search.html` at 1920×1280, scale 2.
Both submitted to Asset Library review on 2026-11-01. Once approved, select them in the version's
"Header and Search Results" section.

## v2 (2026-11-01, evening): replaces the morning header and search assets
- `apple-header-v2-3840x1646.png` from `header-v2.html` (Kevin on course, "Your intelligent golf partner.", spoken club call, veteran badge).
- `apple-search-v2-3840x2560.png` from `search-v2.html` (two real app screens; the v1 search image was upscaled from a 556px crop).
Render both at 1920×823 / 1920×1280 with device scale 2, then save as RGB (no alpha). Shots are copied from the smartplaycaddie.com site repo.
To be placed on iOS 1.0.4 → Header and Search Results.
