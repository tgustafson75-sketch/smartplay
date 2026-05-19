# Field Guide Generation — Skill Spec

**Trigger phrases:** "generate field guide" · "prep for round" · "update field guide"

**Output:** Overwrite `FIELD_GUIDE.md` at repo root with a fresh, codebase-synced reference.

**Purpose:** A printable single-page-ish reference Tim reads BEFORE leaving for the course. It must reflect the live code, not aspirational behavior. Everything in the guide must be verifiable against current files / git state at generation time.

---

## Required sections (in this order)

### 1. Header
- Generation timestamp (today's date)
- Latest commit SHA + one-line subject (`git log -1 --oneline`)
- Latest EAS update group ID for `preview` channel + message (look at recent `eas update` output in repo or run `eas update:list --branch preview --limit 1`)
- "Last verified on real round: <date>" — if unknown, mark `UNKNOWN — confirm with Tim`

### 2. Pre-Flight Checklist (most important — Tim reads this in the car)
A numbered list, max 12 items. Each item is verifiable on-device in <30 seconds. Examples:
- Force-quit + relaunch app (ensures latest EAS bundle is live)
- Confirm GPS permission granted (Settings → Apps → SmartPlay)
- Confirm Health Connect permission if Health Sync is on
- Confirm course you'll play is in `data/courses.ts` LOCAL_COURSES — list the names currently bundled
- Battery ≥ 60% recommended
- Bluetooth on for earbud audio
- Phone in pocket-orientation that GPS can see sky (top of pocket up)

Pull the LOCAL_COURSES names dynamically by reading `data/courses.ts`.

### 3. Critical Paths Status
For each of the 4 paths defined in `docs/critical-paths.md`:
- Path name
- "Expected behavior" (one sentence)
- "Last known status" (working / regression / unverified — derived from recent commits if possible, else mark UNKNOWN)

### 4. GPS Pipeline (one-pager)
- Current adaptive-polling modes (stationary, walking, active) — read from `services/gpsManager.ts` to confirm names + intervals haven't drifted
- Recovery: what to do if GPS goes stale on course — point Tim to Battery & GPS Debug screen route (`/battery-debug`)
- Known speed gate: orchestrator suppresses auto-fire above 4 m/s (drives/golf carts)
- Synthetic round harness: how to invoke (Settings → Owner Tools → GPS Test Bench → "Play 18-Hole Synthetic Round")

### 5. Round Flow Walkthrough
End-to-end, terse:
- Tap Play → pick course → tap Start
- F/M/B yardages should appear immediately (bundled holes pre-GPS, then GPS-accurate once fix lands)
- Per-hole: log shots verbally or via Quick Log; Kevin auto-fires after sustained position
- Tap End Round → recap generates → archived under Settings → Owner Tools → Plan Debug

### 6. Voice / Kevin Triggers (current intents)
Read `services/conversationalLoggingOrchestrator.ts` or the latest intent registry to list voice triggers. Keep this short — top 8-10 the user will actually say. Always include: "open TightLie", "check my lie", "what's the play", and the round-control commands.

### 7. Debug Surfaces (owner-gated)
List every route under `app/*-debug.tsx` plus key non-debug owner tools (`gps-test`, `owner-logs`, `acoustic-test`, `landmark-curate`). For each: one-line purpose. Pull the list by globbing `app/` for `*-debug.tsx`.

### 8. Known Issues / Watch List
- 4 remaining Palms-image leak sites (track which still need fixing)
- Phantom round on APK reinstall (mitigated by boot guard in `_layout.tsx` — flag if regresses)
- discardRound asymmetry with walkingDetector ticker
- 12 stores missing version/migrate (low risk but flag during recap diffs)
- Any other items pending from prior audits — pull from recent commits / TODO comments via `grep -r "TODO\|FIXME" services/ app/ --include="*.ts*" | head -20`

### 9. Recovery Procedures (one-liners)
- GPS dead on course: open `/battery-debug` → "Force bumpToActive('debug_button')"
- Kevin silent: confirm audio_state in `/battery-debug` is not L1; tap any UI button to re-arm userInitiated
- Phantom round: kill app, reopen — boot guard discards stale rounds >8h
- Recap didn't generate: Plan Debug → "Generate Recap Now"
- Wrong course thumbnail: it's bundled in `data/courses.ts` — needs a build, not OTA

### 10. Footer
- Reminder: this guide reflects code at commit `<SHA>`. Anything that ships after this commit isn't covered.
- One-line: "Regenerate via /generate field guide before each round."

---

## Generation procedure (Claude follows this)

1. `git log -1 --format='%H %s'` for header
2. Read `data/courses.ts` LOCAL_COURSES names
3. Glob `app/*-debug.tsx` + key owner routes
4. Read `services/gpsManager.ts` for current mode names/intervals (don't hardcode)
5. Read `docs/critical-paths.md` if present, else fall back to CLAUDE.md's path summary
6. Optional: `eas update:list --branch preview --limit 1 --json` for latest update group (skip if it'd take >10s — note "not fetched")
7. Write/overwrite `FIELD_GUIDE.md` at repo root
8. Commit + push per standing rules ONLY if Tim says so or if "auto-push" is in the trigger phrase — otherwise leave staged for Tim to review

## Rules

- **Never hallucinate state.** If you can't verify something from the code/git, mark `UNKNOWN — verify on-device` instead of guessing.
- **Terse.** Target ~250 lines max. Bullets over paragraphs.
- **Codebase-synced.** Pull dynamic facts (course list, debug routes, modes) by reading files at generation time. Don't reuse stale numbers from previous field guides.
- **No marketing.** This is a field reference, not pitch copy.
- **Don't auto-commit** unless Tim explicitly says "push it" in the same turn.
