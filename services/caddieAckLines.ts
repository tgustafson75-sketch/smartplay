/**
 * 2026-07-26 (deep audit — robotic device-TTS on the happy path) — the caddie's rotating acknowledgement
 * lines ("Got it." …) and the bare "Didn't catch that." notice, in ONE dependency-free place.
 *
 * Single source of truth so the two consumers can't drift:
 *   - services/listeningSession.ts speaks pickAck(lang) + the notice via speakDeviceNotice.
 *   - services/offlineVoiceCache.ts pre-renders the ENGLISH set in the persona's REAL voice (so these
 *     happy-path lines stop playing in the robotic OS voice). English only for now (100% of current
 *     testers); es/zh keep the device-TTS fallback until there are non-English testers.
 *
 * Pure data — NO react-native / expo / store imports — so both a heavy runtime module and a jest test
 * can import it freely. [[feels-like-a-real-caddie]]
 */

export const CADDIE_NOTICE_DIDNT_CATCH = "Didn't catch that.";

export const ACK_PHRASES: Record<'en' | 'es' | 'zh', string[]> = {
  en: ['Okay, got it.', 'Got it.', 'Alright.', 'Sure thing.', 'On it.', 'Copy that.', 'You got it.', 'Let me take a look.', 'Right, one sec.', 'Gotcha.'],
  es: ['Vale, entendido.', 'Entendido.', 'Muy bien.', 'Claro.', 'En ello.', 'Déjame ver.', 'Un momento.'],
  zh: ['好的，明白了。', '明白了。', '好的。', '收到。', '让我看看。', '稍等。'],
};

// 2026-08-08 (Tim — Tozo T6 never hears the 200ms tock earcon; "add our own caddie VERBAL response, not
// canned but logical"). Short spoken cues in the CADDIE'S REAL VOICE, replacing the earcons when a cached
// persona render exists (offlineVoiceCache pre-renders these — same no-drift pattern as ACK_PHRASES).
// "Logical, not canned": context-picked (mid-round vs off-course), rotating never-repeat, persona voice.
// A spoken word (~600ms) also survives the Bluetooth A2DP→mic route handoff that swallows the short tock.
/** Tap-to-listen cue — the caddie says it the moment the mic opens ("I'm listening"). */
export const LISTEN_CUES: { idle: string[]; round: string[] } = {
  idle: ['Go ahead.', "I'm here.", "What's up?", 'Yeah, go ahead.'],
  round: ['Go ahead.', 'Talk to me.', 'What are we looking at?', "I'm with you."],
};
/** Tap-again endpoint cue — the caddie confirms it HEARD you and is working. */
export const GOTIT_CUES: string[] = ['Got it.', 'On it.', 'Okay.', 'Heard you.'];
