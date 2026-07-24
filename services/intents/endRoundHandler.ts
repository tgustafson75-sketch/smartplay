import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { usePointsStore } from '../../store/pointsStore';
import { track } from '../analytics';

export const endRoundHandler: IntentHandler = {
  intent_type: 'end_round',

  parameter_schema: {},

  examples: [
    'end the round',
    "that's the round",
    'wrap up the round',
    "let's call it",
  ],

  async execute(_intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "No active round to end.",
        side_effects: ['endRound:no_active_round'],
        follow_up_needed: false,
      };
    }

    // Snapshot BEFORE endRound() resets scores/courseHoles/activeCourse,
    // mirroring caddie.tsx generateRoundSummary snapshot pattern.
    const snapshotScores = { ...round.scores };
    const snapshotCourseHoles = [...round.courseHoles];
    const cName = round.activeCourse ?? 'the course';
    const total = round.getTotalScore();
    const vspar = round.getScoreVsPar();
    const played = round.getHolesPlayed();

    const roundId = round.endRound();
    track('end_round_voice', { round_id: roundId });

    // 2026-07-24 (audit — double-credit fix) — round-completion points are awarded ONCE inside
    // round.endRound() (gated on holesPlayed>=9 && !isSimRound). This caller-side award was a
    // leftover duplicate that also lacked the sim/holes gate — so a narrated sim round or a sub-9
    // round wrongly earned points + climbed the tier. Removed; endRound() is the single source.

    // Build contextual spoken summary mirroring caddie.tsx buildContextualSummary.
    // 2026-07-07 (audit) — was `par ?? 4`, which scored par-3/par-5 holes against
    // par 4 and spoke the wrong birdie/bogey tally. Only count holes with KNOWN par.
    const holesWithPar = Object.entries(snapshotScores)
      .map(([h, s]) => {
        const par = snapshotCourseHoles.find(c => c.hole === Number(h))?.par ?? null;
        return { hole: Number(h), score: s, par, offset: par != null ? s - par : 0 };
      })
      .filter((h): h is { hole: number; score: number; par: number; offset: number } => h.score > 0 && h.par != null);
    let summaryLine: string;
    if (holesWithPar.length === 0) {
      summaryLine = `${played} holes at ${cName} — let's see what the recap says.`;
    } else {
      const best = holesWithPar.reduce((b, h) => (h.offset < b.offset ? h : b));
      const worst = holesWithPar.reduce((w, h) => (h.offset > w.offset ? h : w));
      const birdies = holesWithPar.filter(h => h.offset < 0).length;
      const pars = holesWithPar.filter(h => h.offset === 0).length;
      const bogeys = holesWithPar.filter(h => h.offset === 1).length;
      const doublesPlus = holesWithPar.filter(h => h.offset >= 2).length;
      if (vspar <= -3) {
        summaryLine = `${total} at ${cName} — ${Math.abs(vspar)} under. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars. Real golf.`;
      } else if (vspar === 0) {
        summaryLine = `Even par at ${cName}. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars, ${bogeys} bogeys — discipline showed up today.`;
      } else if (vspar <= 3 && played >= 9) {
        const bestLabel = best.offset < 0 ? 'birdie' : best.offset === 0 ? 'par' : `${best.score} on a par ${best.par}`;
        summaryLine = `${total} on the card at ${cName} — ${vspar > 0 ? '+' + vspar : vspar}. Best hole was ${bestLabel} on ${best.hole}. ${pars + birdies} of ${played} holes at or under par.`;
      } else if (played < 9) {
        summaryLine = `${played} hole${played === 1 ? '' : 's'} in at ${cName}. ${birdies} birdie${birdies === 1 ? '' : 's'}, ${pars} pars, ${bogeys + doublesPlus} over — short sample, but I'm tracking it.`;
      } else {
        const worstLabel = worst.offset >= 2 ? `${worst.score} on hole ${worst.hole}` : `+${worst.offset} on ${worst.hole}`;
        summaryLine = `${total} at ${cName} — ${vspar > 0 ? '+' + vspar : vspar}. ${worstLabel} stung, but ${pars + birdies} hole${pars + birdies === 1 ? '' : 's'} held up. Recap'll show the patterns.`;
      }
    }

    return {
      success: true,
      voice_response: summaryLine,
      side_effects: [`endRound:${roundId}`],
      follow_up_needed: false,
      tool_action: { type: 'navigate_replace', path: `/recap/${roundId}` },
    };
  },
};
