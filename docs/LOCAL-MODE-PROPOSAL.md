# Local Mode — proposal

Tim's frame: *"I would rather know and work in local mode than get frustrated or have my users get frustrated by quirky behavior."*

The circuit-breaker shipped (Fix FX) stops the radio-wake spam under weak signal. This proposal goes a step further: an **explicit user-controlled mode** that biases the whole app toward less network, less power, and predictable behavior — in exchange for some richness.

Not shipping until you approve the shape.

---

## What Local Mode does

A single toggle (default OFF) in Settings → "Local Mode." When ON:

### Speech
- `speak()` only fires when `userInitiated: true`. Every proactive utterance — opener, GPS-arrival, hole-detect chime, presence-fill, filler, follow-up listen-loop replies — is suppressed.
- Captions still display (no audio loss for the deaf-accessibility path).
- Mic tap + tap-to-talk still speak (those are explicitly user-initiated).
- L1 Quiet already does something similar but is binary (no caddie at all); Local Mode is more nuanced (caddie still responds when YOU ask).

### Brain routing (when a brain call IS warranted)
Tiered cascade, cheapest-first:
1. **Local intent classifier** — handle 5-10 deterministic queries on-device with zero network: yardage, "open <tool>", scorecard reads, "how many holes left," persona switch, "quiet mode on/off." Already partially exists in `services/intents/`; gate them ahead of the brain call when Local Mode is ON.
2. **Haiku-only brain** — if local can't resolve, force `tier='TACTICAL'` on `/api/kevin` so the server uses Haiku 4.5 (~2-3s, fraction of Sonnet's token cost). Skips the classifyQuestion model-tier escalation. Vision queries still allowed to escalate (Haiku's multimodal weaker), but the 60-80% of queries that are conversational still get Haiku-first.
3. **Sonnet escalation** — only when Haiku explicitly returns low confidence AND the query is one the user clearly wants a deep read on (planning, strategy, "what should I do here").
4. **OpenAI fallback** — only when Anthropic 5xx's, same as today.

### Background work (course-play scope only — Cage/SmartMotion unchanged)
- `swingCommentaryService` queues transcriptions to a local backlog; flushes only when network is healthy (circuit-breaker not tripped).
- `presenceCaddie` brain calls suppressed entirely (no proactive fillers).
- `swingAnalysisWarmup` skipped (no point waking Lambda when we're not analyzing).

### Active Listening
- Hot mic OFF in Local Mode. Reason: hot mic = constant brain access on every utterance candidate, which defeats the mode. User can still tap-to-talk on demand.
- The Active Listening toggle in Tools menu would show "Disabled by Local Mode" when ON; clearing Local Mode restores prior preference.

### GPS
- No change in Local Mode. GPS cadence stays as-is — the audit confirmed it's already well-tiered (1Hz active → 10s walking → 20s stationary).
- Future Battery #1 (poller consolidation) would help here regardless of mode.

### What stays full-power even in Local Mode
- Yardage F/M/B (already local-only after geometry cache lands)
- Shot tracking + scorecard
- Course-image viewing
- Mark Location / Mark Green
- Bundled hole previews
- SmartMotion / Cage Mode (you explicitly excluded these — short sessions, full power is fine)

---

## How the user sees it

One toggle in Settings, three lines explaining what it does:
> **Local Mode.** Conserves battery and works better on weak signal. Caddie only speaks when you ask. Tap-to-talk uses the fastest brain. Active Listening pauses.

When Local Mode is ON, a small unobtrusive indicator in the Caddie tab — a leaf icon next to the Tools pill, or a thin status line below the avatar — so you and the user know which mode you're in. NOT a warning, NOT frustration framing — just *"you are here."*

---

## Implementation shape (not code, just the contracts)

1. New setting: `settingsStore.localMode: boolean` (default false). Persisted.
2. New helper: `isLocalModeActive(): boolean` reads the flag (and could later combine with auto-triggers like "circuit-breaker has tripped 3x in 5min → suggest Local Mode").
3. `services/voiceService.ts.speak()`: when `isLocalModeActive() && !opts.userInitiated`, return silently. Same gate as the existing L1 trust check but for proactive vs reactive instead of all-or-nothing.
4. `hooks/useVoiceCaddie.ts.sendToBrain()`: when `isLocalModeActive()`, run local intent classifier FIRST; if no local match, send to `/api/kevin` with `forceTier: 'TACTICAL'` in the body.
5. `api/kevin.ts`: respect `body.forceTier === 'TACTICAL'` — skip the classifyQuestion call, pin tier to TACTICAL.
6. UI surface: Settings toggle + Caddie-tab indicator + Active Listening "disabled by Local Mode" affordance.

Total scope: ~150-250 lines across 5 files, no native modules, no new deps, no architectural changes. Reversible.

---

## What I want from you before shipping

Four decisions:

**1. Default state on first install** — Local Mode OFF (full features) or ON (battery-friendly, opt out for richness)?
  - Recommend OFF: matches current UX, conservative, lets you A/B with beta testers who flip it ON.

**2. Auto-suggest trigger** — should the app PROMPT the user to enable Local Mode after, say, 3 circuit-breaker trips in a 10-minute window?
  - Recommend YES with a one-time non-blocking prompt: *"Signal's spotty — switch to Local Mode? Caddie will be quieter but more reliable. [Yes / Not now / Don't ask again]"*

**3. Which local intents make the first cut** — the brain-bypass list. My initial pick:
  - Yardage queries ("yardage to green", "how far to the pin")
  - Open <tool> ("open SmartMotion", "open scorecard")
  - Persona switch ("switch to Serena", "Tank mode")
  - Quiet toggle ("quiet mode", "resume caddie")
  - Hole nav ("what hole am I on")
  
  Recommend starting with these 5; add more if usage logs show repeats.

**4. The indicator visual** — leaf icon next to Tools pill (subtle), thin status line below avatar (more readable), or both?

Once you've answered, I can ship in two phases:
- **Phase 1**: setting + speak() gate + UI indicator (~80 lines, no brain changes — just suppresses proactive speech). Ships with low risk.
- **Phase 2**: brain-routing tier + local intent classifier (~150 lines, touches `/api/kevin` server contract). Needs more careful rollout.

Your call on whether to bundle or phase.
