/**
 * engine/focusEngine.ts
 *
 * Focus Mode main router.
 *
 * Routes any free-text query to the correct sub-engine based on detected
 * intent. Keeps the Caddie interface unified — the user never leaves the app.
 *
 * Hardened for on-course use:
 *  • fallbackResponse — always returns something useful, even offline.
 *  • withTimeout — prevents any async call from hanging the UI.
 *  • All routes wrapped in try/catch — engine errors never surface to the user.
 *
 * Usage (Play screen):
 *   const response = await handleFocusInput(userInput, context, callOpenAI);
 *   setCaddieMessage(response);
 */

import { detectIntent }    from './intentDetector';
import { golfEngine }      from './golfEngine';
import { utilityEngine }   from './utilityEngine';
import { serviceEngine }   from './serviceEngine';
import { knowledgeEngine, type AICallerFn } from './knowledgeEngine';
import type { FocusContext } from './contextBuilder';

// ── Offline-first fallback ───────────────────────────────────────────────────

/**
 * Returns a useful caddie response when all engines fail or time out.
 * Never returns an empty string — the player always gets something actionable.
 */
export const fallbackResponse = (context: FocusContext | null): string => {
  const dist = context?.distance;
  if (dist) {
    return `${dist} in. Play it simple — take one more club and trust your swing.`;
  }
  return "You're in a good spot — stay committed and trust your game.";
};

// ── Timeout wrapper ──────────────────────────────────────────────────────────

/**
 * Races a promise against a timeout. If the promise doesn't resolve within
 * `ms` milliseconds the timeout wins and the promise result is discarded.
 */
const withTimeout = <T>(promise: Promise<T>, ms = 3000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);

// ── Main router ──────────────────────────────────────────────────────────────

export const handleFocusInput = async (
  query: string,
  context: FocusContext,
  /** Inject the app's AI caller so this module stays free of React/fetch boilerplate */
  aiCaller: AICallerFn,
): Promise<string> => {
  if (!query || !query.trim()) return '';

  let intent: string;
  try {
    intent = detectIntent(query);
  } catch {
    intent = 'knowledge';
  }

  try {
    switch (intent) {
      case 'golf':
        return golfEngine(query, context);

      case 'utility':
        return utilityEngine(query, context);

      case 'service':
        return serviceEngine(query, context);

      default:
        return await withTimeout(knowledgeEngine(query, context, aiCaller), 3000);
    }
  } catch {
    return fallbackResponse(context);
  }
};
