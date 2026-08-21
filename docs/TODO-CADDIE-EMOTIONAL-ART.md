# TODO (maybe-launch) — emotional-state art per caddie

**Asked by Tim 2026-08-21:** "add a few more images for each caddy for their emotional states."

## The gap, measured

`components/CaddieAvatar.tsx` defines **22 emotional slots** (idle, listening, explaining, focused,
determined, pensive, inquisitive, mentorship, humble, supportive, happy, enthusiastic, surprised,
celebrating, confident, gameface, curious, wincing, self_critical, nod, dark, course).

| caddie | distinct images across 22 slots | worst reuse |
|---|---|---|
| Harry  | **18** | one image covers 2 moods |
| Kevin  | 24 (incl. light/dark variants) | — |
| Tank   | 11 | one image covers 3 moods |
| **Serena** | **4** | **one portrait covers 15 of 22 moods** |

**Serena is the outlier by a wide margin.** Fifteen different emotional states render the same
neutral studio portrait, so on her the avatar is effectively static — it cannot react to a great
shot, a bad stretch, or a question. Tank is second-worst but usable.

This matters more than it looks. The avatar is the only continuous *visual* signal that the caddie
is reacting to the player at all — the mental-game work (`log_emotional_state`, spiral reset) is
audible but invisible. A caddie whose face never changes reads as a system that isn't listening,
which undercuts the thing the product is for.

## Priority order

1. **Serena** — biggest win by far. The 8 highest-frequency slots first: `idle`, `listening`,
   `happy`, `supportive`, `wincing`, `celebrating`, `focused`, `explaining`.
2. **Tank** — fill the 3-way reuses.
3. Kevin/Harry — already adequate; leave alone.

## Notes for whoever generates these
- Match the existing naming so the map is a one-line change per slot:
  `serena_moods_<slot>.png` / `serena_expressive_<slot>.png`.
- **No baked-in text labels.** Tank's legacy set had emotion names rendered into the image bottom
  ("Relief", "Facepalm") and they were visible on the Caddie tab in testing. That set was deleted.
- Source material exists: `~/Downloads/SmartPlay/Avatars/` (125 files, kevin_variants + kevin_avatars).
- Adding image assets is **OTA-safe** — no native module, no plugin. It ships without a rebuild.

---

## Generation spec (added 2026-08-21)

I checked `~/Downloads` for existing art before writing this: the 125 files there are Harry/Kevin
duplicates (` 2`, ` 3`, ` 4` copies), and Serena's set is the **same four images already in the
repo**. There is nothing to wire — the art genuinely has to be made. I can't generate images, so
this is the spec that makes dropping them in a five-minute job.

### Filenames the code will expect

Drop into `assets/avatars/`. Naming matches Harry's convention so the map edit is one line per slot:

```
serena_expressive_friendly_smile.png   → idle, nod
serena_expressive_attentive.png        → listening, curious
serena_expressive_warm_smile_wide.png  → happy
serena_moods_approving.png             → supportive
serena_expressive_exasperated.png      → wincing
serena_expressive_celebrating.png      → celebrating
serena_moods_serious.png               → focused, dark
serena_moods_pointing_at_you.png       → explaining
```

Eight images close the worst of the gap (15 moods currently share one portrait → 8 distinct).

### Prompt guidance — keep her consistent

Anchor on the existing `serena-studio-portrait-001.png` for face, hair, build and kit, then vary
only the expression. Her character doc defines the register, and the art should match it:

> *Composed, supportive without softness, encouraging without saccharine. Quietly confident
> professional. Doesn't oversell. Doesn't underdeliver.* Former competitive amateur — "she doesn't
> have to project confidence, she has it because she has been there."

So: **understated expressions.** Her "celebrating" is a controlled, genuine smile, not a fist pump.
Her "wincing" is a small flicker of sympathy, not a grimace. Overplaying the range would contradict
the persona the brain is already speaking in, and the mismatch would be more jarring than the static
portrait we have now.

### Hard requirements
- **No baked-in text labels.** Tank's legacy set had emotion names rendered into the image and they
  were visible on the Caddie tab in testing; that whole set had to be deleted.
- Same framing/crop as the existing portraits, or the avatar will jump as the mood changes.
- Transparent or matching background, consistent with the current set.
- PNG. Assets are **OTA-safe** — this ships without a native rebuild.
