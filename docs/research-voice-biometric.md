# Research — Voice biometric for player ID (Phase BJ Component 7)

**Capability:** Identify which player (in a multi-player round) is currently speaking based on voiceprint / speaker recognition, so each player gets their own Kevin-or-Serena context, stats, handicap, and shot history.

**Verdict: QUEUE — depends on multi-player scope, which is itself queued for 1.1**

## Technical reason

This is a coupled-dependency problem. Voice biometric only matters if:
1. SmartPlay supports multi-player rounds (currently does not — `roundStore.ts` line 83 has `player_id?: string; // reserved for Phase 1.1 multi-player`, scaffolded but not wired).
2. Multiple players take voice queries during a single round (otherwise a "whose turn" tap-to-switch is enough).

Until 1.1 ships multi-player, voice biometric has nothing to do.

## Service options (for the eventual build)

If/when this lands, three implementation paths exist:

1. **Microsoft Azure Speaker Recognition** (most mature commercial)
   - Identification API + Verification API
   - Cloud-based (latency: typically 1-2s per ID call)
   - Privacy: voiceprint enrollment requires user consent + audio retention. Adds a sub-processor to the privacy policy.
   - Cost: tiered pricing per call.

2. **On-device alternatives** (privacy-preferred)
   - `react-native-voice` does speech-to-text only, not speaker ID.
   - Open-source models like ECAPA-TDNN exist in PyTorch / TensorFlow but require porting to TFLite / Core ML — non-trivial.
   - Apple's Speaker Identification API (if available on iOS) — not directly exposed to React Native; would need a Swift bridge.

3. **Tap-to-switch fallback** (no biometric)
   - Each player has a "switch to me" button on the Caddie home.
   - Voice query is attributed to the most-recent-tap player.
   - Zero ML cost, zero privacy implication. Often "good enough" for a 4-player group that's already taking turns by social convention.

## What would have to change for BUILD TODAY

1. Multi-player has to be in scope for v1.0. It isn't — `v1-scope-final.md` §F.1 keeps `player_id` as data-model-only scaffolding.
2. Even if multi-player landed, voice biometric is the *premium* implementation; the tap-to-switch fallback should ship first to validate the multi-player UX before adding biometric overhead.

## Recommendation

**QUEUE — bind to the multi-player phase.** When 1.1 multi-player is scoped, also scope the player-attribution UX:
- Tier 1: tap-to-switch (ship first, low risk)
- Tier 2: voice biometric (add later if user feedback says tap-switch is friction)

For now, the only voice-biometric-shaped work that should happen in v1.0 is keeping `player_id` in the data model (already done) so 1.1 doesn't need a schema migration.

## Privacy / compliance notes for the eventual build

When voice biometric ships, the privacy policy ([docs/privacy-policy.md](privacy-policy.md)) needs:
- A new row in the §4 sub-processor table (whichever speaker-ID provider is chosen)
- Updated §2 entry under "Audio (voice)" to mention voiceprint storage if enrollment audio is retained
- An opt-out path in Settings for users who don't want voice biometric and prefer tap-switch
