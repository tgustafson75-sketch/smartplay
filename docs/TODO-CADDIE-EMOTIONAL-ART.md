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
