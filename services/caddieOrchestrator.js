/**
 * caddieOrchestrator.js
 *
 * Controls WHEN and WHY the caddie speaks.
 * Single source of truth for all voice output — prevents stacking, repetition,
 * and robotic timing.
 *
 * Rules enforced here:
 *   - Only one voice event at a time (isSpeaking gate)
 *   - Minimum 2-shot gap before repeating the same advice text
 *   - 150ms natural pre-speech pause
 *   - Silent > bad advice (falsy returns from getCaddieAdvice are swallowed)
 */

let isSpeaking = false;

/** Last advice string spoken — guards against back-to-back repeats */
let _lastAdvice = '';
/** Shot count when _lastAdvice was spoken */
let _lastAdviceShotCount = -1;

/**
 * runCaddie(options)
 *
 * @param {{
 *   type: 'pre'|'post'|'pattern'|'manual',
 *   context: object,
 *   speak: Function,
 *   getCaddieAdvice: Function
 * }} options
 */
export const runCaddie = async ({ type, context, speak, getCaddieAdvice }) => {
  if (isSpeaking) return;

  try {
    isSpeaking = true;

    const advice = getCaddieAdvice(context);

    if (!advice || !advice.trim()) {
      isSpeaking = false;
      return;
    }

    // Don't repeat the exact same line within 2 shots
    const shotCount = context?.shotCount ?? 0;
    if (
      advice === _lastAdvice &&
      shotCount - _lastAdviceShotCount < 2
    ) {
      isSpeaking = false;
      return;
    }

    // Natural pre-speech pause (avoids robotic instant response)
    await new Promise((r) => setTimeout(r, 175));

    await speak(advice);

    _lastAdvice = advice;
    _lastAdviceShotCount = shotCount;
  } catch (e) {
    console.log('[CaddieOrchestrator] error:', e?.message ?? e);
  } finally {
    isSpeaking = false;
  }
};

/** Returns true if the caddie is currently speaking — useful to guard UI elements */
export const isCaddieSpeaking = () => isSpeaking;

/** Force-reset the speaking flag (e.g. after Audio unload) */
export const resetCaddieState = () => {
  isSpeaking = false;
  _lastAdvice = '';
  _lastAdviceShotCount = -1;
};
