# Phase BV-PREP — Empirical Verification Results

**Tested by:** Tim
**Date tested:** _to fill_
**Galaxy Z Fold posture(s) tested:** _Fold-closed / Fold-open / both_
**Bundle SHA on device:** _commit hash from Metro / dev-client_
**Metro reload command used:** _`npx expo start --tunnel --clear` or other_

Run protocol per [docs/verification-BV-PREP.md](verification-BV-PREP.md). Mark each test PASS / FAIL / PARTIAL with specifics in the third column.

---

## TEST GROUP A — Persona switching

| Test | Status | Specifics |
|---|---|---|
| A1 — Serena cold launch (avatar + voice + name) |  |  |
| A2 — Tank cold launch (avatar + voice + name) |  |  |
| A3 — Harry cold launch (avatar + voice + name) |  |  |
| A4 — Kevin cold launch (regression check) |  |  |
| A5 — Tools menu cycler (4-step cycle) |  |  |

## TEST GROUP B — Hydration race

| Test | Status | Specifics |
|---|---|---|
| B1 — Serena cold launch, no Kevin flash |  |  |
| B2 — Tank cold launch, no Kevin flash |  |  |
| B3 — Harry cold launch, no Kevin flash |  |  |

## TEST GROUP C — Tank/Harry emotion rendering

| Test | Status | Specifics |
|---|---|---|
| C1 — Tank emotion crossfades through voice states |  |  |
| C2 — Harry emotion crossfades through voice states |  |  |
| C3 — Serena emotion v0 placeholder (asymmetry note) |  |  |

## TEST GROUP D — Portrait visual confirmation

| Test | Status | Specifics |
|---|---|---|
| D1 — Tank portrait matches character |  |  |
| D2 — Harry portrait matches character |  |  |
| D3 — Kevin portrait unchanged (Phase AU lock) |  |  |
| D4 — Serena portrait unchanged |  |  |

## TEST GROUP E — Cage Mode

| Test | Status | Specifics |
|---|---|---|
| E1 — Cage overlay UI controls all visible |  |  |
| E2 — Cage session reaches library entry |  |  |
| E3 — Older app/cage/session.tsx reachability |  |  |
| E4 — Detection false positive rate (count out of 4 noises) |  |  |

## TEST GROUP F — Foundation spot-checks

| Test | Status | Specifics |
|---|---|---|
| F1 — Earbud tap engagement |  |  |
| F2 — Voice query flow (persona-correct response) |  |  |
| F3 — SmartFinder / Mark / GPS regression check |  |  |

---

## Aggregate result

**All tests passed?** _Y / N_

**If N, count:**
- BLOCKING failures (regression in committed code, must hot-fix now): _N_
- KNOWN-ISSUE deferrals (Cage Mode no_data per BU, Serena emotion v0, etc.): _N_
- INTERMITTENT (unclear if fix needed): _N_

**Decision per persona:**

| Persona | Ship-ready? | Notes |
|---|---|---|
| Kevin |  |  |
| Serena |  |  |
| Harry |  |  |
| Tank |  |  |

**Decision per area:**

| Area | State after BV-PREP | Next action |
|---|---|---|
| Persona switching architecture |  |  |
| Hydration race resolution |  |  |
| Tank/Harry emotion rendering |  |  |
| Cage Mode (BU verdict was BROKEN) |  |  |
| Foundation (earbud, Mark, voice flow) |  |  |

---

## Decision: gate result

- [ ] BV-PREP **PASSED** — Phase BU sequence unblocked. Next phase: BX (telemetry markers).
- [ ] BV-PREP **FAILED** — hot-fix block is needed before BU sequence proceeds. Specific fixes listed below.
- [ ] BV-PREP **PARTIAL** — some surfaces clear to ship, others need targeted fix. Per-area decisions captured above.

### Hot-fix blocks discovered (if any)

_For each FAIL marked above, write a 1-sentence fix description and which file is suspected._

---

## Logcat snippets

Paste relevant logcat output here. Useful greps:

```
adb logcat | grep -E "\[path1:onboard\]|\[path3:cage\]|\[path4:voice\]|\[V6-DIAG\]|\[ttfa\]|persona|caddie"
```

```
<paste here>
```

---

## Honest framing

Empirical observation, not optimism. PASS means every check fired, not "looks fine." If a test failed silently or behavior was ambiguous, mark PARTIAL and explain rather than rounding up to PASS.
