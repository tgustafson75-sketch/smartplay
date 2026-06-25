/**
 * Knowledge Base schema — the entry types shared by the APP-FEATURE catalog
 * (services/knowledgeBase/appCatalog.ts) AND the later golf-knowledge modules.
 *
 * This is Increment 1's single source of truth for "what the caddie knows."
 * Two distinct shapes live here:
 *   - KBEntry    — a unit of golf KNOWLEDGE (setup, contact, ball flight, …).
 *                  Authored later; the shape is fixed now so modules slot in.
 *   - AppFeature — a unit of APP capability (a tool / card / drill / screen)
 *                  with its REAL route + aliases so the caddie can name it and
 *                  open it. This is what makes the brain aware that, e.g.,
 *                  Smart Tempo exists and "the tempo drill card" is routable.
 *
 * SHARED client + server: the appCatalog (which imports these types) is read by
 * the app (router) AND by api/ (brain prompts), so both live under services/.
 */

/** The layer of golf knowledge a KBEntry belongs to. app_feature is the catalog. */
export type KBLayer =
  | 'app_feature'
  | 'setup'
  | 'contact'
  | 'full_swing'
  | 'short_game'
  | 'putting'
  | 'ball_flight'
  | 'course_mgmt'
  | 'psychology'
  | 'practice'
  | 'equipment';

/**
 * How HONEST a piece of knowledge / signal is about what the app can actually
 * sense (north-star honesty gate):
 *   - measurable    — the app derives this from real signals (pose/acoustic/GPS).
 *   - directional   — informed guidance, not a precise measurement.
 *   - coaching_only — pure teaching wisdom; no app signal backs it.
 */
export type KBHonesty = 'measurable' | 'directional' | 'coaching_only';

/** A unit of golf knowledge. Authored by the later golf-knowledge modules. */
export interface KBEntry {
  id: string;
  layer: KBLayer;
  module: string;
  topic: string;
  aliases: string[];
  principle: string;
  /** App signals that ground this entry (e.g. 'tempo', 'pose:hip_depth'). */
  appSignals?: string[];
  honesty?: KBHonesty;
  /** CNS keys this should personalize against (e.g. 'dominantMiss', 'bag'). */
  cnsPersonalize?: string[];
  coachingCues?: string[];
  related?: string[];
  source?: string;
}

/**
 * A real app capability the caddie can name and open. The catalog of these is
 * the brain's map of the app. `route` MUST be a real expo-router path.
 */
export interface AppFeature {
  id: string;
  name: string;
  /** Tight spoken aliases for deterministic routing — lowercase, no fluff. */
  aliases: string[];
  /** Real expo-router route (verified against the app/ tree). */
  route: string;
  category: 'analyze' | 'practice' | 'play' | 'prepare' | 'caddie' | 'data';
  /** One short line — what it is. Used in the compact brain prompt. */
  blurb: string;
  /** One short line — when the caddie should point the player at it. */
  whenToUse: string;
}
