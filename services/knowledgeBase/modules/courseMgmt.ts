/**
 * COURSE MANAGEMENT — golf-knowledge module (layer 'course_mgmt').
 *
 * The tour-caddie / DECADE lineage of strategy: shots are a CONE not a line;
 * pick the highest-probability acceptable outcome (expected value) over the
 * heroic closest-to-flag; play a safe-miss doctrine; bias to center-green and
 * conservative targets; and let ONE committed decision beat three tentative
 * adjustments.
 *
 * HONESTY: this is where the app actually HAS signals — `gps` (distance to
 * target, plays-like, wind) and `tracked_dispersion` (the player's real left/
 * right + long/short spread). Strategy entries that lean on those are
 * directional (the read is real, the recommendation is judgment); pure doctrine
 * is coaching_only.
 */

import type { KBEntry } from '../schema';

const MODULE = 'course_mgmt';

export const COURSE_MGMT: KBEntry[] = [
  {
    id: 'cm.dispersion-cone',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'shots are a cone, not a line',
    aliases: ['dispersion', 'shot dispersion', 'aim point', 'where should i aim', 'shot cone', 'how wide do i hit it'],
    principle:
      'Every shot is a CONE of outcomes, not a single line — your aim point has to make the WHOLE cone acceptable. Aim so even your normal miss-edge finds a safe result; if one edge of the cone brings a hazard into play, shift the aim until it doesn’t.',
    appSignals: ['tracked_dispersion', 'gps'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['aim the cone, not the line', 'make the whole pattern safe', 'move aim off the hazard edge'],
    related: ['cm.expected-value', 'cm.safe-miss', 'bf.diagnose-from-pattern'],
    source: 'decade',
  },
  {
    id: 'cm.expected-value',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'expected-value shot selection',
    aliases: ['smart play', 'whats the smart play', 'go for it or lay up', 'expected value', 'percentage golf', 'best play here'],
    principle:
      'Choose the shot with the best EXPECTED outcome across your whole dispersion, not the best-case result. The highest-probability acceptable shot beats the occasionally-brilliant, often-costly one — over a round, percentages win. Closest-to-flag is rarely the highest-value target.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies', 'bag'],
    coachingCues: ['play the percentages, not the highlight', 'best average beats best case'],
    related: ['cm.dispersion-cone', 'cm.center-green', 'cm.safe-miss'],
    source: 'decade',
  },
  {
    id: 'cm.safe-miss',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'safe-miss doctrine',
    aliases: ['safe miss', 'where to miss', 'good miss', 'whats the bail out', 'avoid the big number', 'where not to miss'],
    principle:
      'Before any shot ask: "if I miss this by 15 yards, where does it finish?" Aim to make your likely miss a routine up-and-down, never a lost ball or unplayable. Eliminating the double bogey matters more than chasing the birdie.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['miss it 15 yards — then where?', 'protect against the big number', 'leave yourself a simple next shot'],
    related: ['cm.dispersion-cone', 'cm.center-green', 'psych.intention-over-avoidance'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.center-green',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'conservative bias / center-green',
    aliases: ['aim at the flag or center', 'pin hunting', 'fire at the pin', 'center of the green', 'conservative target'],
    principle:
      'Default to the fat part of the green — center-green takes the short-side and the hazard out of play and still leaves a makeable putt. Only flag-hunt when the number, lie and a safe miss all line up. Conservative target, committed swing.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['center green by default', 'earn the flag with number + lie + safe miss', 'conservative target, aggressive swing'],
    related: ['cm.expected-value', 'cm.safe-miss', 'cm.commitment'],
    source: 'decade',
  },
  {
    id: 'cm.commitment',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'commitment over adjustment',
    aliases: ['commit to the shot', 'i second guess', 'indecision over the ball', 'committed swing', 'trust the shot'],
    principle:
      'One committed decision beats three tentative adjustments. Make the club-and-target call BEHIND the ball, then walk in and execute without re-deciding — a fully committed swing on a slightly wrong plan outperforms a hesitant swing on the perfect one.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['decide behind the ball', 'no re-deciding over it', 'commit, then swing'],
    related: ['psych.commitment', 'cm.center-green', 'putt.routine.short'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.tee-strategy',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'tee shot — club off the tee',
    aliases: ['what club off the tee', 'driver or 3 wood', 'should i hit driver', 'tee shot strategy', 'club off the tee'],
    principle:
      'Pick the tee club that puts your whole dispersion in the widest safe landing zone for the shortest approach you can reliably control — not always driver. A shorter club that keeps every miss in play often leaves a better number than a driver that flirts with trouble.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies', 'bag'],
    coachingCues: ['widest safe zone, not max distance', 'driver only where the cone fits'],
    related: ['cm.dispersion-cone', 'cm.expected-value'],
    source: 'decade',
  },
];
