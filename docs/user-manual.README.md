# User Manual — source

`docs/user-manual.html` is the source for the customer-facing PDF.

Render it:

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$HOME/Desktop/SmartPlay-Caddie-User-Manual.pdf" \
  "file://$PWD/docs/user-manual.html"
```

Self-contained: no external fonts, images or scripts, so it renders identically
anywhere and needs no network.

**Keep it honest.** The manual's closing section promises that SmartPlay labels
what it measures, estimates and cannot know. Every claim in here was checked
against the code on 2026-08-13 — the personas, the five tabs, the trust levels,
the F/M/B markers, the drill protocols, the ball-fit limits. If a feature
changes, change this too; a manual that overstates the app is worse than no
manual, because the app's whole credibility rests on saying only what it can
back up.
