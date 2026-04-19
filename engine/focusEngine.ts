/**
 * engine/focusEngine.ts
 *
 * Focus Mode main router.
 *
 * Routes any free-text query to the correct sub-engine based on detected
 * intent. Keeps the Caddie interface unified — the user never leaves the app.
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

export const handleFocusInput = async (
  query: string,
  context: FocusContext,
  /** Inject the app's AI caller so this module stays free of React/fetch boilerplate */
  aiCaller: AICallerFn,
): Promise<string> => {
  if (!query || !query.trim()) return '';

  const intent = detectIntent(query);

  switch (intent) {
    case 'golf':
      return golfEngine(query, context);

    case 'utility':
      return utilityEngine(query, context);

    case 'service':
      return serviceEngine(query, context);

    default:
      return knowledgeEngine(query, context, aiCaller);
  }
};
