# Smart Motion icon system — STYLE LOCK (2026-06-12)

Tim's custom green-line icon set for Smart Motion. **Every new icon must match this spec**
so the set stays cohesive as it grows (body tilt, posture, sway, weight, etc.).

## The look
- **Green line art on a circular badge.** Thin, even stroke. No fill, no shadows.
- **Canonical icon green: `#88F700`** (bright lime). NOTE: this is intentionally brighter
  than the app theme accent (`#00C896`, teal — see `theme/tokens.ts`). The icon set is its
  own lime family; keep new icons on `#88F700`, not the teal accent.
- **One subject per badge**, centred, sized to fill ~85% of the circle.
- Transparent background (black knocked out) so the badge floats on the camera/UI.

## Generating a new icon (ChatGPT / source art)
Prompt for: *"a single [subject] as a thin lime-green (#88F700) line icon centred inside a
thin lime-green circle, on a pure black background, flat, no fill, no shadow."* Generate the
set on one sheet (evenly spaced columns) the same way the existing ones were.

## Processing a source sheet → app assets
1. **Crop** each icon's circle out of the sheet, EXCLUDING any text label
   (ffmpeg `crop=W:H:X:Y` — keep Y/H above the labels).
2. **Knock out black → transparent:** `ffmpeg -vf "...,colorkey=0x000000:0.16:0.10"`.
3. **Centre precisely** (so it sits dead-centre in a round button): PIL bbox-crop + pad to a
   symmetric square with ~5% margin:
   ```python
   im=Image.open(p).convert('RGBA'); c=im.crop(im.getbbox())
   s=max(c.size); m=int(s*0.05); side=s+2*m
   sq=Image.new('RGBA',(side,side),(0,0,0,0)); sq.paste(c,((side-c.width)//2,(side-c.height)//2),c); sq.save(p)
   ```

## Naming + wiring
- Names: `category-name.png` — `rail-*`, `ctrl-*`, `env-*`, `angle-*`, `feature-*`, and (next)
  `biomech-*` (e.g. `biomech-tilt.png`, `biomech-posture.png`, `biomech-sway.png`, `biomech-weight.png`).
- Wire via a `require()` map in `app/swinglab/smartmotion.tsx` (`ICON_RAIL`, `ICON_CTRL`,
  `ICON_ANGLE`, `ICON_ENV`, …) and render with **`styles.toolBtnBare`** (the icon's OWN circle
  IS the button — no extra border) + **`styles.toolIconFull`** (46px). A faint green fill
  (`toolBtnBareActive`) marks the on/active state.

## Current assets
- Rail: `rail-calibrate` `rail-ballbox` `rail-selfie` `rail-chip` + `env-{cage,range,course}` + `club-detect`
- Angle badges: `angle-{dtl,faceon,putt}`  · Controls: `ctrl-{record,playpause,slowmo,delete,save,stop}`
- Metric badges: `metric-{tempo,ballspeed,ballresult,clubpath,faceangle,smash}` · Biomech: `biomech-{sway,tilt,posture,weight,shoulder,hip}`
- Feature marks (saved, not yet wired): `feature-{smartmotion,swingvision}`

> NOTE: `ctrl-stop`, `metric-clubpath`, `biomech-shoulder`, `biomech-hip` (2026-06-12) were
> rendered programmatically (PIL, `/tmp/gen_icons.py`) to this exact spec — thin `#88F700`
> line art, no fill, transparent, ~85% of a thin lime circle — because they're geometric
> (square / rotation arrows / swept arc). Swap with hand-made ChatGPT versions anytime; the
> `require()` maps already point at these names.
