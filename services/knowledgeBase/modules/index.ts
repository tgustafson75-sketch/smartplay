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

export {
  PUTTING,
  SETUP,
  CONTACT,
  FULL_SWING,
  SHORT_GAME,
  BALL_FLIGHT,
  COURSE_MGMT,
  PSYCHOLOGY,
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
];
