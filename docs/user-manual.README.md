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

## Build user-facing copy from the PICKER, not the type

`type Persona` has five values (`kevin | serena | harry | tank | custom`). A user sees **three**:

- **Kevin** and **Serena** — the two entries in every persona picker in `app/settings.tsx`.
- **My Caddie** — the custom caddie from `app/profile/custom-caddie.tsx`.

`tank` is filtered out of every picker unless `tankEnabled` is switched on in Owner Tools, and
`harry` appears in **no** picker at all — he was removed after a tester found him selectable.

The first draft of this manual listed four personas because it was written from the type union. The
type is what the code can represent; the picker is what the player can choose. For anything
customer-facing, the picker wins.
