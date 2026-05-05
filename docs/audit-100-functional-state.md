# Phase 100 — Component 1: Functional State Audit

**Audit date:** 2026-05-05
**Bundle SHA:** `94e7d29` (BZ-v1)
**Verification venue:** Galaxy Z Fold dev-client. Status reflects empirical observation where verified, code inspection / inference where not.

## Status legend
- **WORKING** — empirically verified on Z Fold within the last 7 days
- **PARTIAL** — works in some conditions; documented limitation
- **BROKEN** — empirically failing
- **UNKNOWN** — coded but not run on real device since shipping
- **DEFERRED** — explicitly out of v1.1 scope

## Honest framing
Per CLAUDE.md verification gates, **most surfaces and functions touched in the last ~30 commits (BU through BZ-v1) are in UNKNOWN state.** The studio session that produced the BU audit was the last empirical Z Fold run. Since then: BS-followup cage refactor + BN-expanded persona widening + BU-followup hydration fixes + BX telemetry + BV reconciliation + BW per-clip Phase K reshape + BY-quick detection hardening + BZ-v1 review UI uplift have all shipped without device verification.

## Surfaces

| Surface | State | Evidence / notes |
|---|---|---|
| Onboarding (welcome → name → about-game → home-course → mode → meet-kevin → ready) | UNKNOWN | New onboarding flow exists. Settings hydration gate (app/index.tsx) shipped post-bundle; cold-launch should land correctly per persona. `meet-kevin.tsx` still hardcodes "MEET KEVIN" text + Kevin portrait — Phase BS-era observation. New users default to Kevin then can switch later. |
| Caddie home (L1/L2/L3/L4 trust levels) | UNKNOWN | Locked Kevin portrait per Phase AU. 4-persona avatar map (BN-expanded) untested across all trust levels post-bundle. Hydration race fix landed but not Z-Fold-verified. |
| Round flow (Free Play / Break_X) | UNKNOWN | No structural changes since BG (GPS subscriber gaps closed). Persona name swap touches voice but not round mechanics. Pre-round briefing now persona-aware. |
| Course discovery (search / detail) | UNKNOWN | Course content service persona-aware. golfcourseapi integration unchanged. |
| Course detail | UNKNOWN | About / Caddie Tips / hole notes generated via /api/course-content; persona-aware system prompt. |
| SwingLab tab | PARTIAL | Cage Mode card → inline overlay. SwingLab Cage Setup card → /cage → /cage/session (now overlay-wrapped per BV). Cage Mode reachable. Empirical: BV reconciliation untested. |
| Cage Mode | UNKNOWN (was BROKEN per BU) | Per Phase BU verdict: BROKEN at studio session. Post-bundle structural fixes shipped: BV (single canonical UI), BW (per-clip Phase K), BY-quick (FP hardening), BZ-v1 (review UI). Cage Mode is theoretically functional but empirical verification on Z Fold has NOT happened. |
| Tutorial library (BR) | UNKNOWN | Tutorial flow + Sonnet extraction shipped pre-bundle. Persona-aware. |
| Tutorial detail | UNKNOWN | "Kevin will reference this lesson" text now persona-aware. |
| Stats / Score / Recap | UNKNOWN | Recap generator persona-aware. RoundShareCard uses caddieName. |
| Arena | UNKNOWN | Arena scaffolding existed pre-bundle. Persona text not audited individually. |
| Settings | PARTIAL | 4-option Caddie pill row (Kevin/Serena/Harry/Tank) shipped. Tools menu cycler shipped. Trust-level screen persona-aware. About row reads `caddieName`. Untested on Z Fold post-bundle. |
| Tools menu | PARTIAL | Caddie persona cycler row added (caddie.tsx Tools sheet). Cycle order Kevin → Serena → Harry → Tank → Kevin. Untested on Z Fold post-bundle. |
| Modal flows (paywall, intro, greeting, briefing, recap, lie-analysis, smartvision, smartfinder) | UNKNOWN | Avatar widened to 4-way persona in greeting + paywall + briefing. Other modals not audited per-modal. |
| **Swing Library (incl. BZ-v1)** | UNKNOWN | Date + club filters new. Per-shot list with action sheet + comparison view shipped today. Untested on Z Fold. |

## Functions

### Voice flow
| Function | State | Notes |
|---|---|---|
| Voice register Caddie/Coach/Psychologist | UNKNOWN | BA-BC voice register differentiation shipped. Persona widening threads through every register. Empirical pending. |
| Voice routing (`speak()`) | UNKNOWN | Reads `caddiePersonality` from store, threads `persona` to `/api/voice` ElevenLabs voice ID map. All 4 voice IDs in code. Not Z-Fold-verified per persona. |
| Voice intent parser | UNKNOWN | Persona name threaded into prompt. |
| Earbud tap | UNKNOWN | Pre-existing path; no changes since BH. Tim's BV-PREP protocol covers verification (F1). |
| Wake word | DEFERRED | Not built. |
| Filler clips | UNKNOWN | Cache key changed from `gender_lang` to `persona_lang_v4` (BU-followup). Forces regen on first cold-launch with new persona. ~10–30s ElevenLabs roundtrip on first session, cached after. Untested on Z Fold. |

### GPS
| Function | State | Notes |
|---|---|---|
| Mark | WORKING per pre-bundle (BG / AY) | No changes since. Regression check needed. |
| Hole detection | WORKING per pre-bundle | No changes. |
| Yardages (live / pre-round toggle) | WORKING per pre-bundle | Phase AY toggle. No changes. |
| GPS subscriber gaps | CLOSED per Phase BG | Verified in BH 3-round simulation report. |

### SmartFinder
| Function | State | Notes |
|---|---|---|
| Standard / Target / Map / Putt modes | UNKNOWN | Pre-existing, no changes in recent bundle. Persona text "Kevin's read" → caddieName. |
| Tap-to-lock distance | UNKNOWN | Pre-existing. |

### SmartVision
| Function | State | Notes |
|---|---|---|
| Hole overlay | UNKNOWN | Pre-existing AW/AY work. |
| Drag pin | UNKNOWN | AY follow-up. |
| Vector hole rendering | UNKNOWN | Phase AN. |

### TightLie / Lie Analysis
| Function | State | Notes |
|---|---|---|
| Camera-based lie analysis | UNKNOWN | /api/lie-analysis persona-aware (server prompt now uses caddieName). Not Z-Fold-verified post-persona-widening. |

### Phase K cage analysis
| Function | State | Notes |
|---|---|---|
| Frame extraction | UNKNOWN | BW reshape: extractKeyFrames optionally takes clip boundaries. Untested on Z Fold. |
| Multi-swing per-shot analysis | UNKNOWN | BW per-shot Phase K loop. Untested. |
| Per-shot result persistence | UNKNOWN | `setShotAnalysis` writes per-CageShot. Untested. |
| U1 fallback | WORKING per BR commit | Tentative single-frame fallback. Untouched in recent bundle. |

### BR tutorial extraction
| Function | State | Notes |
|---|---|---|
| Manual notes MVP | UNKNOWN | Shipped in BR commit (`6dff9f3`). Not Z-Fold-verified. |
| Whisper transcript | DEFERRED | BR2. |

### BL club recognition
| Function | State | Notes |
|---|---|---|
| Sonnet vision read of club number | UNKNOWN | Scaffolding shipped in `6dff9f3`. Wired into manual picker grid; auto-camera-button NOT yet on overlay (the canonical UI post-BV). |
| Voice "switching to 6-iron" | UNKNOWN | Voice intent parser handles `club_change`. Not Z-Fold-verified. |
| Manual picker | UNKNOWN | Pre-existing. |

### BN persona switching
| Function | State | Notes |
|---|---|---|
| 4-persona type system | UNKNOWN | `lib/persona.ts`, `Persona` type, `getCaddieName`/`getCharacterSpec` helpers. Compile-clean. |
| Settings 4-option pill | UNKNOWN | Untested on device. |
| Tools menu cycler | UNKNOWN | Untested. |
| Hydration race fix | UNKNOWN | Critical bug fix (BU-followup). Not Z-Fold-verified. The original empirical bug ("Kevin says 'there you are' but I'm set on Serena") COULD be re-tested cleanly with this. |
| ElevenLabs persona-keyed voice routing | UNKNOWN | All 4 voice IDs in code. Not Z-Fold-verified per persona. |
| Tank/Harry per-emotion avatar maps | UNKNOWN | 30 + 24 PNGs shipped. Slot mapping in CaddieAvatar.tsx. Untested. |
| Harry portrait identity | **BLOCKED** | Best-guess assignment from a "tank-idle-69-001.png" filename. Tim has not visually confirmed. |

### Persistent context injection
| Function | State | Notes |
|---|---|---|
| Sonnet onboarding synthesis | UNKNOWN | Shipped Phase AQ. Persona-aware now. |
| Cage insight synthesis | UNKNOWN | Per-session. Untested post-bundle. |
| Round insight synthesis | UNKNOWN | Per-round. Untested post-bundle. |
| Pattern synthesis (weekly) | UNKNOWN | Periodic. Untested. |

### Recap generation
| Function | State | Notes |
|---|---|---|
| Per-hole + overall summary via Sonnet | UNKNOWN | Persona-aware system prompt. Untested post-bundle. |
| Hero reel | UNKNOWN | Pre-existing. |

### TTS
| Function | State | Notes |
|---|---|---|
| ElevenLabs primary | UNKNOWN | 4 persona voice IDs. Untested per persona. |
| OpenAI fallback | UNKNOWN | onyx/nova based on persona-derived gender. |
| Silent fallback (filler not regenerated) | UNKNOWN | `getFallbackTextForCategory` covers gap during first regen. |

### Streaming
| Status | Notes |
|---|---|
| DEFERRED | BP TTS sentence pipeline not built. Current path is full-utterance ElevenLabs call. |

### Conversation state
| State | Notes |
|---|---|
| UNKNOWN | Within-session conversation buffer (max 3 user-Kevin pairs, decays after 60s). Persona name threading: needs audit. |

## Integrations

| Integration | State | Notes |
|---|---|---|
| Anthropic Claude (Sonnet 4.6, Haiku 4.5) | WORKING | All API routes hit /api/swing-analysis, /api/kevin, /api/brain, /api/recap, /api/lie-analysis, /api/voice-intent, /api/cage-coach, /api/cage-review. Persona-aware system prompts in all routes. |
| OpenAI (gpt-4o-mini, gpt-4o-mini-tts) | WORKING | Brain.ts uses gpt-4o-mini. Voice fallback uses gpt-4o-mini-tts onyx/nova. |
| ElevenLabs TTS | UNKNOWN | 4 voice IDs in env. Tim added voice IDs in this session. Per-persona untested on Z Fold. |
| Whisper | DEFERRED | BR2. |
| Supabase | UNKNOWN | Per session, not audited individually. |
| golfcourseapi.com | WORKING | Course search + hole geometry via server-side proxy. |
| Stripe | DEFERRED | Coming-soon paywall (per Phase BM scoping). |
| expo-av | WORKING | Recording + playback. Used in cage + voice. |
| expo-camera (Vision Camera replacement) | WORKING | Cage recording. Photo capture in lie-analysis + space-scan. |
| react-native-track-player | NOT INSTALLED | Removed; mediaKeyBridge stub remains. Earbud tap via expo-av audio session foregrounding. |

## High-priority observations from this audit

1. **The recent ~5 commits (BV/BX/BW/BY-quick/BZ-v1) carry significant cage-pipeline + review-UI changes that have not been Z-Fold-verified.** Phase BU's verdict (Cage Mode = BROKEN) was set at the studio session; structural fixes shipped after; whether Cage Mode is now FUNCTIONAL is empirically unknown.

2. **The persona widening (BN-expanded + BU-followup hydration) likewise unverified.** The original "Kevin's voice when I'm set on Serena" bug was the trigger; the fix exists but hasn't been re-tested.

3. **Harry portrait is best-guess.** Until Tim visually confirms, half the persona-rendering surface for Harry is suspect.

4. **`/api/voice` requires ElevenLabs key** in `.env.local`. If the dev backend isn't passing the new persona voice IDs through, the OpenAI fallback fires (onyx/nova for gender) — making Tank, Harry, and Kevin all sound the same in practice. Worth a logcat check on first persona switch.

5. **No empirical evidence yet that BV-PREP verification protocol has been run.** `docs/verification-BV-PREP-results.md` is still a blank template.

6. **Console.log count high (250)** but most are telemetry markers (`[path3:cage]`, `[V6-DIAG]`, `[path4:voice]`, `[ttfa]`). A real audit needs to distinguish telemetry from dev-logging. Phase 100/cleanup should grep for non-tagged `console.log` calls and consider stripping.

7. **TODO count: 2** — actively maintained. Lint baseline 1 err + 6 warn (all pre-existing in unrelated files). Code health is good.

8. **`/cage/summary` orphaned post-BV** — overlay's onComplete bypasses it. Phase BV-followup D documented this for deletion; not yet executed.

## What this audit does NOT establish
- Whether anything actually works on Galaxy Z Fold today.
- Whether the current build can be installed cleanly on a fresh device.
- Whether Vercel deployment is in sync with local code (server-side `/api/*.ts` changes need deploy).

The verification gate is **Tim runs `docs/verification-BV-PREP.md` on Galaxy Z Fold and fills the results template.** Until that happens, every UNKNOWN above stays UNKNOWN.
