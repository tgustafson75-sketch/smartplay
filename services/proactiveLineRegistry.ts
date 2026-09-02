/**
 * 2026-09-01 (adversarial audit) — HOW A STORE ASKS THE CADDIE FOR A SENTENCE WITHOUT IMPORTING IT.
 *
 * Making the persona switch compose its own intro put a brain call inside settingsStore, and that
 * closes a loop: the brain reads stores to build its context, so store -> brain -> store. It was
 * runtime-safe (a lazy require inside an async handler, and nothing in the brain reads state at
 * module scope) and the bundle was fine — but the edge should not exist, and moving the import to a
 * lazy one did NOT remove it: the cycle simply took the longer path through caddieRequestBody.
 *
 * So the dependency is INVERTED instead. This module imports nothing. The app layer — which already
 * owns the brain — registers a composer at boot; the store calls whatever is registered, or nothing.
 * A store asks for a line; it does not know what answers.
 */

/** Returns the composed line, or null to fall back to whatever the caller had. */
export type ProactiveLineComposer = (
  directive: string,
  opts?: { timeoutMs?: number },
) => Promise<string | null>;

let composer: ProactiveLineComposer | null = null;

/** Called once at boot by the app layer. */
export function setProactiveLineComposer(fn: ProactiveLineComposer | null): void {
  composer = fn;
}

/**
 * Ask for a composed line. Never throws and never hangs the caller on a missing registration —
 * an unregistered composer is the normal state during early boot, and the answer there is "no line",
 * not an error.
 */
export async function composeProactiveLine(
  directive: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  if (!composer) return null;
  try {
    return await composer(directive, opts);
  } catch {
    return null;
  }
}
