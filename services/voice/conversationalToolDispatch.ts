/**
 * 2026-07-01 (re-audit — voice H2) — the earbud/badge/watch conversational path
 * (services/listeningSession via conversationalBrain) SPOKE the brain's reply but
 * DROPPED any tool_actions it returned, because the caddie-tab UI dispatcher
 * (caddie.tsx handleToolAction) isn't mounted on that path. So "switch me to Tank"
 * / "open SmartFinder" phrased conversationally got a verbal ack and nothing happened.
 *
 * This dispatches the SERVICE-SAFE subset of tool actions (no component scope needed):
 * switch_caddie (persona) + navigate/navigate_replace (router). UI-coupled actions
 * (record_swing, open_smartvision, log_score, mark_*) still belong to the tab path and
 * are intentionally ignored here.
 */

import { router } from 'expo-router';
import { useSettingsStore } from '../../store/settingsStore';

const PERSONAS = ['kevin', 'serena', 'harry', 'tank'] as const;

export function dispatchConversationalToolActions(actions: unknown[]): void {
  if (!Array.isArray(actions) || actions.length === 0) return;
  for (const raw of actions) {
    const a = raw as { type?: string; personality?: string; path?: string };
    try {
      if (a?.type === 'switch_caddie' && a.personality && (PERSONAS as readonly string[]).includes(a.personality)) {
        // setCaddiePersonality fires its own spoken handoff intro.
        useSettingsStore.getState().setCaddiePersonality(a.personality as (typeof PERSONAS)[number]);
      } else if (a?.type === 'navigate' && typeof a.path === 'string' && a.path.length > 0) {
        router.push(a.path as never);
      } else if (a?.type === 'navigate_replace' && typeof a.path === 'string' && a.path.length > 0) {
        router.replace(a.path as never);
      }
      // Any other tool type is UI-coupled → left to the caddie-tab dispatcher.
    } catch {
      /* best-effort — a bad action never breaks the spoken reply */
    }
  }
}
