# SPRINT RESUME — read this first

If you are a fresh chat with no prior context: this is your starting point. Then read [SPRINT-LOG.md](SPRINT-LOG.md) for the daily detail and [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for the full prioritized plan.

---

## Where we are right now

- **Sprint:** Two-week consolidation sprint, started 2026-05-20. Target: app ready by June.
- **Current day:** Day 1 — 2026-05-20.
- **Current focus:** Audit-and-infrastructure day. Phase 420 audit and Phase 421 save-point system landed. No app code changes today beyond the morning's persona TTS + Tools FAB + Phase 418 validation gate.
- **Full prioritized plan:** [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md)
- **Daily running log:** [docs/SPRINT-LOG.md](SPRINT-LOG.md)
- **Audit evidence (12 docs):** `docs/audit-420-*.md`

---

## What's done and verified

**Code on `main`, server-side will deploy via Vercel automatically:**
- Phase 416 SmartMotion two-card system + cleanup
- Persona-aware Kevin TTS — `/api/kevin.ts` no longer hardcodes Kevin's voice for every persona
- Tools FAB layout — small right-side chevron expanding left
- Phase 418 SmartMotion validation gate — `services/swingValidity.ts` + server `valid_swing` field + UI gating
- Phase 420 audit (12 docs)
- Phase 421 sprint infrastructure (this set)
- **Day 1 / Fix 1 — End Round crash fixed** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)) — Zustand selector `roundPhotos` returned a fresh `[]` per render via inline `?? []` fallback. Stabilized via module-level `EMPTY_PHOTOS` constant.

**Verified clean by audits (do not touch — see Sprint Map "VERIFIED CLEAN"):**
- TypeScript strict, zero errors, zero suppressions
- `expo-doctor` 17/17 checks pass
- `BrandHeaderRow` + ••• Tools-pill pattern consistent across all 5 tabs
- Persona definition single-sourced in `lib/persona.ts`
- App entry hydration gate in `app/index.tsx`

**Not verified on device:** ALL of the above. The recurring problem across the audit is that every recent phase ("Phase 410 / 415 / 416 / 418 / persona TTS fix") is "git-diff verified" only. Empirical Z Fold verification is the sprint-end gate.

---

## What's actively in progress

Nothing — Day 1 closing. Day 2 should start with **empirical verification on Z Fold** of:
1. SmartMotion validation gate stops fabrication on floor footage
2. Each of Kevin/Serena/Tank/Harry speaks in their own voice
3. Tools FAB on caddie tab expands left correctly
4. End-Round flow does not crash with "Maximum update depth exceeded"

OTA push for the most recent bundle (`e872f9b`) failed 5× on Expo's asset processor. May need a retry, a fresh hash bump, or rely on the next APK build to ship the client-side changes.

---

## What's next (P0 queue from the Sprint Map)

In dependency order — see [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md) for evidence and file paths:

1. ~~**P0-1** — Fix `/arena/practice` 404.~~ **DONE Day 1 / Fix 2.** Card removed from SwingLab launcher; verified no remaining `/arena` references.
2. ~~**P0-2** — Verify `/swinglab/range` exists.~~ **CONFIRMED — file present at `app/swinglab/range.tsx`.** Earlier audit "likely missing" claim was wrong. Range Mode's Start Session was also rewired (Day 1 / Fix 2) to route only to the Swing Library (was going to `/cage/session`, one of the legacy capture surfaces).
3. **P0-3** — Collapse two SmartMotion UIs. `app/smartmotion-quick.tsx` (954 LOC, OLD) is still reachable from voice-intent (`services/intents/openToolHandler.ts:28-29`), Tools menu (`components/tools/GlobalToolsMenu.tsx:325`), and Library (`app/swinglab/library.tsx:256`). Repoint to canonical `app/swinglab/smartmotion.tsx` and delete. Effort: M.
4. ~~**P0-4** — Reproduce End-Round "Maximum update depth" crash on current bundle.~~ **DONE Day 1 / Fix 1.** Root cause: Zustand selector returning fresh `[]` per render. Fix on `main` in this session's commit. Empirical verification on Z Fold still required.
5. **P0-5** — Write `speaker_id: 'self'` default in 4 paths so multi-player migration doesn't need a data fixup later. Effort: M.
6. ~~**P0-7** — Gate debug routes for non-owners.~~ **DONE Day 1 / Fix 3.** Single central `usePathname()` watcher in `app/_layout.tsx` redirects non-owners away from 11 gated routes.
7. ~~**P1-3** — Collapse 3 GPS-fix caches to one.~~ **DONE Day 1 / Fix 4.** `gpsManager` is the single owner; smartFinderService and shotLocationService became thin readers. Sim, mark, and round-end write paths all flow through gpsManager. Stops the yardage-drift / 629,441y class of bugs at the source.
8. ~~**Day 1 / Fix 5** — Cockpit-mode SHOTS cell now ticks during the hole.~~ Was only watching `scores` (final hole map); harness shots never wrote that until completion. Now derives a running stroke count from `shots` mirroring the data-bar's STROKE calc.

Then P1 consolidation (5 swing-capture surfaces → 2; 5 haversines → 1; 3 GPS-fix caches → 1; etc.) and P2 polish.

---

## Hard constraints / standing decisions a new chat must know

- **Feature-complete.** Nothing new gets added this sprint. Only clean, consolidate, harden, verify.
- **SwingLab and Practice are ONE feature.** Never duplicate components, routes, or services across them. Per audit they appear clean today — keep it that way.
- **Empirical verification on Z Fold is the bar.** Code on `main` is not "done." Every P0 / P1 item closes only after on-device confirmation.
- **The Pro app lives at `~/Documents/smartplay`.** `~/smartplaycaddie` (this working dir for Claude Code) is a different/sandbox repo — do NOT edit it. All sprint work is in `/Users/timothyg/Documents/smartplay`.
- **Push to main on completion.** Standing rule from `~/.claude/projects/.../memory/standing-rules.md`. Never `--no-verify`, never `--force` to main.
- **Beta wearables SDK is unblocked** (Galaxy Watch / Health Connect / Meta glasses). Native module changes require an EAS Build, not just OTA.
- **No Grok.** Hard rule. Reference memory entry `no-grok.md`.
- **`speak()` / `playLocalFile()` triggered at launch or by user tap MUST pass `{ userInitiated: true }`** or they go silent at L1.
- **Trust slider order:** use `TRUST_LEVEL_SLIDER_ORDER` (= `[1,5,2,3,4]`), never modulo on numeric value.

---

## End-of-sprint verification gate

Sprint isn't done until ALL of these are confirmed on a real Z Fold (from the Sprint Map):

- [ ] Cold launch → welcome → caddie tab — no flashes, no double-redirects
- [ ] SwingLab tab: every card reaches a real screen (no 404)
- [ ] SmartMotion validation gate suppresses fabrication on floor footage; real swing produces honest read
- [ ] Tools FAB expands left to icons; no fake giant pill
- [ ] Each of the 4 personas speaks in their own voice
- [ ] Round start → 18 holes simulated → End Round → recap — no "Maximum update depth" crash
- [ ] Debug routes return 404 / redirect for non-owner accounts
- [ ] APK build size unchanged or smaller than pre-sprint baseline (5.2 MB Hermes)

---

**Last refreshed:** 2026-05-20 (Day 1 close). Update this doc at the end of every session.
