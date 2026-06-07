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
 *             returns it as if /api/kevin had replied. Phase 1's
 *             device-TTS fallback then speaks it via system voice.
 *
 * Combined with Phase 1 + Phase 2: "What's my yardage?" on dead
 * cellular → device TTS speaks "118 to the middle of the green."
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
import { getLastFix } from './gpsManager';
import { haversineYards } from '../utils/geoDistance';
import { resolveGreenCoords, classifyAccuracy } from './smartFinderService';

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
    | 'handicap'
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
  handicapIs: (h: number) => string;
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
    handicapIs: (h) => `Your handicap is ${h}.`,
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
    handicapIs: (h) => `Tu handicap es ${h}.`,
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
    handicapIs: (h) => `你的差点是${h}。`,
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
  handicap:   /\b(my\s+handicap|what(?:'s|s)?\s+my\s+handicap)\b/i,
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

  const round = useRoundStore.getState();
  if (!round.isRoundActive) {
    // Off-course — no round state to query. Brain handles practice /
    // hypothetical chatter via the on-course/off-course dialogue mode
    // we wired earlier (api/kevin.ts + api/brain.ts).
    return null;
  }

  // ── YARDAGE (must check first; "yards" appears in other phrases) ──
  if (RX.yardage.test(t)) {
    return yardageReply(t, lang);
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

  const green = resolveGreenCoords(round.currentHole);
  if (!green || (!green.middle && !green.front && !green.back)) {
    return { text: L[lang].noGreen, queryType: 'yardage_middle' };
  }

  const fix = getLastFix();
  if (!fix || typeof fix.lat !== 'number' || typeof fix.lng !== 'number') {
    return { text: L[lang].noFix, queryType: 'yardage_middle' };
  }
  const quality = classifyAccuracy(fix.accuracy_m, fix.timestamp);
  if (quality.level === 'none' || quality.level === 'stale') {
    return { text: L[lang].noFix, queryType: 'yardage_middle' };
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
