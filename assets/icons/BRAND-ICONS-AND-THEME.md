# SmartPlay Caddie — branded icons + theme musts
**The single reference. Read this before drawing an icon or picking a colour.**
Last updated 2026-09-11.

---

## 1. THE ICON STYLE LOCK

Every branded icon in this app is the same thing:

- **Thin, even-stroke line art.** No fill, no gradient, no shadow, no 3D.
- **One subject, centred in a thin circle**, filling ~85% of it.
- Drawn in **lime `#88F700`** on **pure black**, then knocked out to transparent.
- Readable at **22 pixels**. That is the size it ships at — judge it there, never at
  full resolution. (Two of three FORMAT candidates died at 22px and looked fine at 256.)

## 2. THE SETS

| folder | what | count |
|---|---|---|
| `assets/icons/smartmotion/` | Smart Motion: rails, controls, angles, metrics, biomech | 34 |
| `assets/icons/play/` | Play tab section headers | 7 |
| `assets/icons/dash/` | Dashboard section headers | 13 |
| `assets/avatars/` | the caddie badge (not line art — the brand mark) | — |

**Play:** strategy · mental · format · your-bag · getting-around · tee-box · notes
**Dash:** current-round · shot-stats · practice-points · practice-history · progress ·
before-round · train-swing · recent-shots · recent-rounds · kevins-read · tell-caddie ·
highlights · new-look

`MY BAG` on the Dashboard **reuses** `play/sec-your-bag.png`. One object, one drawing.

## 3. THEME MUSTS — the rules that are not negotiable

**① Never hardcode a colour in a component.** There are **five** palettes: dark, light,
dark-high-contrast, light-high-contrast, and the base. A hex literal is correct in at most one of
them. Every colour comes from `useTheme()`.

**② Icons tint from `accent_lime`, never from a literal.**
```tsx
<Image source={SEC_ICON.strategy} style={styles.sectionIcon} tintColor={colors.accent_lime} />
```
`accent_lime` resolves to **`#88F700` on dark** and **`#5a9e1a` on light**. The raw brand lime
WASHES OUT on a white field — a contact sheet on white shows it immediately. The light variant was
darkened by the 2026-09-05 contrast pass for exactly this reason.

**③ Test both grounds before shipping any art.** Render it on white AND on dark at 22/32/48px.
Anything that only ever got looked at on one background has not been checked.

**④ A section heading must outrank the controls under it.** The Play tab shipped with headings at
`text_muted` 11pt over chips at `text_muted` 12pt — the heading was quieter and smaller than its own
contents, so it vanished. Headings are `text_primary` 13pt with a hairline rule above.

**⑤ The lime family is NOT the teal accent.** `accent` (teal `#00C896` / `#009e7a`) is buttons,
active states and affordances. `accent_lime` is the icon family and positive deltas. They are
deliberately different channels — do not unify them.

## 4. PRODUCING A NEW ICON

**Prompt ChatGPT** (it has made every set so far and knows the style):

> Produce a single image sheet of icons in the **SmartPlay Caddie icon style** — the same style as
> the Smart Motion and Play-tab sets you made previously.
>
> **Style (must match exactly):** thin, even-stroke **line art in lime green `#88F700`**. No fill,
> no gradient, no shadow, no 3D. Each icon is **one subject centred inside a thin lime-green
> circle**, filling about 85% of it. **Pure black background** (`#000000`), flat and true. Uniform
> stroke weight and identical circle size across every icon. Simple, iconic, readable at 24 pixels.
> No text inside the circles.
>
> **Layout:** an evenly spaced grid with generous gaps. Each icon's name in small lime text **below**
> its circle, clearly separated, never touching the circle.
>
> **Draw these, in this order:** *(list them)*

**Then extract.** The sheet arrives as one image; the pipeline is in
`assets/icons/smartmotion/README.md`. In short: detect content bands (circles are ~200px tall,
labels ~25px, and a divider rule between rows is wide-and-short — skip it), crop each circle
excluding its label, knock black to transparent with a soft edge, bbox-crop, pad to a square with
5% margin, resize to 256×256.

**Then wire.** A `require()` map at the top of the screen, rendered with `tintColor`. Do not import
an icon font for a one-off glyph — a MaterialCommunityIcons branch was added for a single bag icon
and deleted the same day when the branded one replaced it.

## 5. WHAT IS DELIBERATELY *NOT* BRANDED

Navigation chrome stays stock: chevrons, back/forward, close, checkmarks, pencil, trash, refresh,
copy, microphone, camera, download, plain info/alert circles. Branding these makes the app harder to
use and is the fastest way to make a custom set look cluttered rather than considered.

## 6. STILL TO PRODUCE

- Play tab controls: 9-hole, competition, tournament, challenge, walking, cart, course map, tee times
- Tab bar: play, scorecard, swinglab, dashboard (caddie already uses the badge)
- Shot-stat cards: shots-logged, clean-tee, tee-avg, score-trend *(draw score-trend's arrow going
  DOWN — in golf lower is better, and the current up-arrow reads as good news beside a "+15.6")*
- Header pills: streak, elite
