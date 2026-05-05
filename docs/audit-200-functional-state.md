# Phase 200 — Component 1: v1.1 Functional State

**Audit date:** 2026-05-05
**Bundle SHA:** `c170ec5` (Phase 110)
**Empirical bar:** Galaxy Z Fold dev-client.

## Status legend
- **WORKING** — empirically verified on Z Fold within 7 days OR high-confidence code-level (just shipped + tsc/lint clean)
- **PARTIAL** — works in some conditions, gaps documented
- **BROKEN** — empirically failing or known regression
- **UNKNOWN** — coded but not Z-Fold-verified since shipping
- **DEFERRED** — intentionally out of v1.1 scope

## Honest framing

A LOT of code shipped this session (Phases 105 / 106 / 107 / 108 / 109 / 110 / 111 / Common Faults collapse / DOMException hotfix / tee drag). Most surfaces are **UNKNOWN** — coded correctly per architectural review but not exercised end-to-end on Z Fold. Tim's BV-PREP-style empirical pass is the gate for almost everything below.

## Surfaces

| Surface | State | Notes |
|---|---|---|
| Onboarding (welcome → name → about-game → home-course → mode → meet-kevin → ready) | UNKNOWN | Phase 105 reframed Step 1 (caddie pick) as team intro; otherwise unchanged. Hydration gate (Phase BU-followup) covers profile + settings stores; 11 other persisted stores not gated (audit-100-personas.md flag). |
| Splash + intro | UNKNOWN | Phase 105 onboarding text update. Persona-aware. |
| Caddie home (L1/L2/L3/L4) | UNKNOWN | Phase 105 auto-syncs caddiePersonality to active pillar (Round → Kevin default). Subscribe-to-fix-change wiring (Phase 107 B1) gives sub-second yardage refresh. |
| Round flow (Free Play / Break_X) | UNKNOWN | Phase 107 GPS fixes (B1-B5) + Phase 108 SmartVision projection + Phase 109 log_shot voice intent all touch this path. |
| Course discovery / Course detail | UNKNOWN | No structural changes since BS. Persona-aware via Phase 105. |
| SwingLab tab | UNKNOWN ↗ | Phase 111 + followup: Common Faults section replaces silhouette Setup Guide; primary issue cards collapsible (Tim feedback). |
| Cage Mode | UNKNOWN | Phase 105 surface-pillar registration writes `cage` so caddie auto-flips to Tank. Phase 106 evaluateCageEnd fires drill-plateau detector. Pre-Phase-100 BU verdict was BROKEN; structural fixes shipped (BV/BX/BW/BY-quick/BZ-v1) — empirical UNKNOWN. |
| Tutorial library + detail (BR) | UNKNOWN | Phase 105 surface-pillar registration writes `drill_detail`. |
| Stats / Score / Recap | UNKNOWN | Phase 109 log_shot voice intent feeds stats. Recap consumes shots[]. |
| Arena | UNKNOWN | Phase 105 surface-pillar registration writes `arena` (→ Play pillar). |
| Settings | UNKNOWN ↗ | Phase 105 added Caddie Team section (4 PillRows + reset). Phase 106 added Team suggestions toggle. Phase 107 added GPS quality debug overlay toggle. |
| Tools menu | UNKNOWN | Phase BN persona cycler unchanged. |
| Modal flows | UNKNOWN | CaddieSuggestionCard (Phase 106) mounted at root. |

## Functions

### Voice flow
| Function | State | Notes |
|---|---|---|
| Voice register (Caddie/Coach/Psychologist) | UNKNOWN | Phases 102-105 character refresh threads through every register. |
| Voice routing (`speak()`) | UNKNOWN | Reads `caddiePersonality` from store; Phase 105 auto-syncs it to active pillar. |
| Voice intent parser | UNKNOWN ↗ | Phase 109 added `log_shot` intent. Phase 110 added `media_capture` + `media_playback` intents. 18 intents total. |
| Earbud tap | UNKNOWN | No changes since BH. |
| Filler clips | UNKNOWN ↗ | Phase 100 / W3: parallelize filler TTS fetch with concurrency cap (was 30-60s serial → ~5-10s parallel). Phase 100 / S2+S3+S5: persistence safety pass. |
| Voice handoff lines (Phase 105 / 106) | UNKNOWN | Active caddie speaks one short in-character line on pillar transition; Phase 106 handoff orchestration speaks "handing off to X" on accepted suggestion. |

### GPS
| Function | State | Notes |
|---|---|---|
| Mark | UNKNOWN | Phase 107 / B3: Mark resets the smoothing buffer (raw position, not averaged). |
| Hole detection | WORKING per BG | Closed gaps verified pre-bundle. Not touched in this session. |
| Yardages (live / pre-round toggle) | UNKNOWN ↗ | Phase 107 / B1: smartFinderService now subscribes to live gpsManager fixes. Sub-second refresh during walking instead of 4s poll. |
| GPS outlier rejection (Phase 107 / B2) | UNKNOWN | Discards fixes accuracy>15m or jump>50m within 5s. |
| GPS smoothing (Phase 107 / B3) | UNKNOWN | 3-fix rolling average. |
| Walking accuracy (Phase 107 / B5) | UNKNOWN | Bumped Balanced → High. |
| GPS quality debug overlay | UNKNOWN | Settings toggle; renders top-left during round-active when enabled. |

### SmartFinder
| Function | State | Notes |
|---|---|---|
| Standard / Target / Map / Putt | UNKNOWN | Auto-update via fix-change subscription new in Phase 107. |
| Tap-to-lock distance | UNKNOWN | Pre-existing. |

### SmartVision
| Function | State | Notes |
|---|---|---|
| Hole overlay | UNKNOWN ↗ | Phase 108: tee/pin markers now projection-based (was static 85%/15%). Should match actual rendered tee position in Mapbox tile. |
| Tee drag override (Phase 108-followup) | UNKNOWN | Drag T marker when no round active to compensate for golfcourseapi position errors. |
| Pin / yellow drag | UNKNOWN | Pre-existing. |

### TightLie / Lie Analysis
| Function | State | Notes |
|---|---|---|
| Camera-based lie analysis | UNKNOWN | Audit 101 / W10: tuned max_tokens 800→400, temperature 0.5→0.3 for faster + more deterministic output. Persona-aware via Phase 100 / B4 server sweep. |

### Phase K cage analysis
| Function | State | Notes |
|---|---|---|
| Frame extraction | UNKNOWN | BW reshape + Audit 101 fixes shipped. |
| Multi-swing per-shot analysis | UNKNOWN | Per-shot Phase K loop. Not exercised on Z Fold post-bundle. |
| Per-shot result persistence | UNKNOWN | `setShotAnalysis` in cageStore. |
| U1 fallback | WORKING per BR | Tentative single-frame fallback. |

### BR tutorial extraction
| Function | State | Notes |
|---|---|---|
| Manual notes MVP | UNKNOWN | Pre-bundle. Not changed. |
| Whisper transcript | DEFERRED | BR2. |

### BL club recognition
| Function | State | Notes |
|---|---|---|
| Sonnet vision read | UNKNOWN | Pre-bundle. |
| Voice club switching | UNKNOWN | clubChangeHandler exists. |
| Manual picker | UNKNOWN | Pre-existing. |

### BN persona switching → team architecture (Phase 105)
| Function | State | Notes |
|---|---|---|
| 4-persona type system | WORKING | lib/persona.ts, types stable. |
| Per-pillar caddieAssignments | UNKNOWN | Settings → Caddie Team UX shipped Phase 105. |
| Pillar surface registration | UNKNOWN | caddie.tsx, CageSessionOverlay, cage-drill, tutorial/[id] all register their surface. |
| Auto-sync caddiePersonality on pillar transition | UNKNOWN | app/_layout.tsx subscribes to surface changes; existing voice/brain/avatar consumers route through automatically. |
| Voice handoff line on transition | UNKNOWN | "Tank here. Let's work." etc. |
| Migration from prior single caddiePersonality | UNKNOWN | persist v2 → v3 seeds all 4 pillars to prior value. |
| Hydration race fix (Phase BU-followup) | UNKNOWN | Pre-Phase-100. |
| Harry portrait identity | **BLOCKED** | Best-guess assignment from filename; Tim hasn't visually confirmed. (Carried from audit-100.) |

### Team intelligence (Phase 106)
| Function | State | Notes |
|---|---|---|
| Inter-caddie awareness in 4 character specs | WORKING | Spec text shipped; consumed by getCharacterSpec via persona-aware api/* routes. |
| Trigger detection (drill_plateau, cage_frustration, mental_struggle, tactical_to_mental, user_explicit_stuck) | UNKNOWN | services/teamIntelligence.ts. evaluateCageEnd + evaluateRoundProgress wired. |
| Suggestion store (offer / accept / decline / cooldowns) | UNKNOWN | store/teamIntelligenceStore.ts; persisted cooldowns. |
| CaddieSuggestionCard UI | UNKNOWN | Mounted at app root; gated by suppression setting. |
| Handoff orchestration (temp pillar swap + return) | UNKNOWN | _layout.tsx subscribes to accepted handoffs. |
| Settings suppression (on / soft / off) | UNKNOWN | New PillRow in Settings. |

### Persistent context injection (Phase AQ)
| Function | State | Notes |
|---|---|---|
| Sonnet onboarding synthesis | UNKNOWN | Persona-aware. |
| Cage insight synthesis | UNKNOWN | Per-session. |
| Round insight synthesis | UNKNOWN | Per-round. |
| Pattern synthesis | UNKNOWN | Periodic. |

### Recap generation
| Function | State | Notes |
|---|---|---|
| Per-hole + overall via Sonnet | UNKNOWN | Audit 101 / W4: Anthropic prompt caching enabled. |
| Hero reel | UNKNOWN | Pre-existing. |

### TTS
| Function | State | Notes |
|---|---|---|
| ElevenLabs primary | UNKNOWN | 4 persona voice IDs. |
| OpenAI fallback | UNKNOWN | Audit 101 / S7: SDK timeout + maxRetries set on constructor. |
| Audio-write race (Audit 101 / S4) | UNKNOWN | `audioFile.write` now awaited before `Audio.Sound.createAsync`. Plausible fix for `[voice] speak timeout`. |

### Streaming
| Status | Notes |
|---|---|
| DEFERRED | BP TTS sentence pipeline not built. |

### Conversation state
| State | Notes |
|---|---|
| UNKNOWN | Within-session conversation buffer (max 3 user-Kevin pairs, decays after 60s). |

### Mark function + propagation (Phase AL / AY / 107)
| State | Notes |
|---|---|
| UNKNOWN ↗ | Phase 107 / B1: subscribeFixChange notifies all consumers on every fix update (live + Mark + manual refresh). caddie.tsx markTick bumps on push. |

### Hole detection + transitions
| State | Notes |
|---|---|
| WORKING per BG | Pre-bundle. Not changed. |

### Shot tracking (Phase 109)
| Function | State | Notes |
|---|---|---|
| Conversational logging cadence | UNKNOWN | Pre-existing orchestrator. |
| log_shot voice intent | UNKNOWN | Phase 109 ship. "I hit driver 240 left" → roundStore.logShot. |
| Tap input via rules-resolution sheet | UNKNOWN | Pre-existing. |
| Scorecard placeholder | WORKING per pre-bundle | Pre-existing. |
| Auto-detection (GPS pattern) | UNKNOWN | shotDetectionService. |
| Stats aggregation | UNKNOWN | patternEngine, recap. |

### Voice media commands (Phase 110)
| Function | State | Notes |
|---|---|---|
| media_capture intent (shot / swing / highlight) | UNKNOWN | Voice resolves; orchestration calls requestCapture. |
| media_playback intent (open / last) | UNKNOWN | Routes to /swinglab/swing/[id] or /swinglab/library. |
| Camera lifecycle (pre-arm / ring buffer) | DEFERRED | Phase 110 spec; deferred to follow-up. Current behaviour is on-demand spin-up via existing CageSessionOverlay path. |
| Audio in recordings | DEFERRED per spec | Default off. |

## Integrations

| Integration | State | Notes |
|---|---|---|
| Anthropic Claude (Sonnet 4.6 + Haiku 4.5) | WORKING | All API routes persona-aware via Phase 100 / B4 server sweep. Prompt caching on hot endpoints (Audit 101 / W4). |
| OpenAI (gpt-4o-mini + gpt-4o-mini-tts) | WORKING | SDK timeout / maxRetries set (Audit 101 / S7). |
| ElevenLabs TTS | UNKNOWN | 4 persona voice IDs. Per-persona untested on Z Fold. |
| Whisper | DEFERRED | BR2. |
| Supabase | UNKNOWN | Not audited individually. |
| golfcourseapi.com | WORKING | Course search + hole geometry; Phase 108 fix uses tee/green coords for SmartVision projection. |
| Stripe | DEFERRED | Per Phase BM. |
| expo-av | WORKING per Phase 100 polyfill | DOMException polyfill fix shipped this session. |
| expo-camera | WORKING | Cage recording + lie-analysis. |
| react-native-track-player | NOT INSTALLED | mediaKeyBridge stub remains. |

## What this audit does NOT establish

- Whether anything actually works on Galaxy Z Fold today.
- Whether any of the 8 phases shipped this session work end-to-end.
- Whether the Garmin yardage comparison matches expectations.
- Whether the SmartVision tee dot lands on the actual tee box post-Phase 108.
- Whether voice capture commands fire correctly on Z Fold's expo-camera.

The verification gate is **Tim runs an end-to-end empirical session on Galaxy Z Fold**. Until that happens, every UNKNOWN above stays UNKNOWN.
