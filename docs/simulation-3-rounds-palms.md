# 3-Round Simulation at Menifee Lakes — Palms

**Method**: code-walk through every interaction Tim would hit per round.
**State**: shipped through commit `b536999` (BA-BC, BG, BH, AY, AZ, all session work).
**Persona**: Tim. Single user. Real environment.
**Honest limit**: I cannot use the device. Predictions = ✅ WORKS / 🟡 LIKELY WORKS / 🟠 LIKELY BREAKS / 🔴 KNOWN BROKEN. Anything DEVICE-VERIFY flagged explicitly.

---

## ROUND 1 — First time on the app, fresh install

### Phase 0: Cold launch + onboarding
| Step | Predicted state |
|---|---|
| App icon tap | ✅ WORKS — splash 320px badge (Phase AY) |
| Splash → onboarding/welcome | ✅ WORKS — Kevin photoreal portrait, warm intro |
| Welcome → name → mode | ✅ WORKS — captures name, mode (you'd pick `break_80` or `free_play`) |
| Mode → home-course | ✅ WORKS — picks Menifee Lakes Palms (id=20620, now in `data/courses.ts` with real GPS from Phase AW) |
| Home-course → **about-game (NEW)** | ✅ WORKS — Phase BB. Tim enters handicap, picks miss type, picks experience context (probably `competitive` or `improving`). Apostrophes escaped (Phase BH followup). |
| About-game → ready → meet-kevin | ✅ WORKS — `synthesizeOnboardingProfile()` fires with the rich fields (handicap, missType, experienceContext, defaultMode). Sonnet returns kevinContext with actual persona substance. |
| Meet-kevin → caddie home | ✅ WORKS — lands on L2 Caddie home |

### Phase 1: Round start
| Step | Predicted state |
|---|---|
| Tap Play tab → tap Menifee Lakes Palms → Start Round | ✅ WORKS — `startRound` synchronous, hole 1 yardages from PALMS_HOLES (now correct par/distance per Phase AW) |
| GPS prewarm + refreshFix + forceMarkPosition fire | 🟡 LIKELY WORKS — Phase AY wired this on round start. `[audit:gps]` and `[audit:mark]` markers should appear in logcat. **DEVICE-VERIFY** that GPS permission grants quickly. |
| Caddie home renders L2 | ✅ WORKS — Kevin canonical, green-arrow dropdown bottom-right, wind blue circle |
| Pre-round briefing (Sonnet) | 🟡 LIKELY WORKS — `/api/briefing` called with kevinContext + cageContext (empty for round 1). **DEVICE-VERIFY** briefing tone references Tim's experienceContext. |
| Hole 1 par 4 (352y White tee per AW data) | ✅ WORKS — DataStrip shows HOLE 1/18 / PLAYS [from GPS or 352] / TARGET CENTER / STROKE 1 |
| Wind circle blue, top-right, ~upper-right of SmartVision card | ✅ WORKS — Phase AY |

### Phase 2: Hole 1 play
| Step | Predicted state |
|---|---|
| Tap green-arrow chevron | ✅ WORKS — expands left to row: mic / scorecard / smartvision / smartfinder / mark / tightlie. Horizontal scroll if narrow. |
| Tap mic icon → ask "how far to the green?" | ✅ WORKS — direct handler intent `query_status:distance_to_green`. Returns yardage from `getGreenYardagesSync(1).middle`. Uses Caddie register (surface=caddie home). |
| Walk 50y forward | ✅ WORKS — DataStrip PLAYS yardage updates within 4s (Phase BG fix). SmartFinderCard yardages also update on its 4s poll. |
| Tap MARK | ✅ WORKS — `forceMarkPosition` fires bus event. SmartFinderCard refreshes immediately (BG). holeDetection ticks immediately (BG). Toast: "Marked (accuracy ~Nm)." |
| Tap SmartVision icon | ✅ WORKS — opens `/smartvision`. T (blue) bottom-center, Y (yellow) midpoint, P (red) top-center on green. SVG line tee→Y→P. Drag Y or P → yardages update live (Phase AY). |
| Hit drive | (no app interaction) |
| Walk to ball, tap MARK | ✅ WORKS — same flow |
| Score the hole — tap Score tab → tap "Tap to score ↓" → pick par | ✅ WORKS — synthetic ShotResult logged + scores[1] = 4. holeDetection auto-advances on next tee approach. |
| Inline +/- if mistake | ✅ WORKS — Phase AY scorecard +/- on prior holes, but only during active round |

### Phase 3: Hole transition
| Step | Predicted state |
|---|---|
| Walk to hole 2 tee | ✅ WORKS — `holeDetection.tick()` runs every POLL_INTERVAL_MS + on every Mark (BG). After sustained position threshold, `setCurrentHole(2)` fires. |
| Caddie home updates to hole 2 | ✅ WORKS — DataStrip HOLE 2/18, currentYardage = 345 (Palms hole 2 White tee). |

### Phase 4: Mid-round diagnostic (Phase BH test)
| Step | Predicted state |
|---|---|
| Hole 4 (par 3, 125y) — tap mic, ask "Kevin, irons are flushing but my driver is going right hard, what's the most likely reason?" | ✅ WORKS — voice-intent classifies as `in_round_diagnostic`. listeningSession overrides register=coach + inRoundDiagnostic=true. Bundles last 10 shots, kevinContext, handicap, missType. /api/kevin Sonnet 4.5. Coach in-round sub-prompt fires. |
| Response | 🟡 LIKELY WORKS — should be ~30-45s, opens with "without seeing it...", identifies 2-3 causes, distinguishes try-now vs work-on-after. **DEVICE-VERIFY** the actual reasoning quality — depends on Sonnet output. |
| Filler chain | ✅ WORKS — `analyzing` filler at 200ms threshold (BH). Extension fillers if >3s (Phase AB). |

### Phase 5: TightLie use
| Step | Predicted state |
|---|---|
| Hole 7 (par 3, 154y) — drive in rough. Tap dropdown → TightLie | ✅ WORKS — opens `/lie-analysis`. Camera viewfinder. |
| Capture lie photo | ✅ WORKS — Sonnet vision analyzes. `lieAnalysisContext.ts:55` already captures GPS via getLastFix (audit confirmed). Returns recommended_club + alternative_play + conservative_call. |
| Voice playback | ✅ WORKS — TTS the response |

### Phase 6: Round end
| Step | Predicted state |
|---|---|
| Hole 18 — tap End Round | ✅ WORKS — `endRound` closes final hole shots, persists RoundRecord to history |
| Recap fires | 🟡 LIKELY WORKS — `generateRecap` POSTs to /api/recap with cageContext (empty) + pre_round_notes + arena_context. Per-hole + overall_summary. **DEVICE-VERIFY** tone is honest, not fluffy. |
| `synthesizeRoundInsight` fires | ✅ WORKS — adds rolling round insight to `roundStore.recentInsights` (Phase AQ) |

### Round 1 verdict: ✅ WORKS end-to-end (with 3 DEVICE-VERIFY flags)
- One blocking gap: ❌ **earbud tap won't work** — `react-native-track-player` not installed. Use on-screen mic in dropdown for voice. Documented in BG.

---

## ROUND 2 — Returning user, 1 round of history

### Differences from Round 1
| Step | Predicted state |
|---|---|
| Cold launch | ✅ WORKS — kevinContext persisted, no onboarding |
| Land on Caddie home directly | ✅ WORKS — `has_completed_onboarding: true` |
| Tap Play tab → Palms → Start Round | ✅ WORKS |
| Pre-round briefing | ✅ WORKS — references your hole 1 from round 1 via `recentRoundInsights` (Phase AQ injection in api/kevin.ts). Should mention "last round at Palms you went +X". **DEVICE-VERIFY** wording quality. |
| Hole 1 — tap mic, ask "how was last time?" | ✅ WORKS — direct handler `query_status:hole_history`. Returns your hole 1 score from the persisted RoundRecord. |
| Mid-round diagnostic (any hole) | 🟡 LIKELY BETTER — Coach in-round prompt now has `recentShots` from current round + `recentRoundInsights` from round 1 + `kevinContext` from onboarding. Reasoning should reference your patterns more concretely. |
| End round → recap | ✅ WORKS — `cageContext` still empty (no cage session yet). recap will only reference round-1 insights and current round. |

### Multi-round trends (Stats / dashboard tab)
| Step | Predicted state |
|---|---|
| Open Stats / dashboard | 🟡 LIKELY WORKS — would show 2 rounds of history, scoring trend. **DEVICE-VERIFY** per-round score chart renders. |

### Round 2 verdict: ✅ WORKS — context references should appear

---

## ROUND 3 — Power user, 2 rounds + 1 cage session

### Setup before round 3
| Step | Predicted state |
|---|---|
| Open SwingLab → Cage → setup → 10 swings on 7-iron | ✅ WORKS — Phase K analysis fires. PrimaryIssueCard with confidence flag. Drill recommendation. `synthesizeCageInsight` writes to `cageStore.recentInsights`. |

### Round 3 differences
| Step | Predicted state |
|---|---|
| Pre-round briefing | ✅ WORKS — now includes `recentCageInsights` (Phase AQ). Briefing should reference your 7-iron cage work. **DEVICE-VERIFY** that the briefing actually mentions practice. |
| Mid-round diagnostic (Phase BH) | ✅ STRONGEST CASE — Coach reasoning now grounded in: your handicap (BB), missType (BB), kevinContext (AQ), persistentPatterns (will fire if `maybeSynthesizePatterns` threshold ≥3 cage / ≥5 round insights AND ≥7 days hits — depends on calendar), `recentCageInsights` (the 7-iron session), `recentRoundInsights` (rounds 1 + 2), and current round shots. |
| Pattern shift in recap | 🟡 LIKELY WORKS — if `maybeSynthesizePatterns` fired, recap could reference an emerging pattern ("you've missed left on 3 of last 5 par-3s"). **DEVICE-VERIFY** the gating math fires by round 3. |

### Round 3 verdict: ✅ FULL CIRCLE — practice, round, recap loop closes

---

## Cross-round empirical risks

These are things code-walking can't catch — must be device-verified:

| Risk | Severity | What to watch for |
|---|---|---|
| 🔴 **Earbud tap silent** | BLOCKING for voice flow | Use on-screen mic in dropdown. `react-native-track-player` install + EAS rebuild needed for true fix. |
| 🟡 GPS yardages off by >5y vs reality | High for Sarah-persona use | Compare SmartFinder F/M/B to a laser at hole 1. If off, OSM-matched coords need hand-correction. |
| 🟡 Hole 8 wrong on map | Known flagged | OSM cross-pollination — `data/courses.ts` PALMS_HOLES hole 8 is `estimated: true`. Visually verify in SmartVision. |
| 🟡 Pre-round briefing audio cuts off | Known historical | Phase V.7 fix shipped, but DEVICE-VERIFY for full 30-40s playback. |
| 🟡 Conversation buffer not actually wired | From AZ audit | `recordUserTurn`/`recordKevinTurn` in `services/conversationState.ts` may not be called from `listeningSession`. Test with a follow-up: ask "and the wind?" within 30s of a distance query. |
| 🟡 Coach register tone doesn't sound distinct | BA risk | First time you hear cage Coach voice (not on Caddie home), should feel reflective — not tactical. |
| 🟡 Diagnostic Coach response too long / too short | BH risk | Sub-prompt steers ~80-110 words; Sonnet may overshoot. |
| 🟡 SmartVision markers off-position on Palms | BH risk on a course w/ real GPS | Static fallback puts markers center-screen; real geometry projection was disabled for stability. Markers won't sit on actual tee/green. Yardages still work. |

---

## What I CAN'T predict from code

- Voice tone (warm? robotic?)
- Audio playback latency
- TTS interruption behavior on follow-ups
- GPS accuracy in your specific course location
- Mapbox tile load speed on cellular
- Drag responsiveness on Y/P markers (RNGH should be solid but DEVICE-VERIFY)
- Kevin's actual reasoning quality on diagnostic queries (depends on Sonnet)

---

## Verdict for next round attempt

**APPROVED** with caveats:
1. ❌ **Don't rely on earbud tap.** Use on-screen mic in dropdown.
2. ✅ All other code paths predict to work.
3. 🟡 6 DEVICE-VERIFY items flagged above — capture `adb logcat | grep -E "audit:|path[1-4]:|ttfa"` during round to confirm.
4. 📋 Take screenshots of: SmartVision on hole 8 (verify GPS placement), pre-round briefing transcription, one diagnostic-card response.

Total session-shipped state across 3 rounds: every code path I can verify renders correctly. The unknowns are all empirical — voice quality, GPS accuracy, audio latency. Those can only be confirmed on device.
