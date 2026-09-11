/**
 * 2026-09-10 (Tim: "give me an owners tool toggle that will track a round I play for all key
 * touchpoints to look for errors and issues and opportunities through a full real test round")
 *
 * THE FIELD REPORT — the analysis pass over an owner field-test round.
 *
 * WHY THIS IS NOT JUST A LONGER TRACE. The round trace already mails a timeline, and a timeline is
 * a haystack: the Hemet round produced a perfectly complete trace of a broken round and nobody
 * could see the break in it. What was missing was the step that READS the timeline and says what it
 * means — "hole 7 never resolved a green, on any of 214 fixes" rather than 214 rows that each look
 * fine. [[a-finding-that-cannot-leave-the-device]]
 *
 * THREE SEVERITIES, because Tim asked for three different things:
 *   ERROR       — something failed. A thrown call, a transcribe that never returned, a crash path.
 *   ISSUE       — nothing failed, but the player got a worse answer than the app could have given:
 *                 a yardage with no green behind it, a hole that never auto-advanced, a detected
 *                 shot that was dropped.
 *   OPPORTUNITY — nothing is wrong. A capability was available and unused, or a number was
 *                 honest-but-weak and could be made strong. This is the half a bug report never
 *                 contains and the half that decides what to build next.
 *
 * THE HONESTY RULE. Every finding cites the rows it was derived from — a count, a hole, a reason
 * string that came out of the code rather than out of this file. A finding that cannot name its
 * evidence is a guess, and a guess in a diagnostic is worse than a silence.
 * [[illustration-data-points]] [[state-what-you-measured-not-what-you-intended]]
 */
import { useRoundTraceStore, type TraceRow } from '../store/roundTraceStore';

export type FindingSeverity = 'ERROR' | 'ISSUE' | 'OPPORTUNITY';

export interface Finding {
  severity: FindingSeverity;
  /** Short stable key, so the same defect reads the same across rounds. */
  code: string;
  /** One line, in the language of the round rather than the code. */
  title: string;
  /** What was actually counted. Never a claim without a number behind it. */
  evidence: string;
  /** What to do about it, when that is knowable from here. Omitted rather than invented. */
  action?: string;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

/** Group rows by a key, preserving order of first appearance. */
function countBy<T extends string | number>(rows: TraceRow[], key: (r: TraceRow) => T | null): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/**
 * Analyse the rows currently in the trace buffer.
 *
 * Pure and synchronous over a snapshot — it never reads the live app, so a report describes the
 * round that happened rather than the state the phone happens to be in when you open it.
 */
export function analyseRoundTrace(rows?: TraceRow[]): Finding[] {
  const all = rows ?? useRoundTraceStore.getState().rows;
  const findings: Finding[] = [];
  if (all.length === 0) return findings;

  const tagged = (tag: string) => all.filter(r => r.tag === tag);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  // ---------------------------------------------------------------- greens
  /**
   * The Hemet defect, generalised: which tier answered, per hole. A hole whose green NEVER resolved
   * spent the round on `estimatedFromTee` — hole length minus distance walked — which is a straight
   * line subtraction that under-reads the moment the player is off the tee→green axis.
   */
  const greenRows = tagged('green_tier');
  if (greenRows.length > 0) {
    const holesSeen = new Set<number>();
    const holesResolved = new Set<number>();
    for (const r of greenRows) {
      const h = num(r.data?.hole);
      if (h == null) continue;
      holesSeen.add(h);
      if (r.data?.hasMiddle === true) holesResolved.add(h);
    }
    const never = [...holesSeen].filter(h => !holesResolved.has(h)).sort((a, b) => a - b);
    if (never.length > 0) {
      findings.push({
        severity: 'ISSUE',
        code: 'green.never_resolved',
        title: `${never.length} hole${never.length === 1 ? '' : 's'} never had a green coordinate all round`,
        evidence: `Holes ${never.join(', ')} — every resolution returned source 'none' (${greenRows.length} resolutions across ${holesSeen.size} holes).`,
        action: 'Yardage on those holes was hole-length-minus-distance-walked, not a measured distance to a green. Mark Green on the hole, or land real geometry for this course.',
      });
    }
    const bySource = countBy(greenRows, r => str(r.data?.source));
    const derived = bySource.get('derived') ?? 0;
    if (derived > 0) {
      findings.push({
        severity: 'OPPORTUNITY',
        code: 'green.derived_carried',
        title: 'AI-derived greens carried part of this round',
        evidence: `${derived} of ${greenRows.length} resolutions (${pct(derived, greenRows.length)}%) came from the derived cache rather than real geometry.`,
        action: 'Derivation only runs for the hole you are standing on. Deriving at course download would have these ready before the tee.',
      });
    }
  }

  // --------------------------------------------------------------- yardage
  /**
   * Tier flapping: the same hole alternating between tiers is what the player experiences as "the
   * number goes in and out". Counted as transitions rather than as a ratio, because two tiers in a
   * round is normal (GPS warms up) and twenty is the 2026-09-10 defect.
   */
  const yardRows = tagged('yardage_tier');
  if (yardRows.length > 0) {
    let flips = 0;
    const perHoleLast = new Map<number, string>();
    for (const r of yardRows) {
      const h = num(r.data?.hole);
      const src = str(r.data?.source);
      if (h == null || src == null) continue;
      const prev = perHoleLast.get(h);
      if (prev != null && prev !== src) flips += 1;
      perHoleLast.set(h, src);
    }
    if (flips >= 6) {
      findings.push({
        severity: 'ISSUE',
        code: 'yardage.tier_flapping',
        title: 'The yardage changed tier repeatedly within holes',
        evidence: `${flips} tier changes across ${yardRows.length} resolutions — the player sees the number jump between a live GPS reading and the frozen scorecard figure.`,
        action: 'Check what is clearing the GPS fix; a tier change inside one hole means the live tier stopped qualifying.',
      });
    }
    const fallback = yardRows.filter(r => r.data?.fallback === true).length;
    if (fallback > 0 && pct(fallback, yardRows.length) >= 40) {
      findings.push({
        severity: 'ISSUE',
        code: 'yardage.mostly_fallback',
        title: 'Most yardages this round were estimates, not measurements',
        evidence: `${fallback} of ${yardRows.length} (${pct(fallback, yardRows.length)}%) were flagged as fallback.`,
        action: 'The caddie clubbed off these numbers. Treat any club recommendation from this round as provisional.',
      });
    }
  }

  // ---------------------------------------------------------- hole advance
  const detectRows = tagged('hole_detect');
  if (detectRows.length > 0) {
    const advanced = detectRows.filter(r => r.data?.advance === true).length;
    const reasons = countBy(detectRows.filter(r => r.data?.advance !== true), r => str(r.data?.reason));
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    if (advanced === 0 && detectRows.length > 20) {
      findings.push({
        severity: 'ISSUE',
        code: 'hole.never_advanced',
        title: 'Auto hole advance never fired',
        evidence: `${detectRows.length} detection passes, zero transitions.${top ? ` Most common hold: "${top[0]}" (${top[1]}×).` : ''}`,
        action: top?.[0] === 'no current-hole green geometry'
          ? 'Detection needs a green for the CURRENT hole; this course never supplied one. Same root cause as the green finding above.'
          : 'Check the hold reason above against holeDetection\'s gates.',
      });
    } else if (top && top[1] >= 50) {
      findings.push({
        severity: 'OPPORTUNITY',
        code: 'hole.dominant_hold',
        title: 'One reason dominated the holds on hole detection',
        evidence: `"${top[0]}" held ${top[1]} of ${detectRows.length} passes (${advanced} transitions fired).`,
      });
    }
  }

  // ------------------------------------------------------------------ shots
  const detected = tagged('auto_detected').length;
  const dropped = tagged('auto_dropped');
  const silent = tagged('auto_logged_silent').length;
  if (detected > 0) {
    const why = countBy(dropped, r => str(r.data?.why));
    const topDrop = [...why.entries()].sort((a, b) => b[1] - a[1])[0];
    if (dropped.length > 0 && dropped.length >= detected * 0.5) {
      findings.push({
        severity: 'ISSUE',
        code: 'shot.mostly_dropped',
        title: 'Most auto-detected shots were discarded before reaching the card',
        evidence: `${dropped.length} of ${detected} detections dropped${topDrop ? `, most often "${topDrop[0]}" (${topDrop[1]}×)` : ''}. ${silent} were logged silently.`,
        action: 'A detection that is dropped is invisible to the player — the card simply stays empty. Check the gate named above.',
      });
    }
    if (silent > 0) {
      findings.push({
        severity: 'OPPORTUNITY',
        code: 'shot.silent_logged',
        title: 'Shots were auto-logged without a club',
        evidence: `${silent} shots landed on the card untagged (cart mode logs silently by design).`,
        action: 'These carry position but no club. Asking once at the end of a hole — not at the shot — would tag them without interrupting play.',
      });
    }
  } else if (all.some(r => r.event === 'round')) {
    findings.push({
      severity: 'OPPORTUNITY',
      code: 'shot.none_detected',
      title: 'No shots were auto-detected at all this round',
      evidence: 'Zero auto_detected events.',
      action: 'Either Auto Shot Detection was off, or the detector never saw a qualifying stop-then-move. Confirm the toggle before reading this as a detector fault.',
    });
  }

  // ------------------------------------------------------------------ voice
  const turns = tagged('turn_start').length;
  const failures = all.filter(r => r.event === 'error' && r.tag === 'transcribe_fail').length;
  if (turns > 0 && failures > 0) {
    findings.push({
      severity: failures >= turns * 0.25 ? 'ERROR' : 'ISSUE',
      code: 'voice.transcribe_failures',
      title: 'Voice turns failed to transcribe',
      evidence: `${failures} failures across ${turns} turns (${pct(failures, turns)}%).`,
      action: 'Each failure is a moment the player spoke and got nothing back.',
    });
  }

  // ------------------------------------------------------------------ errors
  const errs = all.filter(r => r.event === 'error' && r.tag !== 'transcribe_fail');
  if (errs.length > 0) {
    const byTag = countBy(errs, r => r.tag);
    findings.push({
      severity: 'ERROR',
      code: 'app.errors',
      title: `${errs.length} error event${errs.length === 1 ? '' : 's'} during the round`,
      evidence: [...byTag.entries()].map(([t, n]) => `${t}×${n}`).join(', '),
    });
  }

  const order: Record<FindingSeverity, number> = { ERROR: 0, ISSUE: 1, OPPORTUNITY: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** The report as text, for the email body and the owner screen. */
export function formatFieldReport(rows?: TraceRow[]): string {
  const s = useRoundTraceStore.getState();
  const all = rows ?? s.rows;
  const findings = analyseRoundTrace(all);
  const head = `FIELD REPORT — ${s.label ?? 'round'}\n${all.length} traced events\n`;
  if (findings.length === 0) {
    return `${head}\nNo findings. Every instrumented touchpoint behaved.\n\n` +
      `(That is a real result only if the round was long enough to exercise them — ` +
      `${all.length} events.)`;
  }
  const body = findings.map(f => {
    const lines = [`[${f.severity}] ${f.title}`, `   evidence: ${f.evidence}`];
    if (f.action) lines.push(`   action:   ${f.action}`);
    return lines.join('\n');
  }).join('\n\n');
  const counts = (['ERROR', 'ISSUE', 'OPPORTUNITY'] as FindingSeverity[])
    .map(sev => `${findings.filter(f => f.severity === sev).length} ${sev.toLowerCase()}`)
    .join(' · ');
  return `${head}${counts}\n\n${body}\n`;
}
