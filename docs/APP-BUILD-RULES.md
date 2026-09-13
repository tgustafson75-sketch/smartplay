# APP BUILD RULES

**Status:** STANDING. Written 2026-09-13 by consolidating every rule, principle, guide and
hard-won lesson on this machine into one place.

---

## RULE 1 — EVERY NEW SESSION FOLLOWS THESE RULES

Read this file at the start of every session, before writing code, before proposing a fix, before
declaring anything shipped. These are not suggestions and they are not history: each one is here
because ignoring it already cost money, a review cycle, a shipped defect, or a day of Tim's time.

If a rule here conflicts with your instinct, the rule wins. If a rule here conflicts with something
Tim says now, **Tim wins** — and then this file gets updated in the same session.

**Part A applies to every app.** **Part B is SmartPlay Caddie.** Read both; Part A is where the
repeat offenders live.

---
---

# PART A — GENERAL BUILD PRINCIPLES

*These apply to every app in this workspace: SmartPlay Caddie, Rondo, SmartGarden, SmartGreens,
SmartMotion, SmartFinder, PlaySmart, SmartPlay DIY, SmartManage. Several repos carry a copy of some
of these under "ported from SmartPlay" — this file is the canonical statement. When they disagree,
this one is right and the copy is stale.*

## A1. Ship green, and know what green means

- Every gate the project defines must pass before commit. For Caddie that is **four commands, not
  three** — see B4. For any project: typecheck, lint, tests, and whatever project-specific harness
  exists.
- **A gate that cannot fail is not a gate.** Before citing a gate as proof, confirm it can go red.
  Guards have been found matching a doc comment, pointed at a file that no longer exists, and
  scoped to a window that ended before the code they were meant to check.
- **A gate that is always red gates nothing either.** If a gate is failing at HEAD and everyone has
  learned to step over it, it is not protecting anything — either fix the backlog or change the
  rule deliberately and write down why. (Live example: B10.)
- Never `--no-verify`. Never amend a published commit.

## A2. Every finding gets a guard, and every guard gets break-tested

This is the single highest-value rule on the list.

- A fix without a permanent assertion is a defect waiting to come back quietly. **Diff findings
  against tests at the END of every audit** — on 2026-09-11, 3 of 11 findings had no guard, and the
  worst one had been *proved* by a probe that was then deleted. [[every-finding-needs-a-guard-before-you-call-it-fixed]]
- **Break-test it: revert the fix and watch the guard fail.** Three of seventeen guards could not
  fail on 2026-08-24 — all three matched the doc comment, not the code. [[break-test-every-guard-you-write]]
- **Strip comments before matching source.** Four guards in one session were defeated by the prose
  written to explain the very bug they guarded. It has happened again since, in a session that had
  already read the memory about it. [[strip-comments-before-a-guard-matches]] [[my-own-comment-defeats-my-own-guard]]
- **Assert the property AND the absence of the broken form.** A guard that pins the exact wrong
  expression stays green through the bug. [[a-guard-can-assert-the-broken-shape]]
- **Prefer if-and-only-if over one-directional.** A guard whose premise can flip will silently stop
  checking when it flips: a LOCK forbidding a permission went false and then *blocked the fix*; a
  health-disclosure guard short-circuited to "nothing to disclose" and certified four copies of a
  policy describing data the app no longer collects. [[a-guard-can-enforce-a-stale-premise]]
- **Three ways a guard is worthless:** prose-only, pointed at an island, or a non-greedy window whose
  target appears twice. [[three-ways-a-guard-is-worthless]]
- **An invariant has three homes:** the code, a harness scenario, and the project's own simulation
  guard. [[an-invariant-has-three-homes]]
- **A guard that cannot reach the artifact certifies the draft.** 928/928 green over a nine-day-stale
  *live* policy. Curl the published URL, read the built binary, open the actual artifact.
  [[a-guard-that-cannot-reach-the-artifact-certifies-the-draft]]
- Guards beat agents wherever a guard can do the job: deterministic, every commit, free. Agents earn
  their place only on what a regex cannot see — and then **every agent finding ships with the
  assertion that would have caught it.** A specialist that leaves five gates is worth more than one
  that files five reports.

## A3. Do not trust your first assumption, and never trust your own same-day fix

- Tim, 2026-09-11: *"Don't trust any of your first assumptions the first time, they tend to have a
  mid accuracy rate. Don't burn tokens or time being predictably wrong by jumping to quick
  conclusions."* The first finding of that audit was the fix from an hour earlier.
- **Adversarially re-read your own work, especially today's.** Triple-check; on anything round- or
  money-critical, ten times. [[ten-times-check-your-work]] [[feedback-triple-check]]
- **A root cause CARRIED is an OPEN defect** — say so in line one, do not bury it.
- **Verify negative claims before relaying them.** "There is no source for X" from a doc or another
  agent is a claim to test with a grep, not to repeat — especially before narrowing scope or asking
  Tim a question. [[feedback-verify-negative-claims]]
- **State what you measured, not what you intended.** If a commit message or a summary describes
  behaviour, run the behaviour first. Three in one day on 2026-09-03. [[state-what-you-measured-not-what-you-intended]]

## A4. Fix root causes; a bandaid is a defect with a nicer face

Full text in [ENGINEERING-PRINCIPLES.md](ENGINEERING-PRINCIPLES.md) — thirteen standing rules,
created after six weeks and ~80 commits of GPS/voice band-aids on top of 2–3 root causes. The
non-negotiable core:

1. **Find when it last worked** before any fix to existing behaviour. Archaeology precedes patching.
2. **Removing code beats adding it.** A 90%-additions diff on a recurring bug *is* the bandaid pattern.
3. **No new user-facing error or status surface without a root cause first.** Reporting a problem is
   not fixing it, and it teaches the user the app is fragile.
4. **No new fallback / timeout / threshold / retry without naming what it masks.** "Defending against
   an unknown" does not ship.
5. **Two attempts, then archaeology.** The third attempt is the signal, not the twenty-fifth.
6. **Trust the user's lived reality over the code's claim.** Do not explain to Tim why his phone is
   wrong.
7. **Competitor parity demands architectural justification.** "GPS is noisy here" is not an excuse a
   competitor on the same hardware gets to make.
8. **Honest degradation is not infinite latitude** — it applies to a named, known failure mode, never
   as cover for an unknown one.
9. **Double-check before `git add`:** re-grep for what was supposed to change, confirm what was
   supposed to stay, typecheck, hunt orphan imports.

## A5. One owner per fact

- **Two owners is the root cause.** Five defects, one shape: a 7-wood called a "5 wood", a
  rangefinder's 205 clubbed to the card's 180. When two places hold one fact they will diverge, and
  the bug appears where they meet. [[two-owners-is-the-root-cause]]
- One document living in several files is the same defect in prose. If duplication is unavoidable,
  **guard the equality of the copies**, not the phrases someone happened to think of.
- **Point, do not copy.** An index, a README or a rules doc should link the authority; a second copy
  of the content is a fork with a delay fuse.
- **A stale header is a source someone trusts.** Three bugs in one day came from out-of-date
  comments; one was trusted four hours after being read. When behaviour changes, the comment
  describing it is part of the change. [[a-stale-header-is-a-source-someone-trusts]]

## A6. Orphans are live bugs, not dead code

- "No callers" means **UNCONNECTED**, not dead. A sweep for orphans produced seven live defects and
  zero dead code. [[orphans-are-live-bugs-not-dead-code]]
- Ask **"where SHOULD this be?"** before "is this used?". If you cannot answer, you do not understand
  it well enough to delete it — say so and leave it.
- Delete only a true **duplicate** or something **unreachable by construction**, and say which, with
  evidence.
- **Sweep the missing half, not the unused export.** Grep both `.name` and the bare destructured
  name; verify every hit. Four sweeps, eight live bugs. [[sweep-the-missing-half-not-the-unused-export]]
- **A connection is finished when the whole path works**, not when the call compiles.

## A7. Built is not reachable

- **Ask whether the user can REACH the result**, not merely whether the chain exists. A complete tool
  chain can still dead-end. [[feedback-reachable-not-just-wired]]
- A capability wired to a **screen** is still half-wired if the product is something you talk to —
  see B2 for the Caddie-specific form of this, which has caught something every time it has been
  applied.
- **A control the documentation names must be a control the user can find.** A policy citing store
  keys ("Share diagnostics") instead of the labels on screen ("Auto-send my issue reports") is an
  opt-out pointing at nothing.
- **Verify features in the DEFAULT configuration.** Auto Shot Detection measured 0% adoption because
  `cartMode` defaults true. The default install is the product almost everyone uses.
  [[a-toggle-that-does-nothing-for-the-default-user]]
- **A success reported by a step that never checked is not a success.** `markDownloaded` ran whether
  the build produced 18 greens or zero. [[a-download-that-ticked-with-no-greens]]

## A8. Honesty is a feature, and silence is not an answer

- Honesty means **confidence and a range, never `null`.** A gate that cannot answer must say what it
  still needs. A floor you cannot see makes correct silence look broken.
  [[silence-is-not-an-answer]] [[guards-by-element-not-blanket-suppression]]
- **The client must be the last to give up.** Four user-visible timeouts against a server answering
  in 0.3s. [[the-client-must-be-the-last-to-give-up]]
- **Arithmetic belongs in code, not in the model.** Club match, weather, physical limits, go/no-go —
  all beat prompt wording, and all of it fell over instantly when left to the prompt.
  [[arithmetic-belongs-in-code-not-the-model]]
- Never fake completion. If something cannot ship honestly in the time available, say so explicitly
  and scope the follow-up. Finish everything else in full and name what you left out.

## A9. Money and machine discipline

- **Tests must not reach production or paid endpoints.** One `npm test` fired nine production calls,
  seven of them paid. A guard private to one sender misses the second — enforce at the shared owner.
  [[field-report-was-the-test-suite]]
- Protect prompt-cache stability deliberately; an accidental per-turn interpolation cost $50 in a day.
- **Never `git add -A` from a worktree.** A trailing slash in `.gitignore` ignores directories only,
  so a `node_modules` symlink got committed. [[node-modules-was-committed-as-a-self-symlink]]
- Store artifacts fail for boring reasons: **App Store Connect refuses any alpha channel** (`sips`
  png→png does *not* strip it) and **Play refuses a `.so` under 16384 alignment**. Parse the
  artifact, don't trust the build log. [[store-assets-reject-alpha-and-unaligned-libs]]
- **A published change is not shipped until it is pushed and fetched from the live URL.** Verify
  against the live artifact, not against the push.

## A10. The repo is the memory

- Chat is disposable; files are not. Every session closes with a save-point committed and pushed —
  for Caddie that is `docs/SPRINT-LOG.md` + `docs/SPRINT-RESUME.md` (see B8).
- End every multi-step task with three separate commands, never combined, never skipped:
  `git add .` / `git commit -m "…"` / `git push origin main`.
- Memory files are recalled by name and their index is loaded every session. **Hooks are
  point-in-time:** any "not built / parked / dormant" claim goes stale as work ships — verify against
  code before acting on it.

## A11. How to work with Tim

- **Lead with the answer.** No preamble.
- **EVERY QUESTION IS BINARY. This is a rule, not a style note.** (Tim, 2026-09-13.)
  Two options. Recommendation first, marked. Never a list of open considerations, never "what would
  you like to do here?", never four things raised with no choice attached. If something genuinely has
  three paths, ask the first binary question and then the second one — do not widen the menu.
  A paragraph of trade-offs with no option attached is an open-ended question wearing a hat, and it
  costs Tim the exact thing the rule exists to protect (adult ADHD — explicitness is a requirement,
  not a preference).
  **If you catch yourself writing "that's your call" without two labelled options underneath, stop
  and write the options.**
- **Do the discovery yourself.** Tim should never have to grep, hunt for a file, or paste contents.
- Standing decision rule: make the logical call toward the vision without asking; note non-obvious
  calls in one line at the top of the response. Tim overrides if he disagrees.
- Prefer synthetic/programmatic verification over field testing. A field round is the FINAL gate,
  never the first suggestion.
- Aggressive timeline AND clean product are both non-negotiable. Never accumulate polish debt.
- **Never ship the "Tank" persona voice in any app. Kevin and Serena only.** [[feedback-no-tank-persona]]

---
---

# PART B — SMARTPLAY CADDIE

*Authority for detail: [../CLAUDE.md](../CLAUDE.md). This section is the checklist; CLAUDE.md carries
the full statements and the worked examples.*

## B1. State of the world (2026-09-13)

- **The app is SUBMITTED.** Play is ready-to-publish, Apple is in review. **A native change now costs
  a review cycle** — OTA is the fast path. Ask which before proposing anything that touches native.
- **THERE IS NO INSTALL BASE TO PROTECT.** (Tim, 2026-09-13: *"No one but me is really using this
  version and remember this is about launch not now."*) Tim is the user. Decisions are made for the
  state the app LAUNCHES in, not for migration safety or continuity with what is on a phone today.
  - *"Existing users may rely on it"* is **not** a reason to keep a control, a default or a surface.
    Ask instead: **is this what launch should look like?**
  - *"Flipping this default only affects new installs"* is not a limitation — **new installs are the
    product.** A default that is wrong for a first-time player is wrong, full stop.
  - Persisted-state migrations still matter for Tim's own device and for anything already in review,
    so do not delete a migration that maps old state forward. Deleting the *feature* is a launch
    decision; stranding *stored state* is still a bug.
  - This inverts the usual caution: the expensive mistake pre-launch is shipping clutter nobody chose,
    not removing something somebody might miss.
- Code: `/Users/timothyg/smartplay` (remote `smartplay.git`).
- Live marketing site *and the legal pages Google Play's Data safety form points at*:
  `/Users/timothyg/smartplaycaddie` — separate repo, auto-deploys to smartplaycaddie.com on push.
  **A policy change is not done until it is pushed from there.**
- Written-about-the-project docs: `~/Desktop/SmartPlay-Project-Files/` (its README is the index;
  `memory/` there is a symlink to the live agent memory, deliberately).
- Lookalike folders that are NOT the project: `SmartPlay-Caddie-V3`, `smartplay-vnext`,
  `Desktop/smartplay-temp`, `Desktop/smartplay-review-406ab3a-full`, `smartplaycaddie_review.zip`.

## B2. THE LENS — both halves

1. **Nothing here is arbitrary.** There is nothing left to BUILD; the work is check, quality-control,
   function-check, engineering test, fail test. Unconnected ≠ dead. Anything deliberately not wanted
   is already parked for v2.
2. **Is it reachable from a CONVERSATION?** The app is a person you talk to; screens are one way in,
   not the way in. For anything the app measures, ask both: can the player SEE it (a screen reads
   it — usually yes) and can the player ASK about it (it reaches `services/caddieRequestBody`, the
   one payload builder — this is the half that keeps being missing). Three sweeps on 2026-09-12→13
   answered "screen only" every single time.
   - **A question intercepted before the brain is a question the caddie never heard.**
     `services/localIntentPrecheck` dispatches at confidence 'high' *before* `/api/kevin`; a regex one
     word too loose replaces a conversation with a lookup.
   - **Answering is not reaching.** `queryStatusHandler`'s off-round deflection ("You're not in a
     round yet") is the app declining to be talked to.

## B3. Architecture invariants

- **ONE brain** — `api/kevin.ts`. `pipecat-turn.ts` / `_brainShim.ts` are deleted; turn 1 and turn 2
  are the same code. **Never add a "parity" guard between brains.**
- **ONE payload builder** — `services/caddieRequestBody.ts`.
- Modes are `course` / `range` / `sim`. **`cage` no longer exists anywhere** — but the swing store's
  AsyncStorage key is still `cage-store-v1` and **must never be renamed** (that abandons every
  tester's swing library).
- Brain runs OpenAI or Gemini via the `X-AI-Provider` header; TTS is always OpenAI
  `gpt-4o-mini-tts`. Provider abstraction is `api/_aiProvider.ts`.
- Trust Spectrum L1 Quiet → L2 Companion (default) → L3 Active → L4 Full.
- Multi-player data models carry `player_id`, `speaker_id` and roster fields even in single-player.
- Three pillars: ROUND (1.0), PRACTICE/SwingLab (partial 1.0 — same feature), PLAY (1.1).
- Personas: Kevin and Serena. Harry/Tank exist in types; pass `caddiePersonality`, not `voiceGender`,
  or ~30 surfaces render the wrong name.

## B4. The four gates — the sim is not optional

```
npx tsc --noEmit
npx expo lint
npx jest
npm run sim          ← ~20 seconds, and jest does NOT cover it
```

`scripts/simulations/run-sim.ts` holds guards that exist nowhere else, including the
**cached-system-prompt RATCHET** that fails on any new interpolation into `api/kevin.ts`'s cached
block until someone registers it deliberately. A commit shipped past it on 2026-09-12 because only
jest was run. The 08-24 cache defect it protects against cost $50 in a day.

## B5. The six critical paths

ONBOARD · ROUND · CAGE · VOICE · GPS · SCORECARD — defined in
[critical-paths.md](critical-paths.md), each with its own log marker
(`[path1:onboard]`, `[path2:round]`, `[path3:cage:STAGE]`, `[path4:voice]`, `[path5:gps]`,
`[path6:scorecard]`). A phase touching a path states which, states expected behaviour, and is
**not shipped until Tim verifies it on the device**. Before citing a marker as a gate, confirm it is
actually emitted — Path 1 once documented seven markers of which one existed, and not on that flow.

## B6. Locked elements

**Kevin's photoreal portrait is LOCKED** at commit `19165fb`. One container rule
(`height = round(W * 16/9)`), no aspect branches, no nudges; `CaddieAvatar` transforms are breath +
nod + drift only. If Kevin looks off-centre on a new device, **audit the parent container and move
the other element** — never add a compensating transform. Any Caddie-home work runs the checklist in
CLAUDE.md before reporting complete.

## B7. Legal and policy — four files, one document

- The privacy policy exists in **four** places that must agree:
  `docs/legal-site/privacy-embed.html`, `docs/legal-site/privacy.html`, `docs/privacy-policy.html`,
  and `constants/legalText.ts` (the in-app copy rendered by `app/legal.tsx` and reached from the
  welcome/consent screen). The site page in the other repo is generated from the embed fragment.
  `docs/privacy-policy.md` is a **superseded draft** — it says so itself; do not treat it as a copy.
- **Any consent that DEFAULTS ON must be in the document.** `shareDiagnostics` and
  `shareCommunityData` both default true.
- **The processor list is a claim about the code.** Every disclosed vendor needs a live code marker;
  every live vendor appears in every copy. The automatic issue send is anonymous (install id); the
  **manual** export carries the email deliberately.
- Health Connect: permissions are **out** for 1.0 and `HEALTH_CONNECT_ENABLED === false`. No copy may
  describe collecting it. The reverse also holds — declare it again and every copy must disclose it.
- All of the above is now enforced by six guards in `run-sim.ts`, each break-tested on 2026-09-13.
- After changing a policy: push the app repo **and** the site repo, then **curl the live URL**.

## B8. Save-points and handoffs

- Close every session by appending to `docs/SPRINT-LOG.md`, refreshing `docs/SPRINT-RESUME.md`, and
  pushing both. A fresh session reads SPRINT-RESUME first, then SPRINT-LOG, then
  `docs/audit-420-SPRINT-MAP.md`. On conflict: SPRINT-MAP wins on priorities, SPRINT-LOG on what
  shipped when, SPRINT-RESUME is the short pointer.
- `_handoff/` (gitignored) is the Cowork channel: `from-code.md` / `from-cowork.md` / `state.md`.
  Append at the TOP; every entry ends in an explicit ask. Read it at session start.
- Deferred TODOs live in `docs/v1.2-deferred.md` — check it before ripping one out.
- Build-blocked items live in `docs/NEEDS-A-NATIVE-BUILD.md`.

## B9. Naming

- **TightLie** — user-facing name for the lie-analysis flow (internally "Phase H"; route
  `/lie-analysis`). Internal names unchanged for back-compat.
- **GolfFather** — reserved, NOT built. Do not build it.
- Support address for every store and user-facing field: `support@smartplaycaddie.com`.

## B10. Known live exception — lint is red at HEAD

`npx expo lint` reports **76 errors** at HEAD, essentially all of them the project's own
`i18n/no-hardcoded-jsx-text` rule (user-facing English not wrapped in `t()`, tracked in
`docs/I18N-AUDIT.md`). So "lint must pass before commit" is currently untrue, and a gate everyone
steps over protects nothing (A1). Two honest options, Tim's call: clear the i18n backlog, or drop the
rule to `warn` and track the backlog as work. Until one of those happens, **check that your change
adds no new lint error rather than that the suite is clean** — and do not report lint as passing.
