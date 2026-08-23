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

/**
 * 2026-08-17 (Tim — "I'm here." then instantly "I didn't catch that.") — the line for when the
 * MICROPHONE failed, not the listening.
 *
 * "Didn't catch that." was spoken for a mic that was busy and never opened at all. That tells the
 * user to repeat themselves, which cannot work, and hides a real defect behind their voice. When
 * the caddie couldn't hold the mic, it says so and owns it. Kept short and in the same
 * dependency-free source as the acks so offlineVoiceCache pre-renders it in the persona's REAL
 * voice — an honest line delivered by the robot voice is still a robotic moment.
 * [[feels-like-a-real-caddie]]
 */
export const CADDIE_NOTICE_MIC_TROUBLE: Record<'en' | 'es' | 'zh', string> = {
  en: "That's on me — my mic didn't open. Tap me again.",
  es: 'Es culpa mía — no se abrió el micrófono. Tócame otra vez.',
  zh: '是我的问题——麦克风没有打开。再点我一次。',
};

/**
 * 2026-08-17 — the lines for when the CONNECTION failed, shared by every path that can hit it.
 *
 * These lived privately inside listeningSession while useVoiceCaddie's aborted-transcribe branch
 * spoke "Didn't catch that — say it again?" under a comment claiming to be "honest about signal".
 * An aborted /api/transcribe means the mic worked and the network didn't; telling the player we
 * didn't hear them sends them to repeat a sentence we already have. Same failure, same words, both
 * paths. [[no-half-fixes-enforce-every-surface]]
 *
 * ON_US is the variant for when the connection is PROVABLY fine (our host answered seconds ago) —
 * blaming a good signal is the thing Tim caught on 5G, so a failure we can't pin on the network is
 * owned instead.
 */
export const CADDIE_NOTICE_CONNECTION: Record<'en' | 'es' | 'zh', string> = {
  en: "I'm having trouble connecting — try that again.",
  es: 'Tengo problemas para conectarme — inténtalo de nuevo.',
  zh: '我连接遇到问题——请再试一次。',
};
export const CADDIE_NOTICE_ON_US: Record<'en' | 'es' | 'zh', string> = {
  en: 'That one got away from me — say it again?',
  es: 'Esa se me escapó — ¿me lo repites?',
  zh: '这句我没跟上——再说一次好吗？',
};

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
/**
 * 2026-08-23 — trust level 1 opener. At L1 the caddie has not earned conversation yet, so an earbud
 * tap gets an acknowledgement rather than an invitation to talk. Lives here with the other SPOKEN
 * lines so services/offlineVoiceCache pre-renders it in the persona's voice — a line the cache does
 * not know resolves to no clip and falls through to an earcon, which is the caddie replaced by a beep.
 */
export const TRUST_L1_OPENER = 'Yeah?';

export const GOTIT_CUES: string[] = ['Got it.', 'On it.', 'Okay.', 'Heard you.'];
