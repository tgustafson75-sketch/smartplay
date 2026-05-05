# Phase BV-PREP — Empirical Verification Protocol

**Audit-only phase.** No code changes. This document is the verification checklist Tim runs on Galaxy Z Fold before Phase BU sequence (BX → BV → BW → BY-quick → BZ-v1) is unblocked.

**Bundle being verified:** commits `6dff9f3` + `c752adb` + `98c5822` on origin/main as of 2026-05-04.

---

## Component 1 — Build coordination

### Metro tunnel reload is sufficient. No new EAS build required.

**Why:** Today's bundle added zero native modules. Everything in `98c5822`, `c752adb`, and `6dff9f3` is JS/TS code, asset PNGs, and Markdown docs. The existing dev-client on Tim's Z Fold (last EAS build `83d244a9-b774-4ad6-b471-46355e015892` at `https://expo.dev/accounts/tgustafson76/projects/smartplay-caddie/builds/83d244a9-...`) bundles only:
- expo-camera, expo-av, expo-file-system, expo-asset (already in build)
- @expo/vector-icons / Ionicons (already in build)
- @react-native-async-storage/async-storage (already in build)

The bundle introduces:
- New JS modules (`lib/persona.ts`, `constants/{harry,serena,tank}Character.ts`)
- New asset PNGs (Tank/Harry primaries + 54 emotion PNGs)
- Code edits across 65 existing files

All of these load through the JS bundle that Metro serves. No native side, no Gradle change, no new permissions, no Info.plist additions.

### Reload commands

From the project root in your laptop terminal:

```bash
# 1. Start Metro tunnel (if not running)
cd ~/Documents/smartplay
npx expo start --tunnel --clear

# 2. On Galaxy Z Fold dev-client:
#    - Open the SmartPlay Caddie dev-client app
#    - Shake device → "Reload" (or in Expo dev-client, tap the project URL)
#    - Wait for "Building bundle..." → "Bundle complete"
```

**`--clear` is intentional**: clears Metro's transform cache so the persona widening + emotion PNG additions get picked up cleanly. First reload after this command takes ~30–60s; subsequent reloads are fast.

### When a new EAS build IS required (for reference)

You'll need a fresh build only if a future phase adds:
- A new native dependency (anything in `package.json` with native code)
- A change to `app.json` that affects native config (permissions, splash, icon, plugins)
- A Gradle / iOS native change

**This phase does not trigger any of those.** Metro reload is the entire build path for BV-PREP.

### If reload doesn't show today's changes

Symptom: cold-launch the app after Metro reload, persona switching looks broken, or the Tools menu doesn't show the Caddie cycler.

Root-cause checklist:
1. Confirm dev-client connected to the right Metro: `expo logs` should show your laptop's tunnel URL, not a stale localhost.
2. Force-quit the dev-client app on the phone (recents → swipe away), then reopen — pure reload sometimes preserves stale module state.
3. Check Metro terminal for build errors. If lint/tsc passed locally but Metro errors at runtime, capture the error here.

---

## Component 2 — Verification protocol

Tim runs each test below. Mark each PASS / FAIL / PARTIAL in [docs/verification-BV-PREP-results.md](verification-BV-PREP-results.md). Empirical observation only — "looks correct" is not a pass without the specific check.

### TEST GROUP A — Persona switching (4 personas, cold launch each)

**Precondition:** dev-client on Galaxy Z Fold, Metro tunnel connected with today's bundle.

**A1 — Switch to Serena, cold launch.**
- Settings → Caddie → tap Serena.
- Force-stop app (Recents → swipe away SmartPlay Caddie).
- Wait 5 seconds.
- Cold launch (tap app icon).
- **Empirical check 1:** within first frame of the app rendering, the avatar shown is **Serena's portrait** — NOT Kevin briefly flashing then swapping.
- **Empirical check 2:** if the greeting screen plays, the voice that speaks is **Serena's voice** (ElevenLabs voice ID `RGb96Dcl0k5eVje8EBch`, female).
- **Empirical check 3:** Caddie tab shows Serena's name where applicable (e.g., "Serena's Presence" in Tools menu).
- **Pass:** all 3 checks. **Partial:** any one fails. **Fail:** any two or more fail.

**A2 — Switch to Tank, cold launch.**
- Settings → Caddie → tap Tank.
- Force-stop, cold launch.
- **Empirical check 1:** avatar is Tank's studio portrait (dark green BG, black SmartPlay polo, brown-haired man with stubble).
- **Empirical check 2:** if greeting plays, voice is Tank's ElevenLabs voice (`gQOVuaEi4cxS2vkZAK3A`) — should sound commanding / energetic / Marine-vet.
- **Empirical check 3:** Tools menu Caddie row reads "Caddie: Tank".

**A3 — Switch to Harry, cold launch.**
- Settings → Caddie → tap Harry.
- Force-stop, cold launch.
- **Empirical check 1:** avatar is Harry's portrait (the file currently mapped is `harry_portrait.png`, sourced from a "tank-idle-69-001.png" file in Downloads showing an older man in a red polo).
- **Empirical check 2:** if greeting plays, voice is Harry's ElevenLabs voice (`5Jfxy1x2Df4No3LQBZXE`) — should sound measured / older / wise.
- **Empirical check 3:** Tools menu Caddie row reads "Caddie: Harry".

**A4 — Switch back to Kevin, cold launch.**
- Settings → Caddie → tap Kevin.
- Force-stop, cold launch.
- **Empirical check 1:** avatar is Kevin's photoreal portrait (per Phase AU lock).
- **Empirical check 2:** greeting plays one of the bundled Kevin mp3s (e.g., "Welcome back. Let's play some golf.") — should sound exactly as it did before today's bundle (no regression).
- **Empirical check 3:** Tools menu Caddie row reads "Caddie: Kevin".
- **Pass criterion specific to A4:** Kevin path must be IDENTICAL to pre-bundle behavior. Any difference is a regression.

**A5 — Tools menu cycler (active session).**
- App is running, on Caddie tab.
- Open Tools menu (••• top-right).
- Tap "Caddie: <current>" row.
- **Empirical check 1:** persona cycles to next in order (Kevin → Serena → Harry → Tank → Kevin).
- **Empirical check 2:** avatar updates within 200ms.
- **Empirical check 3:** tapping again continues the cycle.
- **Empirical check 4:** Caddie tab voice state (if listening/speaking/idle) doesn't get stuck or glitch on switch.

### TEST GROUP B — Hydration race (the original observed bug)

**B1 — Cold launch with Serena set.**
- Confirm Settings → Caddie shows "Serena" selected.
- Force-stop app.
- Wait 5 seconds (let any AsyncStorage write settle).
- Cold launch and watch the first 2 seconds carefully.
- **Empirical check 1:** the first avatar rendered is Serena, NOT Kevin.
- **Empirical check 2:** no Kevin → Serena swap visible during the first 500ms.
- **Empirical check 3:** if greeting plays, the voice is Serena's from the first audible word.
- **The original bug** ("Kevin says 'there you are, ready when you are' but I'm set on Serena") must NOT reproduce.
- **Pass:** all 3 checks. **Partial:** any one fails. **Fail:** Kevin appears or speaks at all.

**B2 — Cold launch with Tank set.**
- Repeat B1 with Tank selected.
- Same checks, applied to Tank.

**B3 — Cold launch with Harry set.**
- Repeat B1 with Harry selected.
- Same checks, applied to Harry.

### TEST GROUP C — Tank/Harry emotion rendering

**C1 — Tank emotion crossfades.**
- Persona = Tank. App on Caddie tab.
- Tap mic / start a voice query (any prompt that triggers Kevin to speak).
- Watch avatar transition across voice states: idle → listening → thinking → speaking → idle.
- **Empirical check 1:** during `listening`, avatar shows Tank's `expressive_thinking` (chin-rub) — NOT just the static portrait.
- **Empirical check 2:** during `speaking`, avatar shows Tank's `expressive_pointing_at_you` — NOT just the static portrait.
- **Empirical check 3:** transitions between states crossfade smoothly (no flash, no Kevin face appearing during breath stage).
- **Empirical check 4:** trigger a celebratory state if possible (e.g., Hero Reel save). Avatar should cycle to `expressive_celebration`.

**C2 — Harry emotion crossfades.**
- Persona = Harry. Same protocol as C1.
- **Empirical check 1:** `listening` shows Harry's `expressive_attentive`.
- **Empirical check 2:** `speaking` shows Harry's `moods_pointing_at_you`.
- **Empirical check 3:** smooth crossfades, no Kevin face during transitions.

**C3 — Serena emotion rendering (regression check).**
- Persona = Serena.
- **Empirical check 1:** Serena's avatar still works (was pre-bundle); no regression.
- **Empirical check 2:** observe that Serena's emotion slot map is still v0 (most slots fall back to studio portrait or caddie nod). This is **expected** for now — Serena's per-emotion zip hasn't been extracted yet. Note here whether the placeholder behavior is acceptable for current ship or visually jarring vs Tank/Harry's full emotion sets.

### TEST GROUP D — Portrait visual confirmation

**D1 — Tank portrait matches character.**
- Persona = Tank. Open Caddie tab.
- **Visual check:** the portrait shown is the **studio Tank** (dark green BG, black SmartPlay polo, brown-haired man with stubble — matches the contact-sheet Tank from the zip).
- If wrong face: document which file SHOULD be Tank's primary.

**D2 — Harry portrait matches character.**
- Persona = Harry. Open Caddie tab.
- **Visual check:** the portrait shown is **the older man in red polo on a course** — currently using a file named `tank-idle-69-001.png` from your Downloads, mapped to `harry_portrait.png`.
- This was a best-guess assignment by Claude Code during the bundle. Confirm this older-red-polo guy is who you intended for Harry.
- If wrong: document which file SHOULD be Harry's primary, OR if neither file is correct, what asset Harry should use.

**D3 — Kevin portrait unchanged (regression check).**
- Persona = Kevin. Open Caddie tab.
- **Visual check:** Kevin renders **identically** to pre-bundle — same crop, same composition, same animations.
- Per CLAUDE.md "Locked elements" — any divergence here is a Phase AU regression and a hard fail.

**D4 — Serena portrait unchanged (regression check).**
- Persona = Serena. Open Caddie tab.
- **Visual check:** Serena renders identically to pre-bundle. No regression.

### TEST GROUP E — Cage Mode

**E1 — Cage overlay path.**
- SwingLab → Cage Mode card.
- Confirm distance prompt (if shown), tap Start.
- **Empirical check 1:** all controls visible and accessible during recording session — Stop button, flip-camera button, swing-count badge, club label. Nothing cut off by the gesture-nav bar at the bottom of the Z Fold.
- **Empirical check 2:** silhouette overlay (`Ionicons body-outline` at 42% green) is visible.
- **Empirical check 3:** swing count badge updates as you hit swings (or as audio detection fires on whatever input).
- **Empirical check 4:** Stop button responds to tap.

**E2 — Cage session reaches library.**
- During E1, hit ~5 swings (real swings if possible, or claps/known noises if testing detection).
- End the session.
- Wait up to 30 seconds.
- Open SwingLab → My Swing Library.
- **Empirical check 1:** the session you just ended appears as a library entry with a CAGE source badge.
- **Empirical check 2:** tap the entry. The video plays back.
- **Empirical check 3 (expected behavior, NOT a fail):** the Phase K analysis card likely shows "Kevin had trouble watching this one" or "no data" or low-confidence "none". Per Phase BU audit, this is **structural and BLOCKING**, fixed by Phase BW per-clip extraction. It is NOT a fail of THIS verification — note it as expected.

**E3 — Older `app/cage/session.tsx` reachability.**
- Investigate whether the older feel/shape grid + Log Shot UI (the second cage live UI per Phase BU finding F4) is reachable from any entry point.
- Try: SwingLab → Cage Mode (confirmed: routes to overlay).
- Try: voice intent "open practice" or "start cage".
- Try: any other navigation surface (deep link, Tools menu).
- **Empirical check:** is the older session.tsx UI ever rendered to the user? If yes, document HOW it's reached. If no, the dual-UI ambiguity is dormant in code but invisible to user — still needs cleanup, but lower priority for BV.

**E4 — Detection false positives.**
- During an E1 cage session, intentionally introduce non-swing audio:
  - 1× hand clap at 1m
  - 1× club drop on the floor
  - 1× spoken word ("hello, this is a test")
  - 1× footstep on a hollow surface
- **Empirical check:** how many of those 4 noises register as detected swings? Document specific count. Above 1/4 confirms the BU finding F6 (single-modality detection without spectral filter is false-positive prone) and informs BY-quick prioritization.

### TEST GROUP F — Foundation spot-checks

**F1 — Earbud tap engagement.**
- Caddie home, Bluetooth earbuds connected and active (audio routing through earbuds).
- Single-tap one earbud (the "play/pause" or main button).
- **Empirical check 1:** within 1–2 seconds, persona engages — listening state visible on avatar (ring, glow, or "listening" badge).
- **Empirical check 2:** mic is recording (you can speak and the orchestrator captures).
- If either fails: document specifics (no response, delayed response, wrong state, audio routes to phone speaker instead of earbuds).

**F2 — Voice query flow (PATH 4 VOICE smoke test).**
- After F1's listening state is active, ask any simple query: "what's the time" / "what's my score" / "tell me a joke" / "open SmartFinder".
- **Empirical check 1:** orchestrator captures the utterance, processes, returns a response.
- **Empirical check 2:** response audio plays through the earbud (not the phone speaker).
- **Empirical check 3:** the voice that responds is the **active persona's voice**. If persona is Tank, response is Tank's voice. If Harry, Harry's voice. Etc.
- **Empirical check 4:** response time from end-of-utterance to start-of-response is under 5 seconds (live TTS via ElevenLabs round-trip).

**F3 — SmartFinder + Mark + GPS smoke test (regression check).**
- Start any round (Free Play is fine).
- Open SmartFinder via the SmartPlay logo or Tools menu.
- Tap Mark on a known coordinate.
- **Empirical check:** Mark fires, yardages update, no errors. This is a regression check — pre-bundle behavior should hold. If anything breaks here, the persona widening introduced a regression to PATH 2.

---

## Component 3 — Failure capture template

Each test above gets a row in [docs/verification-BV-PREP-results.md](verification-BV-PREP-results.md):

```
| Test | Status | Specifics |
|---|---|---|
| A1 — Serena cold launch | PASS / FAIL / PARTIAL | <observation> |
```

**PASS** means every empirical check in that test fired correctly.

**PARTIAL** means most checks pass but at least one fails. Specifics describe which check.

**FAIL** means the test doesn't reach a usable state, or majority of checks fail, or a regression is introduced.

For PARTIAL and FAIL, capture:
- Specific check that failed
- What was observed (vs expected)
- Whether the failure reproduces consistently or intermittently
- Logcat snippet if available: `adb logcat | grep -E "\[path1:onboard\]|\[path3:cage\]|\[path4:voice\]|\[V6-DIAG\]|\[ttfa\]|persona|caddie"`

---

## Component 4 — Output

After running all tests, fill in [docs/verification-BV-PREP-results.md](verification-BV-PREP-results.md). Aggregate:

- **All-pass scenario:** BV-PREP gate clears → Phase BU sequence (BX → BV → BW → BY-quick → BZ-v1) is unblocked → next phase begins.
- **Any-fail scenario:** capture failure detail. Decide per-failure whether it's a hot-fix-now (regression in committed code) or a known-issue-defer (Phase BW will address Cage Mode no_data, etc.).
- **Mixed scenario:** some persona work passes, some doesn't. The persona widening can ship for the personas that work; specific personas may need follow-up.

The verification result, not optimism, gates the next phase.

## Mike test

Tim has clear empirical answers to:
- ✅ Does cold-launching Serena/Harry/Tank produce no Kevin flash?
- ✅ Does each persona's voice match what was recorded in ElevenLabs?
- ✅ Does Tank/Harry emotion rendering work, or are they stuck on portrait?
- ✅ Is the Harry portrait the right face?
- ✅ Does Cage Mode reach the library? Does analysis return something useful?
- ✅ Does the older session.tsx UI surface to the user?
- ✅ Does earbud + voice flow still work (no regression)?
- ✅ Does Mark / SmartFinder / round still work (no regression)?

No code change in this phase. Only verification.
