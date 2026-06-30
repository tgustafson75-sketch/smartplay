/**
 * GOLF-KNOWLEDGE module index — the concatenated KBEntry corpus.
 *
 * Increment 2 of the caddie knowledge base: the golf-knowledge LAYERS
 * (putting, setup, contact, full_swing, short_game, ball_flight, course_mgmt,
 * psychology). Each module is a curated, GROUNDED `KBEntry[]` — honesty-tagged
 * against the app's REAL signals (never claiming a measurement the app can't
 * take). `GOLF_KNOWLEDGE` is the flat corpus the retrieval helper searches.
 *
 * Pure data — no React, no Node, importable client AND server.
 */

import type { KBEntry } from '../schema';

import { PUTTING } from './putting';
import { SETUP } from './setup';
import { CONTACT } from './contact';
import { FULL_SWING } from './fullSwing';
import { SHORT_GAME } from './shortGame';
import { BALL_FLIGHT } from './ballFlight';
import { COURSE_MGMT } from './courseMgmt';
import { PSYCHOLOGY } from './psychology';
import { FAULT_LIBRARY } from './faultLibrary';
import { DRILLS } from './drills';
// Gap-fill modules (2026-06-24) — comprehensive sweep of established golf knowledge,
// filtered through truth + mid/high-handicap + growth coaching, grounded honestly.
import { SHORT_GAME_ADVANCED } from './shortGameAdvanced';
import { PUTTING_ADVANCED } from './puttingAdvanced';
import { COURSE_STRATEGY } from './courseStrategy';
import { CONDITIONS } from './conditions';
import { EQUIPMENT } from './equipment';
import { PRACTICE_DESIGN } from './practiceDesign';
import { PRACTICE_FOCUSES_KB } from './practiceFocuses';
import { WARMUP } from './warmup';
import { RULES } from './rules';
import { MENTAL_GAME } from './mentalGame';
import { PRO_EXEMPLARS } from './proExemplars';
// 2026-06-28 — distilled coaching from the curated drill-card videos
// (data/instructorVideos.ts), attributed + source-linked. Curated seed of the
// future Train-the-Trainer ingestion engine.
import { INSTRUCTOR_VIDEO_KNOWLEDGE } from './instructorVideoKnowledge';

export {
  PUTTING,
  SETUP,
  CONTACT,
  FULL_SWING,
  SHORT_GAME,
  BALL_FLIGHT,
  COURSE_MGMT,
  PSYCHOLOGY,
  FAULT_LIBRARY,
  DRILLS,
  SHORT_GAME_ADVANCED,
  PUTTING_ADVANCED,
  COURSE_STRATEGY,
  CONDITIONS,
  EQUIPMENT,
  PRACTICE_DESIGN,
  WARMUP,
  RULES,
  MENTAL_GAME,
  PRO_EXEMPLARS,
  INSTRUCTOR_VIDEO_KNOWLEDGE,
};

/** The full golf-knowledge corpus, concatenated across every module. */
export const GOLF_KNOWLEDGE: KBEntry[] = [
  ...PUTTING,
  ...SETUP,
  ...CONTACT,
  ...FULL_SWING,
  ...SHORT_GAME,
  ...BALL_FLIGHT,
  ...COURSE_MGMT,
  ...PSYCHOLOGY,
  ...FAULT_LIBRARY,
  ...DRILLS,
  ...SHORT_GAME_ADVANCED,
  ...PUTTING_ADVANCED,
  ...COURSE_STRATEGY,
  ...CONDITIONS,
  ...EQUIPMENT,
  ...PRACTICE_DESIGN,
  ...PRACTICE_FOCUSES_KB,
  ...WARMUP,
  ...RULES,
  ...MENTAL_GAME,
  ...PRO_EXEMPLARS,
  ...INSTRUCTOR_VIDEO_KNOWLEDGE,
];
