/**
 * 2026-07-26 (deep audit — robotic device-TTS on the happy path) — the caddie's rotating acknowledgement
 * lines ("Got it." …) and the bare "Didn't catch that." notice, in ONE dependency-free place.
 *
 * Single source of truth so the two consumers can't drift:
 *   - services/listeningSession.ts speaks pickAck(lang) + the notice via speakDeviceNotice.
 *   - services/offlineVoiceCache.ts pre-renders the ENGLISH set in the persona's REAL voice (so these
 *     happy-path lines stop playing in the robotic OS voice). The ACKS are English only for now (100% of
 *     current testers); es/zh acks stay silent until there are non-English testers. The bare "didn't
 *     catch that" notice and the mic-trouble line are per language, and every language is cached.
 *
 * Pure data — NO react-native / expo / store imports — so both a heavy runtime module and a jest test
 * can import it freely. [[feels-like-a-real-caddie]]
 */

/**
 * 2026-10-31 (CAD-LANG-1) — the bare "didn't catch that" notice, per language. It was one English
 * string for every player, so a Spanish or Chinese player who had the mic open and said nothing
 * (or nothing intelligible) heard English in the caddie's voice. Same shape as the notices below.
 */
export const CADDIE_NOTICE_DIDNT_CATCH: Record<'en' | 'es' | 'zh', string> = {
  en: "Didn't catch that.",
  es: 'No te escuché bien.',
  zh: '没听清。',
};

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
 * 2026-10-25 — a press that reached us while SmartPlay was not the open app (screen locked, or the
 * press itself launched the app in the background). iOS will not start a recording then, so the true
 * thing to say is what will work: open the app. Never "tap me again" — that tap fails the same way.
 */
export const CADDIE_NOTICE_MIC_NEEDS_APP: Record<'en' | 'es' | 'zh', string> = {
  en: 'Open SmartPlay to talk to me — I can\'t use the mic from the background.',
  es: 'Abre SmartPlay para hablar conmigo — no puedo usar el micrófono en segundo plano.',
  zh: '打开 SmartPlay 跟我说话——在后台我用不了麦克风。',
};

/**
 * 2026-10-28 (recheck VOICE-ENG-R2-2) — the player refused SmartPlay the microphone and the OS will
 * not ask again (iOS after one "Don't Allow", Android after "Don't allow again"). No tap can fix that,
 * and no dialog is coming, so the true thing to say is where it gets fixed. Spoken INSTEAD of the
 * go-ahead cue: inviting him to talk into a mic we are not allowed to open is the defect.
 */
export const CADDIE_NOTICE_MIC_OFF: Record<'en' | 'es' | 'zh', string> = {
  en: 'My mic is off for SmartPlay — turn it on in your phone\'s Settings and I\'m all ears.',
  es: 'Mi micrófono está desactivado para SmartPlay — actívalo en los Ajustes del teléfono y te escucho.',
  zh: 'SmartPlay 的麦克风权限已关闭——在手机设置里打开，我就能听到你。',
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
/**
 * 2026-10-31 (Brain recheck r19, BRAIN-B) — the player said a score with a question and the brain did not
 * answer, so the score was not written. Said first, before whatever answer the phone could give: a
 * question answered without the score on the card is the defect.
 */
export const CADDIE_NOTICE_SCORE_NOT_LOGGED: Record<'en' | 'es' | 'zh', string> = {
  en: "I didn't get your score down — say it again.",
  es: 'No anoté tu score — dímelo otra vez.',
  zh: '你的成绩我没记下——请再说一次。',
};
export const CADDIE_NOTICE_ON_US: Record<'en' | 'es' | 'zh', string> = {
  en: 'That one got away from me — say it again?',
  es: 'Esa se me escapó — ¿me lo repites?',
  zh: '这句我没跟上——再说一次好吗？',
};

/**
 * 2026-10-15 — the phone PROVABLY has no internet (services/reachability: no host that is not ours
 * answered). Says what still works rather than "try again", because trying again offline fails again.
 * Only ever chosen on that proof — never on a single failed call.
 */
export const CADDIE_NOTICE_OFFLINE: Record<'en' | 'es' | 'zh', string> = {
  en: "I can't get online right now — your yardages and score still work.",
  es: 'Ahora mismo no tengo conexión — tus distancias y tu tarjeta siguen funcionando.',
  zh: '我现在连不上网——你的码数和记分仍然可用。',
};

/**
 * Review G2 (finding 8, 2026-10-15) — the caddie-tab mic kept the player's words because the phone is
 * PROVEN offline (services/reachability). Said only on that proof: the note is later handed to the brain
 * as "captured with no signal", so saying it — and saving it — after OUR failure was false twice.
 * Lives here so offlineVoiceCache records it in the caddie's own voice: it is, by definition, spoken
 * offline, where a line without a recording is silence.
 */
export const CADDIE_NOTICE_SAVED_OFFLINE: Record<'en' | 'es' | 'zh', string> = {
  en: "I can't get online right now, but I saved what you said. I'll pick it back up once we're connected.",
  es: 'Ahora mismo no tengo conexión, pero guardé lo que dijiste. Lo retomo en cuanto nos conectemos.',
  zh: '我现在连不上网，但我记下了你说的话。连上网后我会接着处理。',
};

/**
 * 2026-10-31 (Brain recheck r22, BRAIN-AR-1) — a score said with a question, on a proven-offline phone, is written to the
 * card right then (services/caddieFailureReply.keepScoreIfProvenOffline). The score is on the card; nothing is promised later.
 */
export const CADDIE_NOTICE_SCORE_ON_CARD_OFFLINE: Record<'en' | 'es' | 'zh', string> = {
  en: "I can't get online right now, but your score is on the card.",
  es: 'Ahora mismo no tengo conexión, pero tu score ya está en la tarjeta.',
  zh: '我现在连不上网，但你的成绩已经记在计分卡上了。',
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

/**
 * 2026-10-31 (caddie-voice-3) — the earbud opener and got-it cue, per language. These were English
 * whatever the player's language, so an es or zh player heard the caddie open and close in English on
 * every tap. Each set is pre-rendered by offlineVoiceCache in the caddie's voice, so the cached clip
 * matches the player's language. English stays on the dialog templates and GOTIT_CUES above.
 */
export const GOTIT_CUES_BY_LANG: Record<'en' | 'es' | 'zh', string[]> = {
  en: GOTIT_CUES,
  es: ['Entendido.', 'Vale.', 'Hecho.', 'Te escucho.'],
  zh: ['明白了。', '好的。', '收到。', '我听到了。'],
};
/** The trust level 1 opener in each language (see TRUST_L1_OPENER). */
export const TRUST_L1_OPENER_BY_LANG: Record<'en' | 'es' | 'zh', string> = {
  en: TRUST_L1_OPENER,
  es: 'Dime.',
  zh: '嗯？',
};
export type EarbudOpenerRole = 'caddie' | 'coach' | 'psychologist';
/** The role's earbud_open lines in es and zh (English comes from constants/dialogTemplates). */
export const EARBUD_OPEN_BY_LANG: Record<'es' | 'zh', Record<EarbudOpenerRole, string[]>> = {
  es: {
    caddie: ['¿Qué estás viendo?', '¿Qué estás pensando?', '¿Cuál es la jugada?', 'Háblame.', '¿Qué tienes en mente?'],
    coach: ['¿En qué estás trabajando?', '¿Cuál es el foco?', '¿Qué quieres afinar?'],
    psychologist: ['¿Qué tal?', '¿Cómo vas?', '¿Sí?', '¿Qué te preocupa?', '¿Qué estás enfrentando?'],
  },
  zh: {
    caddie: ['你看到了什么？', '你在想什么？', '这一杆怎么打？', '跟我说说。', '你心里有什么？'],
    coach: ['你在练什么？', '这次的重点是什么？', '你想调整哪里？'],
    psychologist: ['怎么样？', '最近怎么样？', '嗯？', '你在应对什么？', '有什么想聊的？'],
  },
};
