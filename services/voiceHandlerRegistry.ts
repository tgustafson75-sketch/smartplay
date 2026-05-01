import type { IntentResult, AppContext } from '../types/voiceIntent';

/**
 * A registered voice action. Each action declares the intent type it lives under,
 * a stable id, the surfaces (screens) it's available on, example phrases for help
 * discovery, a description, and the function that executes it.
 */
export interface VoiceAction {
  /** Globally unique id (e.g. "open_tool.dashboard", "navigate.back"). */
  id: string;
  /** Top-level intent this action lives under (open_tool, query_status, change_setting,
   *  navigate, help, etc.). The intent handler dispatches into the registry by intent_type
   *  and then by the relevant parameter value. */
  intent_type: string;
  /** Parameter key/value this action matches. For open_tool: tool_name. For navigate:
   *  direction. For change_setting: setting_name. Empty string when the action matches
   *  the intent regardless of parameter value (e.g. help). */
  match: { param_key: string; param_value: string };
  /** Surfaces this action is available on. '*' = everywhere; otherwise list of active_screen
   *  values from AppContext. */
  surfaces: string[] | '*';
  /** Example phrases the user might say to trigger this action — feeds help discovery. */
  phrases: string[];
  /** Short description shown in "what can I say". */
  description: string;
  /** Executes the action. Receives raw parameters and the current AppContext. */
  execute: (params: Record<string, unknown>, context: AppContext) => Promise<IntentResult>;
}

class VoiceHandlerRegistry {
  private actions: Map<string, VoiceAction> = new Map();

  /** Register a new voice action. Replaces any existing action with the same id. */
  register(action: VoiceAction): void {
    this.actions.set(action.id, action);
  }

  /** Bulk register. Useful for surface modules that declare a list of actions. */
  registerAll(actions: VoiceAction[]): void {
    for (const a of actions) this.register(a);
  }

  /** Unregister by id. Idempotent. */
  unregister(id: string): void {
    this.actions.delete(id);
  }

  /** All registered actions. */
  list(): VoiceAction[] {
    return Array.from(this.actions.values());
  }

  /** Actions available on the given surface (or globally with '*'). */
  forSurface(surface: string): VoiceAction[] {
    return this.list().filter(a => a.surfaces === '*' || a.surfaces.includes(surface));
  }

  /**
   * Find the action matching the given intent_type + parameter value, restricted
   * to the current surface. Returns null when no registered action matches.
   */
  match(intent_type: string, params: Record<string, unknown>, surface: string): VoiceAction | null {
    const candidates = this.list().filter(a =>
      a.intent_type === intent_type &&
      (a.surfaces === '*' || a.surfaces.includes(surface)),
    );
    for (const a of candidates) {
      const got = String(params[a.match.param_key] ?? '').toLowerCase();
      if (got === a.match.param_value.toLowerCase()) return a;
      if (a.match.param_value === '*' && got !== '') return a;
    }
    return null;
  }
}

export const voiceHandlerRegistry = new VoiceHandlerRegistry();
