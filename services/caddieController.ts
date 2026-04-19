import { speak } from "./voiceService";

// ─── Global caddie gate ────────────────────────────────────────────────────
// Prevents overlap, spam, and duplicate phrases.
let _lastSpeakTime = 0;
let _lastMessage = "";
const COOLDOWN_MS = 2500;

function _canSpeak(text: string): boolean {
  if (Date.now() - _lastSpeakTime < COOLDOWN_MS) return false;
  if (text === _lastMessage) return false;
  return true;
}

/**
 * triggerCaddie — gated, delayed entry point for all caddie voice.
 * Use this instead of calling speakWithCaddie directly.
 *
 *   triggerCaddie("Take dead aim.", { setState });
 *
 * Rules: 2500ms cooldown, deduplication, 400ms natural delay.
 */
export function triggerCaddie(
  text: string,
  { setState }: { setState: (s: string) => void }
): void {
  if (!_canSpeak(text)) return;
  _lastSpeakTime = Date.now();
  _lastMessage = text;
  setTimeout(() => void speakWithCaddie(text, { setState }), 400);
}

// ─── Core voice (not modified) ────────────────────────────────────────────
export async function speakWithCaddie(
  text: string,
  { setState }: { setState: (s: string) => void }
) {
  try {
    setState("speaking");

    // small delay before speech (natural feel)
    await new Promise((res) => setTimeout(res, 300));

    await speak(text); // EXISTING FUNCTION — NOT MODIFIED
  } catch (e) {
    console.log("Voice error", e);
  } finally {
    // slight delay after speech ends before returning to idle
    setTimeout(() => setState("idle"), 800);
  }
}
