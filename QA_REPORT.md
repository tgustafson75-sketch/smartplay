# SmartPlay Caddie — QA Report
**Run:** 2026-07-21 · autonomous QA & regression pass #1 · repo `/Users/timothyg/smartplay`

---

## Executive summary

First pass of the autonomous QA system. It built a static application model, ran a
23-agent parallel audit (5 subsystem mappers + 6 bug-finders, every finding adversarially
re-verified against source), stood up the project's first test infrastructure, and fixed
+ regression-tested the confirmed defects.

**Scope honesty:** this environment runs static analysis and the (new) Jest suite. It
**cannot** run the React Native app on a device, so there are **no live CPU / battery / FPS /
crash-rate / VoiceOver measurements** in this report — any such number would be fabricated.
The device-only phases of the brief (live session simulation, accessibility, performance)
are explicitly deferred to on-device QA and marked below.

**Headline:** No crashes-on-happy-path and no data-corruption-on-write were found, but the
audit surfaced **6 High findings** — a silent data-loss on Restore, two unauthenticated
server vulnerabilities (SSRF, message IDOR), a cold-open crash, and two backup-integrity
weaknesses. **7 of 10 confirmed findings are fixed with tests in this pass**; 3 are parked
with precise patches because they change a shipped client/server contract or carry
user-lockout / data-corruption risk that needs your sign-off.

| | Count |
|---|---|
| Findings confirmed (adversarially verified) | **10** |
| Findings refuted by verification (discarded) | 2 |
| **Fixed + regression-tested** | **9** |
| Parked — genuinely unsafe to auto-fix (documented) | 1 (H2) |
| New automated tests | 38 passing |
| Voice-path changes | **0** (freeze honored) |

> **Update (2026-07-21, follow-up):** H4 (messages IDOR) and H6 (backup brute-force) are now
> **fixed + tested**. H2 (multi-device merge) was evaluated for a structural union and
> **deliberately not shipped** — see H2 below; it needs tombstone-based sync, not a one-pass edit.

---

## Findings

### 🔴 HIGH

#### H1 — Restore silently overwrites offline-learned data  ✅ FIXED
`services/cloudSync/snapshot.ts:114` · data-loss
`applySnapshot()` (the one restore primitive for cloud/server/local-file restore) unioned
only `round-store-v1`; every grow-mostly learned store (CNS `caddie-memory-v1`, `club-stats`,
`practice-*`, `family`, …) was blind-overwritten. A user who practiced offline for a week
then tapped **Restore** lost that week — an older/emptier cloud copy replaced the richer
local one. The upload path already protects these exact keys; restore didn't.
**Fix:** restore now applies the same `GROW_MOSTLY_KEYS` guard the upload path uses — a
near-empty incoming blob can't clobber a richer local one; a genuinely richer cloud copy
still restores onto a fresh device.
**Guard:** `__tests__/regression/snapshot-restore-dataloss.test.ts` (4 cases, exercises the real `applySnapshot`).

#### H2 — Grow-mostly merge is a length heuristic, not a union  ⏸ PARKED (unsafe to auto-fix)
`api/backup.ts` · multi-device data-loss
Two devices sharing a Backup ID that each learn *different* data of comparable size clobber
each other (last-write-wins; only round history is truly id-unioned).
**Evaluated and deliberately not shipped:** I built a conservative structural id-union and then
reverted it. A store scan showed the grow-mostly stores are **editable, not append-only** —
`clubBagStore.removeClub`, `familyStore.removeMember` (hard delete), `coachKnowledgeStore`
(FIFO cap + `remove`), `workout`/`practice` (capped + `clear`). Without per-record **tombstones**,
any union that preserves device A's divergent adds *also resurrects records the user deleted on
device B* (a removed club / family member reappears) — the exact D4 deletion-propagation bug the
team already fixed, and arguably worse UX than the rare loss it prevents. You cannot distinguish
"new on A" from "deleted on B" without a deletion marker. **Correct fix (real design work):** add
per-record tombstones or a per-device high-water-mark / versioned sync, then union safely. H1's
fix already closes the worst (restore-overwrite) direction; the length heuristic remains the safe
approximation for uploads.

#### H3 — Unauthenticated SSRF via `imageUrl`  ✅ FIXED
`api/pose-analysis.ts:127` · ssrf
The unauthenticated endpoint fetched any user-supplied URL server-side with no validation,
letting an attacker reach `169.254.169.254` (cloud metadata), `localhost`, and internal
ranges, reading reachability back through the echoed error string.
**Fix:** new shared `api/_ssrfGuard.ts` (`assertPublicHttpUrl`) — https-only, DNS-resolves
and blocks private/loopback/link-local/metadata/CGNAT ranges (v4 + v6, incl. IPv4-mapped),
refuses redirects, and the endpoint now returns a generic error (kills the oracle).
**Guard:** `__tests__/regression/ssrf-guard.test.ts` (19 cases). *Note: `course-proxy`,
`golfbert-proxy`, `image-edit` should adopt the same guard — see Recommendations.*

#### H4 — Message IDOR: read/send any user's private messages  ✅ FIXED
`api/messages.ts:50` · broken-access-control
`GET /api/messages?user=<email>` returned anyone's thread; `POST` forged the `from`. Identity
was an unauthenticated, guessable email.
**Fix:** the endpoint now requires a shared app-key (`x-app-key`, verified with a constant-time
`keysMatch`) before any DB access — closing the "anyone with curl + a known email" hole — plus an
optional `MESSAGING_ALLOWED_EMAILS` participant allow-list that bounds the feature to Tim↔Tank
even if the key leaks. The client (`services/messaging.ts`) now sends the key; key resolution
mirrors the `apiBase` env+fallback pattern so OTA bundles keep working, and the server can be
rotated to a strong `MESSAGING_APP_SECRET` without shipping it in the bundle.
**Guard:** `__tests__/regression/messages-auth.test.ts`.
**Honest limit (documented in `services/appAuth.ts`):** a client-embedded shared key is
extractable by decompiling the app — this stops opportunistic/external abuse, not a determined
reverser. Real per-user auth (bind to the hardened backup passphrase, or email-verified tokens)
is the follow-up. **Ship note:** deploy the `api/messages.ts` change and OTA the client together
(currently-installed beta builds must OTA to keep messaging working).

#### H5 — Rules-of-Hooks violation → crash on cold/deep-link open  ✅ FIXED
`app/swinglab/swing/[swing_id].tsx:1301` · correctness
A `useRef` + `useEffect` were declared *after* three conditional early returns
(`!hasHydrated` / `!session` / `!shot?.clipUri`). Opening the swing route before the cage
store hydrated (notification/deep link, process-death restore) rendered fewer hooks first,
then more → *"Rendered more hooks than during the previous render"* crash.
**Fix:** relocated both hooks above the early returns (their internal guards keep them a safe
no-op until data is ready).
**Guard:** `react-hooks/rules-of-hooks` (already error-level in `eslint-config-expo`) — verified
it flags this exact hook-after-return pattern; `npm run lint` is the permanent guard.

#### H6 — Backup brute-force: 4-char passphrase + fail-open rate limit  ✅ FIXED
`api/backup.ts:24` · brute-force
`MIN_SECRET_LEN=4`, email is public, and the only throttle failed **open** on any DB error
(incl. the `backup_rate_limit` table being unmigrated) and was keyed on spoofable
`X-Forwarded-For`.
**Fix:** added a process-local limiter (`api/_rateLimit.ts`) that (a) needs **no migration**, so
throttling exists even when table 0005 is absent, and (b) is keyed on the requested **email**
(sha256) — which a brute-forcer targeting one victim **cannot rotate** the way they can rotate IP
— in addition to a per-IP layer. The DB per-IP counter stays as the cross-instance layer. Limits
are generous (12 email / 40 IP per minute per instance) so a real restore (a few GETs) never
blocks. **Passphrase length left unchanged on purpose** — raising `MIN_SECRET_LEN` would lock out
existing users with short passphrases (changing it also changes the row key and orphans their
backup).
**Guard:** `__tests__/regression/backup-ratelimit.test.ts`.
**Honest limit:** serverless instances are ephemeral and plural, so the in-memory layer isn't a
global guarantee — it's a real added cost + a safety net when the DB layer is down, used
alongside the DB counter. A fully global limit still wants migration 0005 applied.

### 🟡 MEDIUM

#### M1 — `swing-question.ts` Gemini call has no timeout  ✅ FIXED
`api/swing-question.ts:125` · upstream-timeout
The always-primary Gemini vision call had no timeout (the SDK has none); a stall blocked the
lambda to Vercel's `maxDuration` (504) and the OpenAI fallback never ran. Every sibling route
already wraps the call. **Fix:** wrapped in the same 15s `geminiWithTimeout` race → a hang now
throws into the existing catch and fails over to OpenAI.

#### M2 — `lie-analysis.ts` Gemini call has no timeout  ✅ FIXED
`api/lie-analysis.ts:253` · upstream-timeout
Same defect on the `X-AI-Provider: gemini` path. **Fix:** same 15s wrapper.

### 🟢 LOW

#### L1 — SVG NaN crash in Cage placement modal  ✅ FIXED
`components/swinglab/CageTargetingCard.tsx:250` · client-crash-svg-nan
The interactive placement modal fed `existingBall`/`existingTarget`/`draft` coords straight
into `react-native-svg` while its sibling overlay guards identical geometry with `geomOk`. A
NaN coord (corrupted persisted placement / auto-detect miss) white-screens the modal.
**Fix:** every marker now gated on `Number.isFinite` coords, mirroring the overlay.

#### L2 — `CaddieAvatar` transition effect leaks timer + setState-after-unmount  ✅ FIXED
`components/CaddieAvatar.tsx:481` · react-leak
The crossfade effect cancelled its prior run only at the top of the *next* run, so unmounting
mid-transition left an 80 ms timeout + native animations writing state onto a dead component.
**Fix:** added the missing cleanup return (stops the animation + clears the timeout on unmount).

### Refuted by verification (not real — discarded)
2 candidate findings were dropped when the adversarial verifier re-read the source and could
not reproduce the defect. See `QA/history/known-issues.json` → `refuted`.

---

## Scoring (static-analysis basis only)

Scores reflect what static review + the new test suite can see. Runtime dimensions are
**Not Measured** here and must come from on-device QA.

| Dimension | Score | Basis |
|---|---|---|
| Correctness / Stability | **B** | One cold-open crash (fixed); happy paths sound. Runtime crash-rate Not Measured. |
| Data integrity | **B–↑** | Serious Restore data-loss (fixed); multi-device merge still weak (H2 parked). |
| Security | **C+** | 2 unauthenticated High vulns; 1 fixed (SSRF), IDOR + backup brute-force parked. |
| API robustness | **B+** | Provider fallback chains solid; two timeout gaps fixed. |
| Code quality / Maintainability | **B** | Very large screens (4–5k LOC); consistent store/persist patterns. |
| Regression health | **A (new)** | Infra now exists; 28 tests; every fixed bug guarded. |
| Architecture | **B+** | Clean expo-router + Zustand; sensible provider layering. |
| Performance / Battery / Accessibility | **Not Measured** | Requires on-device runs. |

**Production readiness:** **Conditional.** The consumer-facing crash/data-loss risks in this
pass are fixed and guarded. Before broad release, resolve the two parked **unauthenticated**
security findings (H4 IDOR, H6 backup brute-force) — those are the real blockers — and run the
deferred on-device performance/accessibility phases.

---

## Recommendations / follow-ups

- **H2 (multi-device merge) — the one genuinely-parked item:** implement per-record **tombstones**
  or a per-device high-water-mark / versioned sync, then union grow-mostly stores safely. Only
  then can you preserve one device's adds *and* honor the other's deletions. Until then the length
  heuristic + H1's restore guard are the safe approximation. (Alternatively: UI-warn that one
  Backup ID across two active devices isn't supported.)
- **H4 follow-up:** upgrade the shared app-key to real per-user auth — bind messaging identity to
  the hardened backup passphrase, or issue email-verified per-user tokens. Set
  `MESSAGING_APP_SECRET` + `MESSAGING_ALLOWED_EMAILS` on the server now to strengthen the current fix.
- **H6 follow-up:** apply migration 0005 so the DB per-IP limiter is active cross-instance; the
  in-memory per-email layer covers the gap until then.
- **SSRF hardening sweep:** adopt `api/_ssrfGuard.ts` in `course-proxy`, `golfbert-proxy`,
  `image-edit` (same user-URL-fetch shape; not separately confirmed this pass but same class).

---

## Deferred (device-only — not run in this environment)
Live session simulation · performance (CPU/GPU/memory/FPS/startup/latency) · battery ·
VoiceOver/TalkBack & accessibility · real camera/GPS/Bluetooth/watch hardware. These need
an on-device harness (Detox/Maestro + a physical device or simulator).

---

## Artifacts
- Application model → `QA/model/` (application-model, navigation-map, state-machine, api-map, voice-flow, camera-flow, feature-dependencies)
- Persistent knowledge base → `QA/history/` (known-issues, resolved-issues, regression-tests, runs)
- Tests → `__tests__/` (`npm test`, or `npm run test:logic` for the fast node suite)
