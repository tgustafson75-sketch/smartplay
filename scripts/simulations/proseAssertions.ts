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
    /**
     * 2026-08-24 (found immediately, by this sweep flagging a guard that was fine) — PAIR EACH
     * PATTERN WITH THE FILE IT IS ACTUALLY TESTED AGAINST.
     *
     * The first version took every pattern in a block and checked it against every file the block
     * read. That cross-product produced a false alarm the same day: a guard asserting
     * `mirror={false}` in smartmotion was flagged because the string also appears in a COMMENT in
     * SwingVisionCamera — a file the guard reads for a different assertion entirely. A meta-guard
     * that cries wolf gets ignored, which would be worse than not having one.
     *
     * So bind `const x = read('f')` to its variable, and only judge `/re/.test(x)` against `f`.
     * Patterns tested against something we cannot resolve to a file are skipped rather than guessed.
     */
    const binding = new Map<string, string>();
    for (const m of body.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*read(?:Code)?\('([^']+)'\)/g)) {
      binding.set(m[1], m[2]);
    }
    // Positive assertions only — a NEGATIVE assertion matching a comment is the opposite problem
    // (a false failure), and it announces itself immediately by going red.
    const assertions = [...body.matchAll(/(?<![!\w])\/((?:[^/\\\n]|\\.){8,}?)\/\.test\(\s*([A-Za-z_$][\w$]*)\s*\)/g)]
      .map((m) => ({ pattern: m[1], target: m[2] }));
    // ...plus the inline form `/re/.test(read('f'))`, which names its file directly.
    for (const m of body.matchAll(/(?<![!\w])\/((?:[^/\\\n]|\\.){8,}?)\/\.test\(\s*read(?:Code)?\('([^']+)'\)\s*\)/g)) {
      assertions.push({ pattern: m[1], target: `__inline__${m[2]}` });
      binding.set(`__inline__${m[2]}`, m[2]);
    }
    if (!assertions.length) continue;

    for (const { pattern, target } of assertions) {
      const f = binding.get(target);
      if (!f) continue;                       // cannot resolve the source — do not guess
      const e = load(f);
      if (!e) continue;
      let re: RegExp;
      try { re = new RegExp(pattern); } catch { continue; }
      if (re.test(e.raw) && !re.test(e.code)) out.push(`${label} :: ${f} :: /${pattern}/`);
    }
  }
  return [...new Set(out)].sort();
}


/**
 * THE BASELINE — every prose-reading assertion as of 2026-08-24, frozen.
 *
 * CORRECTED the same day: the first sweep reported 64 by testing every pattern against every file a
 * guard read. Pairing each pattern with the file it is ACTUALLY tested against gives 32 — half of
 * the original list were cross-product false positives, including one flagged against a comment in
 * a file the guard only reads for a different assertion.
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
  "Analyzer gets handedness + CNS-learned tendencies pretext :: app/swinglab/swing/[swing_id].tsx :: /PRIVATE COPY \\(distinct file handle\\)/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/localIntentPrecheck.ts :: /SIM ROUND/",
  "Analyzer gets handedness + CNS-learned tendencies pretext :: services/simRound.ts :: /startGpsManager/",
  "CNS re-audit fixes: course-less reflection (G1 bug) + real a :: store/roundStore.ts :: /Player-level REFLECTION/",
  "CNS re-audit fixes: course-less reflection (G1 bug) + real a :: store/roundStore.ts :: /runs REGARDLESS of/",
  "Caddie CNS Phase 3: durable round reflections (baseline + re :: services/recapGenerator.ts :: /CNS Phase 3 — enrich the round's durable reflection/",
  "Caddie CNS Phase 4: signal-independence (answer from course  :: services/localStatusResponder.ts :: /CNS Phase 4 — signal-independence/",
  "Caddie tab: the L4 green-chevron shortcut bar is removed :: app/(tabs)/caddie.tsx :: /shortcut bar was REMOVED/",
  "Calibration auto-applies after a clean read :: app/swinglab/calibrate.tsx :: /Auto-apply: the user shouldn't have to tap/",
  "Close a tool → HOME (no white screen), deterministic + local :: services/localIntentPrecheck.ts :: /CLOSE \\/ EXIT A TOOL/",
  "Club usage is COMPLETE — clubless shots inferred from distan :: app/(tabs)/scorecard.tsx :: /else return; \\/\\/ no club \\+ no distance/",
  "Coach Mode: selected-player hero + real day-streak metric (m :: app/swinglab/coach-mode.tsx :: /streak broken if no session today\\/yesterday/",
  "LOCK: L1HolePreview falls back to the same Mapbox hole tile  :: components/caddie/L1HolePreview.tsx :: /PRE-ROUND geometry warm/",
  "LOCK: a coach note can never be silently dropped — setter re :: app/swinglab/swing/[swing_id].tsx :: /return; \\/\\/ stay in edit mode/",
  "LOCK: geometry fetch outlives a slow server, and a raw cours :: app/smartvision.tsx :: /return ''; \\/\\/ never the raw id/",
  "LOCK: the smarter ball box can only ever improve on the feet :: services/swing/ballDeparture.ts :: /catch \\{\\s*\\n\\s*return null; \\/\\/ offline \\/ blocked host — the feet proxy stands/",
  "Perf: setLocationContext only persists on a real location tr :: store/roundStore.ts :: /s\\.currentTeeBox\\?\\.hole === hole\\.hole\\s*\\n\\s*\\) return; \\/\\/ no change/",
  "Round history surfaces on the dashboard (Tim: \"it doesn\\ :: app/(tabs)/dashboard.tsx :: /Recent Rounds/",
  "Segmentation: rebounds filtered, sessions can\\ :: services/swing/strikeDetector.ts :: /same strike group — the earlier peak \\(impact\\) already kept/",
  "SmartFinder: a double-tap magnifies the aim point without st :: app/smartfinder.tsx :: /baseZoomRef\\.current = next; \\/\\/ keep pinch continuing/",
  "SmartMotion review opens PAUSED (no autoplay-vs-analysis cra :: app/swinglab/smartmotion.tsx :: /useState\\(true\\); \\/\\/ review play\\/pause — starts PAUSED/",
  "SmartPump third rail: workout import → TRAINING → PERFORMANC :: app/(tabs)/dashboard.tsx :: /TRAINING → PERFORMANCE/",
  "Swing review: controls stay persistently visible (functional :: app/swinglab/swing/[swing_id].tsx :: /Clean-grab fade dropped — functional controls win/",
  "Tempo: accel+gyro fusion refines the through-swing but safel :: app/swinglab/indoor.tsx :: /\\/\\* accel is a bonus — gyro tempo works without it \\*\\//",
  "TightLie: analysis failure shows a human caddie line, never  :: app/lie-analysis.tsx :: /Never surface a raw JS error/",
  "Voice: greetings/check-ins route to the BRAIN (no canned poo :: services/intents/index.ts :: /\\/\\/ voiceCommandRouter\\.registerHandler\\(socialGreetingHandler\\);/",
];
