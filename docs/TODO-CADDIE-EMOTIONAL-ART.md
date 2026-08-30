# PRE-LAUNCH — a clean 22 emotional states per caddie

> ## ✅ SERENA: EIGHT LANDED 2026-08-30 — 4 distinct → 11, worst reuse 15x → 5x
>
> Cowork generated the eight highest-traffic moods from the spec below: idle, listening, happy,
> supportive, wincing, celebrating, focused, explaining. Wired in `components/CaddieAvatar.tsx`.
> Shipped as JPEG q82 (140 KB each, 1.1 MB total) — the source PNGs were 2.1 MB each and 17 MB for
> the set, which is real weight on a bundle near its budget and inside every future OTA.
>
> **Still open — five slots on the neutral studio portrait:** `pensive`, `inquisitive`, `humble`,
> `surprised`, `confident`. Deliberately not forced onto a near-neighbour: a wrong face is worse
> than a neutral one. Same prompt, same reference, same rules — the brief is at
> `~/Desktop/SmartPlay-Project-Files/reference/serena-art-cowork-prompt.md`.
>
> Tank remains the nice-to-have at ~8 images. Kevin (20 distinct) and Harry (18) need nothing.

**Status raised to PRE-LAUNCH by Tim, 2026-08-21:** *"it needs to be on prelaunch that we need the
clean twenty two emotional states at least for each Caddy. Serena and Kevin."*

> ## ⚠️ CORRECTED 2026-08-24 (backtrack audit) — THIS DOC OVERSTATES THE JOB
>
> Counted directly from the require() maps in `components/CaddieAvatar.tsx`:
>
> | Caddie | Slots | Distinct images | Worst |
> |---|---|---|---|
> | **Kevin** | 22 | **20** ✅ | 2× kevin-idle |
> | **Harry** | 22 | 18 ✅ | 2× serious |
> | **Tank** | 22 | 11 ⚠️ | 3× portrait |
> | **Serena** | 22 | **4** ❌ | **15× serena-studio-portrait** |
>
> **Kevin does NOT route 15 slots to one image — his worst duplicate is 2×.** The claim below
> (and the matching memory line) was wrong. The real job is **Serena only, ~16 images**, with
> Tank a nice-to-have at ~8. Everything else in this doc — filenames, prompt spec, OTA-safety —
> still stands. See `docs/BACKTRACK-2026-08-24.md` §4.

Not a nice-to-have and not partial coverage. **Serena and Kevin each need all 22 slots filled with
distinct, purpose-made art** — the eight-image patch below is a floor, not the goal.

Why both, not just Serena: Kevin looks well-supplied by file count, but his map still routes **15 of
his mood slots to a single image**. On the two caddies testers actually use, the avatar barely moves.

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

1. **Serena — all 22.** Worst offender: 4 distinct images, one portrait covering 15 slots.
2. **Kevin — all 22.** Looks fine by file count, but 15 slots still resolve to one image.
3. Tank — fill the 3-way reuses (post-launch acceptable).
4. Harry — 18 distinct already; leave alone.

If the full 22 cannot be produced in time for either, these 8 carry the most weight and should be
made first: `idle`, `listening`, `happy`, `supportive`, `wincing`, `celebrating`, `focused`,
`explaining`.

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
