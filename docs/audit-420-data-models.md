# Phase 420 Audit: Data models — multi-player readiness verdict

**Audit date:** 2026-05-20
**Scope:** core persisted data models in `store/`, `types/`, and the
voice transcription pipeline. Investigation only — no fixes.
**Standing decision being audited:** core models must include
`player_id`, `speaker_id`, and roster fields **even in single-player
mode**, so multi-player launch later doesn't force a painful AsyncStorage
migration across the existing tester base.

**Methodology:** read-only inspection of `store/roundStore.ts`,
`store/playerProfileStore.ts`, `types/plan.ts`, `types/cage.ts`,
`types/voiceIntent.ts`, `types/parsedShot.ts`, `services/cageStorage.ts`,
`app/api/parse-shot+api.ts`, `services/voiceService.ts`, plus
`grep -rn "player_id|speaker_id|roster|players:|playerIds"`.

---

## Verdict by field

| Field | Status | Where it lives | Where it's missing |
|---|---|---|---|
| `player_id` on shots | **PRESENT (reserved)** | `store/roundStore.ts:99`, defaulted to `'primary'` at `roundStore.ts:1124` | — |
| `player_id` on plans | **PRESENT** | `types/plan.ts:11`, defaulted to `'primary'` at `roundStore.ts:681` | — |
| `player_id` on cage sessions | **PRESENT** | `types/cage.ts:3`, `services/cageStorage.ts:51, 190` | — |
| `player_id` on profile | **MISSING** | — | `store/playerProfileStore.ts` has NO `player_id` field. Profile is implicitly identified by "the device" |
| `player_id` on `RoundRecord` | **MISSING** | — | `store/roundStore.ts:137-172` `RoundRecord` interface has no `player_id`; round is implicitly owned by the device |
| `speaker_id` on shots | **PRESENT (reserved, unused)** | `store/roundStore.ts:100` reserved for "Phase 1.1 multi-player voice ID" | Never written anywhere; no path in `logShot` populates it |
| `speaker_id` on cage clips | **PRESENT** | `types/cage.ts:21`, hardcoded `'primary'` at `services/cageStorage.ts:127, 182-186` | — |
| `speaker_id` on voice intents | **MISSING** | — | `types/voiceIntent.ts:6-12` `VoiceIntent` has `intent_type / parameters / confidence / follow_up_question / raw_text` — no speaker. Every utterance is unattributed |
| `speaker_id` on parsed shots | **MISSING** | — | `types/parsedShot.ts:1-10` `ParsedShotRecord` has `raw_utterance` but no speaker |
| `player_roster` on cage sessions | **PRESENT** | `types/cage.ts:11`, defaulted to `['primary']` at `services/cageStorage.ts:59, 198` | — |
| `players` / roster on round | **MISSING** | — | `RoundState` and `RoundRecord` have zero roster concept |
| `players` / roster on profile | **MISSING** | — | Profile is a single user; no notion of "household" or "playing group" |

---

## Detailed findings

### 1. `ShotResult.player_id` — reserved but soft

**File:** `store/roundStore.ts:73-120`
**Field:** `player_id?: string;  // reserved for Phase 1.1 multi-player`

```text
99:  player_id?: string;        // reserved for Phase 1.1 multi-player
100: speaker_id?: string;       // reserved for Phase 1.1 multi-player voice ID
```

- Optional (`?:`), so older persisted shots load without it.
- `logShot` (`roundStore.ts:1108-1156`) defaults it to `'primary'` at line 1124:
  ```
  player_id: shot.player_id ?? 'primary',
  ```
- Net: every shot written from today forward gets `player_id = 'primary'`. Old shots in `roundHistory[]` (persisted before this default) have `player_id === undefined`.

**Recommendation:** Write a migration in the `migrate:` callback at `store/roundStore.ts:1260-1278` (currently only handles `version === 0` → outcome backfill). Bump `version: 1` to `version: 2` and back-fill `player_id = 'primary'` on every shot in every `roundHistory[].shots[]` so the field is non-null after migration. Without it, any future multi-player feature that filters by `player_id` will silently drop the entire pre-migration history.

### 2. `ShotResult.speaker_id` — reserved but NEVER WRITTEN

**File:** `store/roundStore.ts:100`
**Field:** `speaker_id?: string;`

- The interface declares it. The `logShot` action at line 1108-1156 **does NOT touch it**.
- Grep confirms: `speaker_id` appears in `store/roundStore.ts:100` (declaration) and `types/cage.ts:21` (cage only). No `logShot` code path writes it. No voice-intent code path writes it.
- Voice transcription pipeline:
  - `app/api/parse-shot+api.ts:62, 78, 113, 126` writes `raw_utterance` but no speaker attribution.
  - `types/voiceIntent.ts:6-12` `VoiceIntent` has no speaker field.
  - `services/voiceService.ts` (per the captureUtterance / speak grep results) treats every utterance as device-local.
- **Voice transcription is currently 100% unattributed.** Every utterance is implicitly "the device owner." There is no Whisper diarization, no per-speaker enrollment, no voice-ID hookup.

**Recommendation:** This is the highest-cost future migration. When multi-player ships:
- Existing AsyncStorage `roundHistory[].shots[]` will all have `speaker_id === undefined`. Treatable as `'primary'` via the same back-fill above.
- But every persisted `recent_user_phrases`, `vocabularyProfile`, `playerVocabulary`, and `emotionalLog` entry assumes one speaker. The vocabulary store (`store/vocabularyProfileStore.ts`) and emotional log (`roundStore.ts:232`, schema-less) bind to "the user," not to a player_id. Those will be the painful migration when multi-player drops.

### 3. `playerProfileStore.ts` has NO `player_id`

**File:** `store/playerProfileStore.ts:27-119`

The 28-field `PlayerProfileState` interface includes name, firstName, handicap, email, subscription_status, selfieB64, etc. **It does not expose a `player_id` for shots to reference.**

This means today:
- Shots write `player_id: 'primary'` (hardcoded sentinel).
- Profile has no canonical id.
- The profile-to-shot linkage is implicit: the device's single profile IS player_id='primary'.

**Recommendation:** Add `player_id: string` to `PlayerProfileState`. Generate a UUID on `initTrial()` (currently `playerProfileStore.ts:186-189`). Persist it. Update `logShot` to read `player_id` from the profile instead of hardcoding `'primary'`. **This is a backwards-compatible add today — old persisted profiles can lazily get a UUID on next hydrate** via `onRehydrateStorage` (already used at lines 226-255 for Sentry breadcrumb). Doing this now is cheap; doing it post-multi-player launch is painful because the existing tester base would all share `player_id='primary'` and you'd need a heuristic to split them.

### 4. `RoundRecord` has no roster, no `player_id`

**File:** `store/roundStore.ts:137-172`

```text
137: export interface RoundRecord {
138:   id: string;
139:   roundNumber: number;
140:   courseName: string | null;
...
153:   shots: ShotResult[];
...
161:   health?: { ... };
172: }
```

The round itself is single-tenant. No `players: string[]`, no `host_player_id`, no `participants`. A round is implicitly "the device's round."

**State interface** (`RoundState`, lines 176-365) is the same: `currentHole`, `scores: Record<number, number>`, `putts: Record<number, number>` — all single-player shapes. To go multi-player without a schema migration, every score map would need to become `Record<playerId, Record<number, number>>`.

**Recommendation:** Add `players: string[]` to `RoundRecord` (default `['primary']`) and to `RoundState` startRound input. Even if UI only exposes 1 player, persisting `players: ['primary']` on every round from today forward means the eventual multi-player launch can detect old single-player rounds vs new multi-player rounds via array length, with no migration needed.

### 5. Voice transcription is fully unattributed (BLOCKING for multi-player)

**Files:** `types/voiceIntent.ts:6-12`, `types/parsedShot.ts:1-10`, `app/api/parse-shot+api.ts:62-137`, `services/voiceService.ts` (captureUtterance + speak).

- `VoiceIntent.raw_text` — no speaker.
- `ParsedShotRecord.raw_utterance` — no speaker.
- `app/api/parse-shot+api.ts` POST handler receives `{ utterance, ... }` and returns a parsed shot with `raw_utterance` only — no speaker field anywhere in the request or response.
- `app/(tabs)/play.tsx:205-208` uses `captureUtterance` for notes — single-speaker model.
- `app/(tabs)/caddie.tsx:1047, 2772` uses `captureUtterance` in Kevin conversation loop — single-speaker model.

**The system has no concept of who is speaking.** Every utterance is implicitly the device owner. There is no Whisper diarization config, no per-speaker enrollment, no voice-ID hookup.

**Recommendation:** Add `speaker_id?: string` to:
- `VoiceIntent` (`types/voiceIntent.ts:6-12`)
- `ParsedShotRecord` (`types/parsedShot.ts:1-10`)
- The `app/api/parse-shot+api.ts` request schema

Default to `'primary'` at every emission site. This is cheap structural plumbing today. Diarization itself can ship later — but having the field reserved means the eventual "Tim said this vs Tank said this" feature doesn't force every persisted vocabulary entry to be re-parsed.

### 6. Cage subsystem is the model citizen

**File:** `types/cage.ts:1-24`, `services/cageStorage.ts:46-200`

Cage already does this right:

```text
CageSession {
  id, player_id, started_at, ended_at, duration_seconds,
  master_video_path, clips: CageClip[],
  distance_to_target_meters, notes, player_roster: string[]
}
CageClip {
  id, session_id, ..., speaker_id, labels, raw_transcript
}
```

`services/cageStorage.ts:51, 59, 127, 182-186, 190, 198` writes `player_id: 'primary'`, `player_roster: ['primary']`, `speaker_id: 'primary'` consistently on every persisted record. This is exactly the pattern that should be replicated for the round/shot store.

### 7. Plan store is partially compliant

**File:** `types/plan.ts:11`

`HolePlan.player_id: string` (required, not optional). Default written at `store/roundStore.ts:681` is `'primary'`. Good. Multi-player launch can filter plans by `player_id` cleanly today.

`MatchedShot`, `HoleComparison`, `RoundRecap` (`types/plan.ts:29-61`) do not carry `player_id`. Comparisons are implicitly the device-owner's. Recommendation: add `player_id` to `MatchedShot` so post-round group analysis can separate per-player shot comparisons.

---

## AsyncStorage schema consistency check

- `round-store-v1` — version 1, has `migrate:` handling for v0 → v1 (outcome backfill at `roundStore.ts:1260-1278`). **No migration for player_id back-fill** — old persisted shots from before the `'primary'` default landed will load with `player_id: undefined`.
- `player-profile-v2` — no `version:` field declared (`playerProfileStore.ts:220-256`). The `v2` suffix is the store key, not a Zustand `version` migration handle. Adding `player_id` later without a `version:` declaration means you can't trigger a proper migration — you'd have to lazy-fill in `onRehydrateStorage`. **This is a structural risk.**
- `settings-store-v2` — version 7, has full `migrate:` chain (`store/settingsStore.ts:396-397`). Compliant.
- `cage-store` — version 1, `migrate:` is a no-op cast. Compliant for now.

**Inconsistency:** `player-profile-v2` lacks a Zustand `version:` field. Every other persisted store has one. This means future migrations for the profile (including adding `player_id`) must be done via `onRehydrateStorage` lazy-fill rather than `migrate:` step-up.

---

## Recommendation priority for the impending multi-player work

| Priority | Change | Cost today | Cost if deferred |
|---|---|---|---|
| **P0** | Add `player_id: string` to `PlayerProfileState`; generate on `initTrial` | ~10 lines + 1 onRehydrate fill | High — every tester ends up sharing `'primary'`; needs heuristic split |
| **P0** | Add `players: string[]` to `RoundRecord` + `RoundState.startRound` | ~5 lines | High — score maps shape must change; AsyncStorage migration required |
| **P0** | Add `speaker_id?: string` to `VoiceIntent`, `ParsedShotRecord`, `parse-shot+api` schema | ~15 lines | **BLOCKING for multi-player launch** — no path to retroactively attribute persisted utterances |
| **P1** | Write a `migrate:` v1 → v2 in `roundStore.ts` back-filling `player_id='primary'` on every historical shot | ~15 lines | Medium — old rounds otherwise drop from per-player queries |
| **P1** | Declare `version:` field on `playerProfileStore.ts` so future migrations have a step-up path | 2 lines | Medium — forces lazy-fill-only forever |
| **P2** | Add `player_id` to `MatchedShot` / `HoleComparison` | ~5 lines | Low — recap can be rewritten when multi-player ships |

---

## Bottom line for multi-player launch readiness

- **`player_id` on shots/plans/cage: Y** (reserved + defaulted to `'primary'`). Good.
- **`player_id` on profile: N.** Profile is a singleton. **BLOCKING-LIKE** — fixing later requires a heuristic split.
- **`speaker_id` on shots: Y declared, N populated.** Reserved field that nothing writes. Voice transcription is fully unattributed. **BLOCKING for any "who said this" multi-player feature.**
- **`speaker_id` on voice intents / parsed shots: N.** **BLOCKING for voice-driven multi-player.**
- **`roster` on round: N.** Round is single-tenant. Score maps are single-tenant. **BLOCKING — AsyncStorage migration required.**
- **`roster` on cage: Y.** Compliant.

**Net:** the cage subsystem nailed the standing decision. The round / shot / voice subsystems have the *fields* reserved on shots and plans but skipped the round-level roster, the profile `player_id`, and every voice-pipeline `speaker_id` write site. The cheapest fix window is now — once the PGA Hope beta testers persist data, every additional schema change becomes a forced migration.

**Audit owner:** Phase 420
**Date:** 2026-05-20
