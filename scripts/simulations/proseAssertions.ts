/**
 * GUARDS THAT READ PROSE — the harness's own version of the defect it exists to catch.
 *
 * 2026-08-24 (Tim: "check all our work, triple check"). Break-testing every guard written that day
 * found three that could not fail. Each had the same cause: a regex asserting that some call, field
 * or identifier EXISTS matched the doc comment ABOVE the code rather than the code itself. Delete
 * the implementation, leave the paragraph explaining it, and the guard stays green.
 *
 * One was worse than blind — the caddie-clip guard extracted a type union with a non-greedy match up
 * to the first `;`, and a comment INSIDE the union contained one, so it silently parsed one slot
 * instead of two. Comments defeated an assertion seven times in a single day: by matching prose, and
 * by truncating a parse.
 *
 * A guard that cannot fail is worse than no guard, because it is counted as coverage. So this sweeps
 * the whole harness: every positive assertion (`/x/.test(src)`, not `!/x/.test(src)`) whose pattern
 * matches the raw file but NOT the comment-stripped file is reading writing, not code.
 *
 * NOT ALL OF THEM ARE WRONG. A few guards deliberately assert that a COMMENT is present — a recorded
 * decision, or a line that must stay commented out. Those are legitimate and live in the baseline.
 * The point is the RATCHET: the existing set is frozen, and a NEW one fails the harness on the day
 * it is written. Same shape as ORPHAN_BASELINE. [[grep-guards-cant-see-dead-code]]
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../');

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

/**
 * Every "<guard label> :: <file> :: <pattern>" whose pattern is satisfied only by comments.
 * Sorted, so a diff is readable.
 */
export function findProseAssertions(): string[] {
  const simPath = path.join(ROOT, 'scripts/simulations/run-sim.ts');
  let lines: string[] = [];
  try { lines = fs.readFileSync(simPath, 'utf-8').split('\n'); } catch { return []; }

  // Every check() in this harness starts at column 0; a block runs to the next one.
  const starts: number[] = [];
  lines.forEach((l, i) => { if (l.startsWith('check(')) starts.push(i); });

  const cache = new Map<string, { raw: string; code: string } | null>();
  const load = (rel: string) => {
    if (!cache.has(rel)) {
      try {
        const raw = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
        cache.set(rel, { raw, code: stripComments(raw) });
      } catch { cache.set(rel, null); }
    }
    return cache.get(rel) ?? null;
  };

  const out: string[] = [];
  for (let b = 0; b < starts.length; b++) {
    const body = lines.slice(starts[b], b + 1 < starts.length ? starts[b + 1] : lines.length).join('\n');
    const label = (/^check\('([^']+)'/.exec(body)?.[1] ?? '?').slice(0, 60);
    const files = [...new Set([...body.matchAll(/read(?:Code)?\('([^']+)'\)/g)].map((m) => m[1]))];
    // Positive assertions only — a NEGATIVE assertion matching a comment is the opposite problem
    // (a false failure), and it announces itself immediately by going red.
    const patterns = [...body.matchAll(/(?<![!\w])\/((?:[^/\\\n]|\\.){8,}?)\/\.test\(/g)].map((m) => m[1]);
    if (!files.length || !patterns.length) continue;

    for (const f of files) {
      const e = load(f);
      if (!e) continue;
      for (const p of patterns) {
        let re: RegExp;
        try { re = new RegExp(p); } catch { continue; }
        if (re.test(e.raw) && !re.test(e.code)) out.push(`${label} :: ${f} :: /${p}/`);
      }
    }
  }
  return [...new Set(out)].sort();
}


/**
 * THE BASELINE — every prose-reading assertion as of 2026-08-24, frozen.
 *
 * Some of these are LEGITIMATE: a handful of guards deliberately assert that a comment is present —
 * a recorded decision, or a line that must stay commented out (see the voiceCommandRouter entry).
 * Most are not: they assert a call or a field that exists only in the paragraph describing it, and
 * would stay green if the implementation were deleted tomorrow.
 *
 * They are frozen rather than fixed in one pass because triaging 64 guards is its own piece of work
 * and doing it badly would weaken real coverage. What matters immediately is that the set cannot
 * GROW: a new guard that reads prose fails the harness on the day it is written, by the person who
 * wrote it — exactly the ratchet that took the orphan count from 141 to 126.
 *
 * To clear one: make the guard read comment-stripped source (run-sim's `readCode` helper) and
 * delete its line here. The rot check will demand the deletion.
 */
export const PROSE_ASSERTION_BASELINE: readonly string[] = [
  "Analysis honesty: kids\\ :: services/juniorSwingAnalyzer.ts :: /\\/\\/ Fallback score is a placeholder, so never claim a progress delta[\\s\\S]{0,40}vs_previous: null/",
  "Analysis speed: pre-warm the lambda on record entry (kills c :: app/swinglab/smartmotion.tsx :: /\\/api\\/swing-analysis/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: api/swing-analysis.ts :: /\\.tsx?\\b|api\\/|services\\/|store\\/|useState|zustand/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/(tabs)/caddie.tsx :: /just inside the upper-right corner/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/(tabs)/caddie.tsx :: /startGpsManager/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/_layout.tsx :: /_migratedFromProfile/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/_layout.tsx :: /roundHistory/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/practice/fit-profile.tsx :: /carryFor:/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/swinglab/smartmotion.tsx :: /ball speed\\/departure are intentionally NOT cleared here/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/swinglab/smartmotion.tsx :: /warm the fault-read Lambda the MOMENT recording starts/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/swinglab/swing/[swing_id].tsx :: /PRIVATE COPY \\(distinct file handle\\)/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: hooks/useVoiceCaddie.ts :: /tick\\.mp3/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/cloudSync/snapshot.ts :: /\\.tsx?\\b|api\\/|services\\/|store\\/|useState|zustand/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/intents/findMyDataHandler.ts :: /\\.tsx?\\b|api\\/|services\\/|store\\/|useState|zustand/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/intents/openToolHandler.ts :: /SIM ROUND/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/kevinGreetingManifest.ts :: /\\.tsx?\\b|api\\/|services\\/|store\\/|useState|zustand/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/localIntentPrecheck.ts :: /SIM ROUND/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/simRound.ts :: /SIM ROUND/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/simRound.ts :: /discardRound\\(\\)/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/simRound.ts :: /startGpsManager/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: store/playerProfileStore.ts :: /migrateFromProfile/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: store/playerProfileStore.ts :: /migrateFromProfile\\(\\)/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: store/roundStore.ts :: /startVoiceSimRound\\(/",
  "CNS G2: brain bag falls back to the shot-tracking bag when C :: services/caddieMemoryRetrieval.ts :: /CNS carry always WINS where it exists/",
  "CNS G2: brain bag falls back to the shot-tracking bag when C :: services/caddieMemoryRetrieval.ts :: /} else \\{[\\s\\S]*?CNS bag empty[\\s\\S]*?Learned bag:/",
  "CNS re-audit fixes: course-less reflection (G1 bug) + real a :: store/roundStore.ts :: /Player-level REFLECTION/",
  "CNS re-audit fixes: course-less reflection (G1 bug) + real a :: store/roundStore.ts :: /runs REGARDLESS of/",
  "Caddie CNS Phase 3: durable round reflections (baseline + re :: services/recapGenerator.ts :: /CNS Phase 3 — enrich the round's durable reflection/",
  "Caddie CNS Phase 4: signal-independence (answer from course  :: services/localStatusResponder.ts :: /CNS Phase 4 — signal-independence/",
  "Caddie tab: the L4 green-chevron shortcut bar is removed :: app/(tabs)/caddie.tsx :: /shortcut bar was REMOVED/",
  "Calibration auto-applies after a clean read :: app/swinglab/calibrate.tsx :: /Auto-apply: the user shouldn't have to tap/",
  "Captured clips persisted to documents (survive OS cache evic :: app/swinglab/swing/[swing_id].tsx :: /swing_clips\\//",
  "Close a tool → HOME (no white screen), deterministic + local :: services/localIntentPrecheck.ts :: /CLOSE \\/ EXIT A TOOL/",
  "Club usage is COMPLETE — clubless shots inferred from distan :: app/(tabs)/scorecard.tsx :: /else return; \\/\\/ no club \\+ no distance/",
  "Coach Mode: selected-player hero + real day-streak metric (m :: app/swinglab/coach-mode.tsx :: /streak broken if no session today\\/yesterday/",
  "Course book: Places lookup anchors website/phone; booking pr :: api/course-places.ts :: /\\bGOOGLE_API_KEY\\b/",
  "First-run tour: auto on the first few opens, skippable, repl :: hooks/useTourTarget.ts :: /useTourTarget\\('caddie\\.mic'\\)/",
  "First-run tour: auto on the first few opens, skippable, repl :: store/onboardingTourStore.ts :: /relaunchTour\\(\\)/",
  "First-run tour: auto on the first few opens, skippable, repl :: store/tourTargets.ts :: /measureInWindow/",
  "LOCK: L1HolePreview falls back to the same Mapbox hole tile  :: components/caddie/L1HolePreview.tsx :: /PRE-ROUND geometry warm/",
  "LOCK: ONE club-label map and ONE carry ladder — the name the :: services/cnsShotRead.ts :: /'3I': '4 Iron'/",
  "LOCK: ONE club-label map and ONE carry ladder — the name the :: services/cnsShotRead.ts :: /'7W': '5 Wood'/",
  "LOCK: a coach note can never be silently dropped — setter re :: app/swinglab/swing/[swing_id].tsx :: /return; \\/\\/ stay in edit mode/",
  "LOCK: a measured on-device read clears the transient cloud e :: app/swinglab/smartmotion.tsx :: /no fault to name — the measured read stands on its own/",
  "LOCK: geometry fetch outlives a slow server, and a raw cours :: app/smartvision.tsx :: /return ''; \\/\\/ never the raw id/",
  "LOCK: one answer to \"where is the green for this hole\" — the :: store/roundStore.ts :: /resolveGreenCoords/",
  "LOCK: the carry bag has ONE owner — nothing rebuilds it from :: services/shotStrategy.ts :: /carryFor\\(/",
  "LOCK: the smarter ball box can only ever improve on the feet :: services/swing/ballDeparture.ts :: /catch \\{\\s*\\n\\s*return null; \\/\\/ offline \\/ blocked host — the feet proxy stands/",
  "Perf: setLocationContext only persists on a real location tr :: store/roundStore.ts :: /s\\.currentTeeBox\\?\\.hole === hole\\.hole\\s*\\n\\s*\\) return; \\/\\/ no change/",
  "Real clubhead arc: detected-only, honestly gated, wired end- :: services/swing/clubPath.ts :: /CLUBHEAD/",
  "Round history surfaces on the dashboard (Tim: \"it doesn\\ :: app/(tabs)/dashboard.tsx :: /Recent Rounds/",
  "Segmentation: rebounds filtered, sessions can\\ :: services/swing/strikeDetector.ts :: /same strike group — the earlier peak \\(impact\\) already kept/",
  "SmartFinder: a double-tap magnifies the aim point without st :: app/smartfinder.tsx :: /baseZoomRef\\.current = next; \\/\\/ keep pinch continuing/",
  "SmartMotion review opens PAUSED (no autoplay-vs-analysis cra :: app/swinglab/smartmotion.tsx :: /useState\\(true\\); \\/\\/ review play\\/pause — starts PAUSED/",
  "SmartPump third rail: workout import → TRAINING → PERFORMANC :: app/(tabs)/dashboard.tsx :: /TRAINING → PERFORMANCE/",
  "SmartTrace capture seam — vision-camera staged behind a defa :: services/capture/captureFlags.ts :: /useCameraFormat/",
  "Swing detail: stops voice on swing CHANGE, not just unmount  :: store/cageStore.ts :: /lastReadFailed/",
  "Swing report PDF: WHITE professional coaching report with pr :: app/swinglab/swing/[swing_id].tsx :: /What's Working/",
  "Swing review: controls stay persistently visible (functional :: app/swinglab/swing/[swing_id].tsx :: /Clean-grab fade dropped — functional controls win/",
  "Tempo: accel+gyro fusion refines the through-swing but safel :: app/swinglab/indoor.tsx :: /\\/\\* accel is a bonus — gyro tempo works without it \\*\\//",
  "TightLie: analysis failure shows a human caddie line, never  :: app/lie-analysis.tsx :: /Never surface a raw JS error/",
  "Voice: explicit tap forces a warmup (bypasses dedupe) for th :: hooks/useVoiceCaddie.ts :: /prewarmVoice\\(true\\)/",
  "Voice: explicit tap forces a warmup (bypasses dedupe) for th :: services/listeningSession.ts :: /prewarmVoice\\(true\\)/",
  "Voice: greetings/check-ins route to the BRAIN (no canned poo :: services/intents/index.ts :: /\\/\\/ voiceCommandRouter\\.registerHandler\\(socialGreetingHandler\\);/",
];
