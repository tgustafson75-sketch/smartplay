/**
 * engine/knowledgeEngine.ts
 *
 * Handles general knowledge questions via the existing AI service.
 * Adds a golf bridge only when it flows naturally — never forces it.
 * Falls back to a local response if the AI call fails or returns nothing.
 */

import type { FocusContext } from './contextBuilder';
import { formatKnowledgeAnswer } from './responseFormatter';

// aiCaller is injected at runtime by the Play screen so this module stays
// free of React and Zustand imports.
export type AICallerFn = (prompt: string) => Promise<string | null>;

/** Words that suggest a natural golf bridge makes sense */
const BRIDGE_TRIGGERS: Array<{ tokens: string[]; bridge: (ctx: FocusContext) => string }> = [
  {
    tokens: ['wind', 'air', 'atmosphere', 'pressure'],
    bridge: () => 'That can definitely affect ball flight out here.',
  },
  {
    tokens: ['distance', 'far', 'length', 'measure'],
    bridge: (ctx) =>
      ctx.distance
        ? `For reference, you're about ${ctx.distance} yards out right now.`
        : '',
  },
  {
    tokens: ['physics', 'spin', 'force', 'trajectory'],
    bridge: () => 'Those same principles show up in ball flight.',
  },
  {
    tokens: ['history', 'president', 'famous', 'legend'],
    bridge: () => 'Golf has a long history tied into that era too.',
  },
];

const generateGolfBridge = (query: string, context: FocusContext): string => {
  const q = query.toLowerCase();
  for (const trigger of BRIDGE_TRIGGERS) {
    if (trigger.tokens.some((t) => q.includes(t))) {
      const bridge = trigger.bridge(context);
      if (bridge) return bridge;
    }
  }
  return '';
};

const fallbackKnowledge = (context: FocusContext): string => {
  if (context.distance) {
    return `Not totally sure, but you're ${context.distance} yards out with a clean look.`;
  }
  return "Not totally sure on that one — but we're in a good spot here.";
};

/** Race the AI call against a 3 s timeout — never hang the caddie UI. */
const withTimeout = <T>(promise: Promise<T>, ms = 3000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('knowledge timeout')), ms),
    ),
  ]);

export const knowledgeEngine = async (
  query: string,
  context: FocusContext,
  aiCaller: AICallerFn,
): Promise<string> => {
  try {
    const answer = await withTimeout(aiCaller(query));

    if (!answer) return fallbackKnowledge(context);

    const bridge = generateGolfBridge(query, context);
    return formatKnowledgeAnswer(answer, bridge || null);
  } catch {
    return fallbackKnowledge(context);
  }
};
