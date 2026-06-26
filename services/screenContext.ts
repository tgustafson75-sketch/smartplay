/**
 * EPHEMERAL "where the player is right now" context for the caddie brain.
 *
 * Why this exists (Tim, 2026-06-26): "if I open the tempo drill, tempo is
 * obviously what we're working on" — but nothing told the brain which screen the
 * player was on, so a question asked from inside a drill got a generic answer.
 * Screens register on focus and clear on blur; the voice paths read it when they
 * build the /api/kevin request so the caddie answers with the CURRENT drill in
 * mind. NOT persisted — purely the live foreground context (clears on blur).
 *
 * Pure module, no React / no fetch, so both the hook paths and services can read
 * it without import cycles.
 */

export type ScreenContext = {
  /** Human label, e.g. "the Smart Tempo drill". */
  screen: string;
  /** What it trains, e.g. "backswing-to-downswing tempo toward the 3:1 ratio". */
  focus?: string;
  /** Drill id when on a specific drill (data/drillCatalog id), else undefined. */
  drillId?: string;
} | null;

let current: ScreenContext = null;

export function setScreenContext(ctx: ScreenContext): void {
  current = ctx;
}

/**
 * Clear the context. Pass the screen label you set so a LATE blur from a screen
 * the player already left can't wipe the context the next screen just set.
 */
export function clearScreenContext(forScreen?: string): void {
  if (!forScreen || (current && current.screen === forScreen)) current = null;
}

export function getScreenContext(): ScreenContext {
  return current;
}

/** Compact line for the brain system prompt. Null when nothing is active. */
export function screenContextForPrompt(): string | null {
  if (!current) return null;
  const focus = current.focus ? ` (working on ${current.focus})` : '';
  return (
    `CURRENT SCREEN: The player is on ${current.screen}${focus}. ` +
    `If they ask a question or speak while here, assume it's about THIS unless they clearly change the subject. ` +
    `Shape any coaching to this focus and don't introduce an unrelated swing thought.`
  );
}
