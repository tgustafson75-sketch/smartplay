/**
 * 2026-06-06 — Phase 3 of on-course resilience sprint.
 *
 * When /api/kevin (the brain) fails — typically poor cellular at the
 * course — useVoiceCaddie.sendToBrain's catch block currently returns
 * a hardcoded "Hit a snag on my end. Try again." Tim's Echo Hills round
 * hit this 28 times. This responder catches the most common in-round
 * status queries locally so dead cellular doesn't kill the round.
 *
 * Contract:
 *   tryLocalReply(transcript, language) → { text, queryType } | null
 *
 *   - null  → no pattern matched. Caller falls through to its existing
 *             "Hit a snag" text — appropriate for coaching/strategy
 *             questions the brain genuinely needs.
 *   - text  → templated reply built from local round state. Caller
 *             returns it as if /api/kevin had replied. speak() runs
 *             via /api/voice (Phase 1's device-TTS fallback was
 *             reverted — see phase1-device-tts-crash memory).
 *
 * Combined with Phase 2's prefetch: "What's my yardage?" produces a
 * local templated reply that gets spoken via /api/voice when network
 * is reachable; offline = silent reply but the caption + visual UI
 * still surface the answer.
 *
 * Honest about GPS confidence. When accuracy_m > 15 (weak fix), the
 * reply says "roughly 118, GPS is iffy right now" instead of stating
 * a number with false precision. When there's no fix at all, says so
 * cleanly.
 *
 * EN / ES / ZH localization mirrors queryStatusHandler's TTS_STRINGS
 * shape so on-course voice replies share the same multilingual model
 * the open-mic intent path already established.
 */

import { useRoundStore } from '../store/roundStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useConversationLog } from '../store/conversationLogStore';
import { getLastFix } from './gpsManager';
import { haversineYards, bearingDegrees } from '../utils/geoDistance';
import { resolveGreenCoords, classifyAccuracy } from './smartFinderService';
// 2026-06-12 — Offline caddie Tier 1: the player's REAL logged bag distances, used to
// CALL A CLUB locally when the cloud brain is unreachable. Honest by construction —
// bagDistances() only returns clubs the player has actually tracked. [[offline-caddie-plan]]
import { bagDistances } from './shotStrategy';
// 2026-06-13 — Offline caddie: the MOAT read (club + plays-like + why) composed
// locally so "how far does it play / plays like" works with NO network. composeShotRead
// is pure/offline-safe; cached weather feeds the wind factor. [[smartfinder-unified-brain-read]]
import { composeShotRead } from './cnsShotRead';
import { getCachedWeatherEvenIfStale } from './weatherService';
import { playsLikeDistance } from '../utils/playsLike';

export type LocalReplyLanguage = 'en' | 'es' | 'zh';

export type LocalReplyResult = {
  text: string;
  queryType:
    | 'yardage_middle'
    | 'yardage_front'
    | 'yardage_back'
    | 'hole_current'
    | 'par_current'
    | 'score_round'
    | 'holes_left'
    | 'tee_box'
    | 'course_name'
    | 'club_current'
    | 'club_recommend'
    | 'plays_like'
    | 'wind'
    | 'reach'
    | 'last_shot'
    | 'handicap'
    | 'course_memory'
    | 'routine_saved'
    | 'routine_recall'
    | 'no_round';
};

// ────────────────────────────────────────────────────────────────────
// Localized string templates. Mirrors services/intents/queryStatusHandler.ts
// TTS_STRINGS shape so on-course voice stays consistent across the
// intent-router path and this catch-fallback path.
// ────────────────────────────────────────────────────────────────────

const L: Record<LocalReplyLanguage, {
  yardageMiddle: (y: number) => string;
  yardageFront: (y: number) => string;
  yardageBack: (y: number) => string;
  yardageIffy: (y: number) => string;
  noFix: string;
  noGreen: string;
  holeIs: (h: number) => string;
  parIs: (p: number) => string;
  scoreEven: (h: number) => string;
  scoreOver: (delta: number, h: number) => string;
  scoreUnder: (delta: number, h: number) => string;
  scoreNoneYet: string;
  holesLeft: (n: number) => string;
  teeIs: (t: string) => string;
  courseIs: (c: string) => string;
  clubIs: (c: string) => string;
  noClub: string;
  // Offline caddie Tier 1 — club call + last shot.
  clubCall: (dist: number, club: string, carry: number) => string;
  clubCallMore: (dist: number, club: string, carry: number) => string;
  clubCallEasy: (dist: number, club: string, carry: number) => string;
  clubBeyond: (dist: number, club: string, carry: number) => string;
  noBag: string;
  clubIffy: string;
  playsLike: (raw: number, plays: number, club: string | null, why: string) => string;
  windCalm: (mph: number) => string;
  windRelative: (mph: number, desc: string) => string;
  windPlain: (mph: number) => string;
  windInto: string; windHelp: string; windL2R: string; windR2L: string;
  noWind: string;
  reachYes: (plays: number, club: string, carry: number) => string;
  reachTight: (plays: number, club: string, carry: number) => string;
  reachNo: (plays: number, club: string, carry: number) => string;
  lastShot: (club: string | null, dist: number | null, dir: 'left' | 'right' | 'straight' | null) => string;
  noLastShot: string;
  handicapIs: (h: number) => string;
  routineSaved: string;
  routineNothingToSave: string;
  routineNone: string;
  noRound: string;
}> = {
  en: {
    yardageMiddle: (y) => `${y} yards to the middle of the green.`,
    yardageFront: (y) => `${y} yards to the front.`,
    yardageBack: (y) => `${y} yards to the back.`,
    yardageIffy: (y) => `Roughly ${y}, but my GPS is iffy right now.`,
    noFix: 'No GPS lock yet — give it a few seconds and try again.',
    noGreen: "I don't have the green location for this hole. Try Mark Tee next time you pass.",
    holeIs: (h) => `You're on hole ${h}.`,
    parIs: (p) => `Par ${p}.`,
    scoreEven: (h) => `Even par through ${h} ${h === 1 ? 'hole' : 'holes'}.`,
    scoreOver: (d, h) => `Plus ${d} through ${h} ${h === 1 ? 'hole' : 'holes'}.`,
    scoreUnder: (d, h) => `${d} under through ${h} ${h === 1 ? 'hole' : 'holes'}.`,
    scoreNoneYet: 'No scored holes yet.',
    holesLeft: (n) => `${n} ${n === 1 ? 'hole' : 'holes'} to play.`,
    teeIs: (t) => `Playing the ${t} tees.`,
    courseIs: (c) => `You're at ${c}.`,
    clubIs: (c) => `${c} in your hand.`,
    noClub: 'No club set yet.',
    clubCall: (d, c, y) => `${d} to the middle — that's your ${c}, you carry it ${y}.`,
    clubCallMore: (d, c, y) => `${d} to the middle — ${c} is the club (${y}), give it a touch extra.`,
    clubCallEasy: (d, c, y) => `${d} to the middle — smooth ${c}, you carry it ${y}.`,
    clubBeyond: (d, c, y) => `${d} to the middle — that's past your ${c} (${y}). Lay up and leave a wedge.`,
    noBag: "I don't have your real club distances yet — track a few shots and I'll call the club.",
    clubIffy: ' GPS is iffy right now, so treat that loosely.',
    playsLike: (raw, plays, club, why) => {
      const head = plays === raw ? `${raw} to the middle, plays straight` : `${raw} to the middle, plays like ${plays}`;
      const reason = why ? ` — ${why}` : '';
      const clubLine = club ? ` That's your ${club}.` : '';
      return `${head}${reason}.${clubLine}`;
    },
    windCalm: (mph) => mph <= 1 ? 'Dead calm right now.' : `Pretty calm — ${mph} mile an hour.`,
    windRelative: (mph, desc) => `${mph} miles an hour, ${desc}.`,
    windPlain: (mph) => `${mph} miles an hour.`,
    windInto: 'into your face', windHelp: 'at your back',
    windL2R: 'a left-to-right cross', windR2L: 'a right-to-left cross',
    noWind: "I don't have a wind reading right now.",
    reachYes: (p) => `${p} to play — yes, you've got plenty of club.`,
    reachTight: (p, c, y) => `${p} to play — that's all of your ${c} (${y}). Flush it or take the safe miss short.`,
    reachNo: (p, c, y) => `${p} to play — that's past your ${c} (${y}). Lay up and leave a number.`,
    lastShot: (c, d, dir) => {
      const where = dir === 'left' ? ' pulled left' : dir === 'right' ? ' out to the right' : dir === 'straight' ? ' dead straight' : '';
      if (c && d != null) return `Your last one was a ${c}, ${d} yards${where}.`;
      if (c) return `Your last one was a ${c}${where}.`;
      if (d != null) return `Last shot went ${d} yards${where} — no club logged.`;
      return where ? `Last shot${where} — I don't have the club or distance logged.` : "I have your last shot logged but no club or distance on it.";
    },
    noLastShot: "You haven't logged a shot yet this round.",
    handicapIs: (h) => `Your handicap is ${h}.`,
    routineSaved: "Saved — that's your pre-round routine now. Ask for it any time.",
    routineNothingToSave: "I don't have a routine to save yet — ask me for a pre-round stretch first, then say save it.",
    routineNone: "You haven't saved a pre-round routine yet. Ask me for a stretch, then say 'save that as my routine.'",
    noRound: 'No active round.',
  },
  es: {
    yardageMiddle: (y) => `${y} yardas al centro del green.`,
    yardageFront: (y) => `${y} yardas a la parte de adelante.`,
    yardageBack: (y) => `${y} yardas al fondo.`,
    yardageIffy: (y) => `Más o menos ${y}, pero el GPS no está fino ahora.`,
    noFix: 'Aún no tengo señal GPS — espera unos segundos e intenta otra vez.',
    noGreen: 'No tengo la ubicación del green para este hoyo. Marca el tee la próxima vez que pases.',
    holeIs: (h) => `Estás en el hoyo ${h}.`,
    parIs: (p) => `Par ${p}.`,
    scoreEven: (h) => `Par neto después de ${h} ${h === 1 ? 'hoyo' : 'hoyos'}.`,
    scoreOver: (d, h) => `Plus ${d} después de ${h} ${h === 1 ? 'hoyo' : 'hoyos'}.`,
    scoreUnder: (d, h) => `${d} bajo par después de ${h} ${h === 1 ? 'hoyo' : 'hoyos'}.`,
    scoreNoneYet: 'Aún no has anotado hoyos.',
    holesLeft: (n) => `${n} ${n === 1 ? 'hoyo' : 'hoyos'} por jugar.`,
    teeIs: (t) => `Jugando desde los tees ${t}.`,
    courseIs: (c) => `Estás en ${c}.`,
    clubIs: (c) => `Tienes el ${c}.`,
    noClub: 'Aún no has elegido palo.',
    clubCall: (d, c, y) => `${d} al centro — ese es tu ${c}, lo llevas ${y}.`,
    clubCallMore: (d, c, y) => `${d} al centro — el ${c} es el palo (${y}), pégale un poco más.`,
    clubCallEasy: (d, c, y) => `${d} al centro — ${c} suave, lo llevas ${y}.`,
    clubBeyond: (d, c, y) => `${d} al centro — pasa de tu ${c} (${y}). Pon en juego y deja un wedge.`,
    noBag: 'Aún no tengo tus distancias reales — registra unos tiros y te canto el palo.',
    clubIffy: ' El GPS no está fino ahora, así que tómalo a la ligera.',
    playsLike: (raw, plays, club) => {
      const head = plays === raw ? `${raw} al centro, juega derecho` : `${raw} al centro, juega como ${plays}`;
      const clubLine = club ? ` Es tu ${club}.` : '';
      return `${head}.${clubLine}`;
    },
    windCalm: (mph) => mph <= 1 ? 'Sin viento ahora mismo.' : `Bastante calmo — ${mph} millas por hora.`,
    windRelative: (mph, desc) => `${mph} millas por hora, ${desc}.`,
    windPlain: (mph) => `${mph} millas por hora.`,
    windInto: 'de frente', windHelp: 'a favor',
    windL2R: 'cruzado de izquierda a derecha', windR2L: 'cruzado de derecha a izquierda',
    noWind: 'No tengo lectura de viento ahora mismo.',
    reachYes: (p) => `${p} para jugar — sí, te sobra palo.`,
    reachTight: (p, c, y) => `${p} para jugar — es todo tu ${c} (${y}). Pégale bien o tira corto seguro.`,
    reachNo: (p, c, y) => `${p} para jugar — pasa tu ${c} (${y}). Tira corto y deja número.`,
    lastShot: (c, d, dir) => {
      const where = dir === 'left' ? ' a la izquierda' : dir === 'right' ? ' a la derecha' : dir === 'straight' ? ' recto' : '';
      if (c && d != null) return `Tu último fue un ${c}, ${d} yardas${where}.`;
      if (c) return `Tu último fue un ${c}${where}.`;
      if (d != null) return `El último fue ${d} yardas${where} — sin palo registrado.`;
      return where ? `Último tiro${where} — sin palo ni distancia.` : 'Tengo tu último tiro pero sin palo ni distancia.';
    },
    noLastShot: 'Aún no has registrado un tiro en esta ronda.',
    handicapIs: (h) => `Tu handicap es ${h}.`,
    routineSaved: 'Guardado — esa es tu rutina previa. Pídemela cuando quieras.',
    routineNothingToSave: 'Aún no tengo una rutina para guardar — pídeme un estiramiento primero y luego di que lo guarde.',
    routineNone: 'Todavía no has guardado una rutina previa. Pídeme un estiramiento y di "guarda eso como mi rutina".',
    noRound: 'No hay ronda activa.',
  },
  zh: {
    yardageMiddle: (y) => `到果岭中心${y}码。`,
    yardageFront: (y) => `到前缘${y}码。`,
    yardageBack: (y) => `到后缘${y}码。`,
    yardageIffy: (y) => `大约${y}码，但GPS信号不稳。`,
    noFix: '还没有GPS信号——等几秒再试一次。',
    noGreen: '这洞的果岭位置我还没有数据。下次经过时可以标记一下。',
    holeIs: (h) => `你在第${h}洞。`,
    parIs: (p) => `标准杆${p}杆。`,
    scoreEven: (h) => `打了${h}洞，平标准杆。`,
    scoreOver: (d, h) => `打了${h}洞，超${d}杆。`,
    scoreUnder: (d, h) => `打了${h}洞，低${d}杆。`,
    scoreNoneYet: '还没有记录任何洞的成绩。',
    holesLeft: (n) => `还剩${n}洞。`,
    teeIs: (t) => `从${t}发球台开球。`,
    courseIs: (c) => `你在${c}。`,
    clubIs: (c) => `手里是${c}。`,
    noClub: '还没有选球杆。',
    clubCall: (d, c, y) => `到中心${d}码——用你的${c}，你能打${y}码。`,
    clubCallMore: (d, c, y) => `到中心${d}码——${c}是合适的杆（${y}码），稍微多打一点。`,
    clubCallEasy: (d, c, y) => `到中心${d}码——轻松一杆${c}，你能打${y}码。`,
    clubBeyond: (d, c, y) => `到中心${d}码——超过你最远的${c}（${y}码）。先稳一杆，留个劈起距离。`,
    noBag: '我还没有你真实的球杆距离——记录几杆我就能帮你选杆。',
    clubIffy: '现在GPS信号不稳，这个数字仅供参考。',
    playsLike: (raw, plays, club) => {
      const head = plays === raw ? `到中央${raw}码，实际就打${raw}码` : `到中央${raw}码，实际打约${plays}码`;
      const clubLine = club ? ` 用你的${club}。` : '';
      return `${head}。${clubLine}`;
    },
    windCalm: (mph) => mph <= 1 ? '现在几乎无风。' : `比较平静——每小时${mph}英里。`,
    windRelative: (mph, desc) => `每小时${mph}英里，${desc}。`,
    windPlain: (mph) => `每小时${mph}英里。`,
    windInto: '迎风', windHelp: '顺风',
    windL2R: '从左到右的侧风', windR2L: '从右到左的侧风',
    noWind: '现在没有风力读数。',
    reachYes: (p) => `还有${p}码——可以，球杆足够。`,
    reachTight: (p, c, y) => `还有${p}码——刚好是你的${c}（${y}码）。打实，或者稳妥地打短。`,
    reachNo: (p, c, y) => `还有${p}码——超过你的${c}（${y}码）。先打短，留个好距离。`,
    lastShot: (c, d, dir) => {
      const where = dir === 'left' ? '偏左' : dir === 'right' ? '偏右' : dir === 'straight' ? '很直' : '';
      if (c && d != null) return `你上一杆是${c}，${d}码${where}。`;
      if (c) return `你上一杆是${c}${where}。`;
      if (d != null) return `上一杆${d}码${where}——没有记录球杆。`;
      return where ? `上一杆${where}——没有球杆和距离记录。` : '有你上一杆的记录，但没有球杆和距离。';
    },
    noLastShot: '这回合你还没有记录任何一杆。',
    handicapIs: (h) => `你的差点是${h}。`,
    routineSaved: '已保存——这就是你的赛前热身routine。随时可以问我。',
    routineNothingToSave: '我还没有可保存的routine——先让我给你一个赛前拉伸，然后说保存。',
    routineNone: '你还没有保存赛前routine。先让我给你一个拉伸，然后说"把它保存为我的routine"。',
    noRound: '没有进行中的回合。',
  },
};

// ────────────────────────────────────────────────────────────────────
// Pattern matchers. Kept tight to avoid false positives. Each is
// case-insensitive substring/regex on a normalized transcript.
// ────────────────────────────────────────────────────────────────────

const RX = {
  yardage:    /\b(yardage|yards?\s+to|how\s+far|distance\s+to|how\s+many\s+yards?)\b/i,
  yardageFront: /\b(front\s+edge|to\s+the\s+front|yards?\s+to\s+(?:the\s+)?front)\b/i,
  yardageBack:  /\b(back\s+edge|to\s+the\s+back|yards?\s+to\s+(?:the\s+)?back)\b/i,
  hole:       /\b(what\s+hole|hole\s+am\s+i\s+on|which\s+hole|what\s+hole\s+is\s+this)\b/i,
  par:        /\b(what(?:'s|s)?\s+par|par\s+(?:here|of\s+this\s+hole|on\s+this))\b/i,
  // 'my score' is the query form. 'score me' is the LOG-action form
  // (handled by logScoreHandler in the open-mic intent path); we don't
  // match it here. Same for 'score it for me'.
  score:      /\b(my\s+score|what(?:'s|s)?\s+my\s+score|how\s+am\s+i\s+doing|vs\.?\s+par|under\s+par|over\s+par)\b/i,
  holesLeft:  /\b(holes?\s+left|holes?\s+remaining|how\s+many\s+(?:more|holes?)\s+(?:to\s+go|left)|holes?\s+to\s+go)\b/i,
  tee:        /\b(what\s+tee|which\s+tee|tee\s+box|what\s+tees?\s+(?:am\s+i|i'm)\s+playing)\b/i,
  course:     /\b(what\s+course|which\s+course|where\s+am\s+i\s+playing|what\s+(?:'s|s)?\s+the\s+course)\b/i,
  club:       /\b(what\s+club|club\s+(?:am\s+i|i'm)\s+(?:using|hitting)|what\s+(?:am\s+i|i'm)\s+hitting)\b/i,
  // Offline caddie Tier 1 — the DECISION queries (distinct from "what club am I holding"):
  // club RECOMMENDATION ("what club should I hit / club for this / what do I hit here")…
  clubRec:    /\b(what|which)\s+club\s+(should|do|would)\s+i\b|\bclub\s+(for\s+this|from\s+here|do\s+i\s+(?:hit|need))\b|\bwhat\s+(?:should|do)\s+i\s+(?:hit|play)\s+(?:here|from\s+here|on\s+this)?\b|\bgive\s+me\s+a\s+club\b/i,
  // …and LAST SHOT recall ("what did I just hit / how was that / my last shot").
  lastShot:   /\b(last\s+shot|what\s+did\s+i\s+(?:just\s+)?hit|how\s+was\s+(?:that|my\s+last)|that\s+last\s+(?:one|shot)|my\s+last\s+(?:shot|swing))\b/i,
  // PLAYS-LIKE — the composed read (distance adjusted for wind/elevation). Check
  // BEFORE yardage since "how far does it play" also contains "how far".
  playsLike:  /\b(plays?\s+like|playing\s+(?:distance|like)|how\s+far\s+does\s+it\s+play|with\s+the\s+wind|into\s+the\s+wind|adjusted?\s+(?:for\s+)?(?:wind|elevation)|effective\s+(?:distance|yardage))\b/i,
  // WIND status ("what's the wind / how's the wind / windy / breeze"). Checked AFTER
  // plays-like so "with/into the wind" routes to the distance read, not here.
  wind:       /\b(wind|windy|breeze|breezy|gust(?:s|ing|y)?|how(?:'s|s)?\s+(?:the\s+)?wind)\b/i,
  // REACH feasibility — "can I reach / get there / get home / carry it / enough club".
  reach:      /\b(can\s+i\s+(?:reach|get\s+(?:there|home|to\s+the\s+green))|(?:will|can)\s+i\s+(?:make|carry)\s+(?:it|the\s+green)|do\s+i\s+have\s+(?:enough\s+club|the\s+club)|enough\s+club|reach\s+(?:the\s+green|it|in))\b/i,
  handicap:   /\b(my\s+handicap|what(?:'s|s)?\s+my\s+handicap)\b/i,
  // 2026-06-13 — pre-round routine (round-INDEPENDENT; handled before the round
  // gate). Save = the stretches the caddie just gave (from the conversation log);
  // recall = read them back. "save those stretches as my routine" / "what's my
  // pre-round routine".
  saveRoutine:   /\b(save|remember|keep)\b[^.?!]{0,28}\b(routine|stretches|warm.?up)\b/i,
  recallRoutine: /\b(what(?:'s|s)?|tell\s+me|recall|show\s+me|give\s+me|read)\b[^.?!]{0,28}\b(routine|stretches|warm.?up)\b/i,
};

/**
 * Match transcript against the supported status patterns and produce
 * a local reply. Returns null when nothing matches (let caller's brain-
 * unreachable fallback fire) or when an active round is required but
 * absent.
 */
export function tryLocalReply(
  transcript: string,
  language: LocalReplyLanguage = 'en',
): LocalReplyResult | null {
  if (!transcript || typeof transcript !== 'string') return null;
  const t = transcript.trim();
  if (!t) return null;
  const lang = (['en', 'es', 'zh'] as const).includes(language) ? language : 'en';

  // 2026-06-13 — Pre-round routine is round-INDEPENDENT (you save/recall it off the
  // course), so handle it BEFORE the round-active gate. Save points at the last
  // thing the caddie said (the stretches), captured by the conversation log —
  // this is exactly what conversation ingestion unblocks. Local + offline.
  if (RX.saveRoutine.test(t)) {
    const last = useConversationLog.getState().lastCaddieText();
    if (last) {
      usePlayerProfileStore.getState().setPreRoundRoutine(last);
      return { text: L[lang].routineSaved, queryType: 'routine_saved' };
    }
    return { text: L[lang].routineNothingToSave, queryType: 'routine_saved' };
  }
  if (RX.recallRoutine.test(t)) {
    const r = usePlayerProfileStore.getState().preRoundRoutine;
    return { text: r ?? L[lang].routineNone, queryType: 'routine_recall' };
  }

  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    // Off-course — no round state to query. Brain handles practice /
    // hypothetical chatter via the on-course/off-course dialogue mode
    // we wired earlier (api/kevin.ts + api/brain.ts).
    return null;
  }

  // ── PLAYS-LIKE (the composed moat read — check before plain yardage) ──
  if (RX.playsLike.test(t)) {
    return composedReadReply(lang);
  }
  // ── REACH (plays-like distance vs the player's longest club) ──
  if (RX.reach.test(t)) {
    return reachReply(lang);
  }
  // ── WIND (cached weather → head/tail/cross relative to the shot) ──
  if (RX.wind.test(t)) {
    return windReply(lang);
  }
  // ── YARDAGE (must check first; "yards" appears in other phrases) ──
  if (RX.yardage.test(t)) {
    return yardageReply(t, lang);
  }
  // ── CLUB RECOMMENDATION (the caddie's offline decision — check before "what
  //    club am I holding") ──
  if (RX.clubRec.test(t)) {
    return clubCallReply(lang);
  }
  // ── LAST SHOT recall ──
  if (RX.lastShot.test(t)) {
    return lastShotReply(lang);
  }
  // ── HOLE ──
  if (RX.hole.test(t)) {
    if (typeof round.currentHole === 'number' && round.currentHole > 0) {
      return { text: L[lang].holeIs(round.currentHole), queryType: 'hole_current' };
    }
    return null;
  }
  // ── PAR ──
  if (RX.par.test(t)) {
    const par = round.getCurrentPar();
    if (typeof par === 'number' && par > 0) {
      return { text: L[lang].parIs(par), queryType: 'par_current' };
    }
    return null;
  }
  // ── SCORE ──
  if (RX.score.test(t)) {
    return scoreReply(lang);
  }
  // ── HOLES LEFT ──
  if (RX.holesLeft.test(t)) {
    return holesLeftReply(lang);
  }
  // ── TEE BOX ──
  if (RX.tee.test(t)) {
    const tee = round.selectedTee;
    if (tee && tee !== 'unspecified') {
      return { text: L[lang].teeIs(tee), queryType: 'tee_box' };
    }
    return null;
  }
  // ── COURSE NAME ──
  if (RX.course.test(t)) {
    if (round.activeCourse) {
      return { text: L[lang].courseIs(round.activeCourse), queryType: 'course_name' };
    }
    return null;
  }
  // ── CLUB ──
  if (RX.club.test(t)) {
    if (round.club) {
      return { text: L[lang].clubIs(round.club), queryType: 'club_current' };
    }
    return { text: L[lang].noClub, queryType: 'club_current' };
  }
  // ── HANDICAP ──
  if (RX.handicap.test(t)) {
    const h = usePlayerProfileStore.getState().handicap;
    if (typeof h === 'number' && Number.isFinite(h)) {
      return { text: L[lang].handicapIs(h), queryType: 'handicap' };
    }
    return null;
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// Reply builders
// ────────────────────────────────────────────────────────────────────

function yardageReply(transcript: string, lang: LocalReplyLanguage): LocalReplyResult | null {
  const round = useRoundStore.getState();
  if (typeof round.currentHole !== 'number' || round.currentHole <= 0) return null;

  // CNS Phase 4 — signal-independence. When GPS can't give a number, lean on
  // what we've LEARNED about this hole on this course instead of going silent.
  // English-only append (the learned phrasing isn't localized) appended to the
  // localized no-fix line.
  const memoryFallback = (): LocalReplyResult | null => {
    if (lang !== 'en') return { text: L[lang].noFix, queryType: 'yardage_middle' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./caddieMemoryRetrieval') as typeof import('./caddieMemoryRetrieval');
      const g = mod.getCourseHoleGuidance({ courseId: round.activeCourseId, hole: round.currentHole });
      if (g) return { text: `${L[lang].noFix} ${g.text}`, queryType: 'course_memory' };
    } catch { /* no memory — fall through */ }
    return { text: L[lang].noFix, queryType: 'yardage_middle' };
  };

  const green = resolveGreenCoords(round.currentHole);
  if (!green || (!green.middle && !green.front && !green.back)) {
    return { text: L[lang].noGreen, queryType: 'yardage_middle' };
  }

  const fix = getLastFix();
  if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return memoryFallback();
  }
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'none' || quality.level === 'stale') {
    return memoryFallback();
  }

  // Determine target: front, back, or middle (default).
  let target = green.middle;
  let queryType: LocalReplyResult['queryType'] = 'yardage_middle';
  if (RX.yardageFront.test(transcript) && green.front) {
    target = green.front;
    queryType = 'yardage_front';
  } else if (RX.yardageBack.test(transcript) && green.back) {
    target = green.back;
    queryType = 'yardage_back';
  }
  if (!target) {
    return { text: L[lang].noGreen, queryType };
  }

  const yards = Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, target));

  // Honest about weak GPS — don't state a precise number on a sloppy fix.
  if (quality.level === 'weak') {
    return { text: L[lang].yardageIffy(yards), queryType };
  }
  if (queryType === 'yardage_front') return { text: L[lang].yardageFront(yards), queryType };
  if (queryType === 'yardage_back')  return { text: L[lang].yardageBack(yards), queryType };
  return { text: L[lang].yardageMiddle(yards), queryType };
}

// Offline caddie Tier 1 — CALL A CLUB. Distance from the same GPS/green path the
// yardage reply uses; the club from the player's REAL logged bag (bagDistances()).
// Every number is measured/logged — never a generated yardage. Honest when the bag
// is empty (track shots first) or the distance is unavailable (GPS/green missing).
function clubCallReply(lang: LocalReplyLanguage): LocalReplyResult {
  const round = useRoundStore.getState();
  const bag = Object.entries(bagDistances()) as [string, number][];
  if (bag.length === 0) {
    return { text: L[lang].noBag, queryType: 'club_recommend' };
  }
  if (typeof round.currentHole !== 'number' || round.currentHole <= 0) {
    return { text: L[lang].noFix, queryType: 'club_recommend' };
  }
  const green = resolveGreenCoords(round.currentHole);
  const fix = getLastFix();
  if (!green || !green.middle || !fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return { text: green && !green.middle ? L[lang].noGreen : L[lang].noFix, queryType: 'club_recommend' };
  }
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'none' || quality.level === 'stale') {
    return { text: L[lang].noFix, queryType: 'club_recommend' };
  }
  const dist = Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, green.middle));

  // Closest carry + the player's longest club (for the beyond-the-bag case).
  let best = bag[0];
  let longest = bag[0];
  for (const e of bag) {
    if (Math.abs(e[1] - dist) < Math.abs(best[1] - dist)) best = e;
    if (e[1] > longest[1]) longest = e;
  }
  if (dist > longest[1] + 8) {
    return { text: L[lang].clubBeyond(dist, longest[0], longest[1]), queryType: 'club_recommend' };
  }
  const gap = dist - best[1]; // + = need a touch more, − = stepping on it
  let text = gap > 6 ? L[lang].clubCallMore(dist, best[0], best[1])
    : gap < -6 ? L[lang].clubCallEasy(dist, best[0], best[1])
    : L[lang].clubCall(dist, best[0], best[1]);
  if (quality.level === 'weak') text += L[lang].clubIffy; // honest hedge on a sloppy fix
  return { text, queryType: 'club_recommend' };
}

// Offline caddie — the MOAT read composed LOCALLY: GPS distance to the green,
// adjusted for wind (cached weather) into a plays-like number + the player's club,
// with a short "why". Pure/offline-safe via composeShotRead. Same GPS/green guards
// as clubCallReply — honest when distance/green is unavailable.
function composedReadReply(lang: LocalReplyLanguage): LocalReplyResult {
  const round = useRoundStore.getState();
  if (typeof round.currentHole !== 'number' || round.currentHole <= 0) {
    return { text: L[lang].noFix, queryType: 'plays_like' };
  }
  const green = resolveGreenCoords(round.currentHole);
  const fix = getLastFix();
  if (!green || !green.middle || !fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return { text: green && !green.middle ? L[lang].noGreen : L[lang].noFix, queryType: 'plays_like' };
  }
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'none' || quality.level === 'stale') {
    return { text: L[lang].noFix, queryType: 'plays_like' };
  }
  const playerLoc = { lat: fix.lat, lng: fix.lng };
  const rawYards = Math.round(haversineYards(playerLoc, green.middle));
  const read = composeShotRead({
    rawYards,
    weather: getCachedWeatherEvenIfStale(playerLoc),
    shotBearingDeg: bearingDegrees(playerLoc, green.middle),
    bag: bagDistances(),
    dominantMiss: usePlayerProfileStore.getState().dominantMiss,
    isCompetition: round.isCompetition,
  });
  if (!read || read.playsLikeYards == null) {
    return { text: L[lang].noFix, queryType: 'plays_like' };
  }
  // For the spoken line use the wind/slope "why" (drop the learned-carry line,
  // which would be redundant with "that's your <club>").
  const why = (read.why ?? []).filter((w) => !/^your\s/i.test(w)).slice(0, 2).join(', ');
  let text = L[lang].playsLike(read.rawYards ?? rawYards, read.playsLikeYards, read.club, why);
  if (quality.level === 'weak') text += L[lang].clubIffy;
  return { text, queryType: 'plays_like' };
}

// Offline caddie — REACH feasibility: the plays-like distance to the green vs the
// player's LONGEST real club. Honest — only real bag carries, never a fabricated one.
function reachReply(lang: LocalReplyLanguage): LocalReplyResult {
  const round = useRoundStore.getState();
  const bag = Object.entries(bagDistances()) as [string, number][];
  if (bag.length === 0) return { text: L[lang].noBag, queryType: 'reach' };
  if (typeof round.currentHole !== 'number' || round.currentHole <= 0) {
    return { text: L[lang].noFix, queryType: 'reach' };
  }
  const green = resolveGreenCoords(round.currentHole);
  const fix = getLastFix();
  if (!green || !green.middle || !fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return { text: green && !green.middle ? L[lang].noGreen : L[lang].noFix, queryType: 'reach' };
  }
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'none' || quality.level === 'stale') {
    return { text: L[lang].noFix, queryType: 'reach' };
  }
  const playerLoc = { lat: fix.lat, lng: fix.lng };
  const rawYards = Math.round(haversineYards(playerLoc, green.middle));
  const read = composeShotRead({
    rawYards,
    weather: getCachedWeatherEvenIfStale(playerLoc),
    shotBearingDeg: bearingDegrees(playerLoc, green.middle),
    bag: bagDistances(),
  });
  const plays = read?.playsLikeYards ?? rawYards;
  let longest = bag[0];
  for (const e of bag) if (e[1] > longest[1]) longest = e;
  const margin = longest[1] - plays; // + = you have enough club
  if (margin >= 8) return { text: L[lang].reachYes(plays, longest[0], longest[1]), queryType: 'reach' };
  if (margin >= -6) return { text: L[lang].reachTight(plays, longest[0], longest[1]), queryType: 'reach' };
  return { text: L[lang].reachNo(plays, longest[0], longest[1]), queryType: 'reach' };
}

// Offline caddie — WIND status from cached weather. When the green + GPS give a
// shot bearing, describe it relative to the shot (into your face / at your back /
// cross); otherwise just the speed. Honest "no reading" when no cached weather.
function windReply(lang: LocalReplyLanguage): LocalReplyResult {
  const fix = getLastFix();
  if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return { text: L[lang].noWind, queryType: 'wind' };
  }
  const weather = getCachedWeatherEvenIfStale({ lat: fix.lat, lng: fix.lng });
  if (!weather) {
    return { text: L[lang].noWind, queryType: 'wind' };
  }
  const mph = Math.round(weather.wind_speed_mph ?? 0);
  if (mph < 3) {
    return { text: L[lang].windCalm(mph), queryType: 'wind' };
  }
  // Relative to the shot, when we can derive a bearing to the green.
  const round = useRoundStore.getState();
  const green = typeof round.currentHole === 'number' && round.currentHole > 0
    ? resolveGreenCoords(round.currentHole) : null;
  if (green?.middle) {
    const bearing = bearingDegrees({ lat: fix.lat, lng: fix.lng }, green.middle);
    const b = playsLikeDistance(150, weather, bearing); // distance is a dummy — we only read the components
    const along = b.along_wind_mph; // + tailwind, − headwind
    const cross = b.cross_wind_mph; // + left-to-right, − right-to-left
    if (along != null && cross != null) {
      const desc = Math.abs(along) >= Math.abs(cross)
        ? (along < 0 ? L[lang].windInto : L[lang].windHelp)
        : (cross > 0 ? L[lang].windL2R : L[lang].windR2L);
      return { text: L[lang].windRelative(mph, desc), queryType: 'wind' };
    }
  }
  return { text: L[lang].windPlain(mph), queryType: 'wind' };
}

// Offline caddie Tier 1 — LAST SHOT recall, straight from the logged round state
// (roundStore.shots). Honest about missing club/distance fields.
function lastShotReply(lang: LocalReplyLanguage): LocalReplyResult {
  const round = useRoundStore.getState();
  const shots = round.shots ?? [];
  if (shots.length === 0) {
    return { text: L[lang].noLastShot, queryType: 'last_shot' };
  }
  const s = shots[shots.length - 1];
  const club = typeof s.club === 'string' && s.club.trim() ? s.club.trim() : null;
  const dist = typeof s.distance_yards === 'number' ? s.distance_yards : null;
  const dir = s.direction ?? null;
  return { text: L[lang].lastShot(club, dist, dir), queryType: 'last_shot' };
}

function scoreReply(lang: LocalReplyLanguage): LocalReplyResult {
  const round = useRoundStore.getState();
  const scores = (round.scores ?? {}) as Record<string, number>;
  const courseHoles = round.courseHoles ?? [];
  let totalScore = 0;
  let totalPar = 0;
  let holesPlayed = 0;
  Object.entries(scores).forEach(([holeStr, s]) => {
    if (typeof s !== 'number' || s <= 0) return;
    const hole = Number(holeStr);
    const ch = courseHoles.find(h => h.hole === hole);
    if (ch && typeof ch.par === 'number') {
      totalScore += s;
      totalPar += ch.par;
      holesPlayed++;
    }
  });
  if (holesPlayed === 0) {
    return { text: L[lang].scoreNoneYet, queryType: 'score_round' };
  }
  const delta = totalScore - totalPar;
  if (delta === 0) return { text: L[lang].scoreEven(holesPlayed), queryType: 'score_round' };
  if (delta > 0)  return { text: L[lang].scoreOver(delta, holesPlayed), queryType: 'score_round' };
  return { text: L[lang].scoreUnder(Math.abs(delta), holesPlayed), queryType: 'score_round' };
}

function holesLeftReply(lang: LocalReplyLanguage): LocalReplyResult | null {
  const round = useRoundStore.getState();
  if (typeof round.currentHole !== 'number' || round.currentHole <= 0) return null;
  const totalHoles = round.nineHoleMode ? 9 : 18;
  // "Holes to play" semantic — includes the current hole the player is on.
  // On hole 1 of 18: 18 to play. On hole 18 of 18: 1 to play.
  const left = Math.max(0, totalHoles - round.currentHole + 1);
  return { text: L[lang].holesLeft(left), queryType: 'holes_left' };
}
