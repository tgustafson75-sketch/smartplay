/**
 * Phase BL — Club recognition client.
 *
 * Sends a base64 photo of a club sole to /api/club-recognition (cloud
 * Anthropic Sonnet vision) and returns the structured OCR-style result.
 * Three-tier UX is the consumer's responsibility:
 *   - high   confidence → register the club, brief Kevin/Serena ack.
 *   - medium confidence → "Looks like X — confirm?" prompt.
 *   - low    confidence (or 'unknown') → fall back to manual selector.
 *
 * The photo capture step lives in the cage UI (expo-image-picker
 * launchCameraAsync). This service does NOT take photos itself; it
 * accepts an already-captured base64 string so it stays decoupled from
 * the camera surface and easy to test.
 *
 * Telemetry: each call emits an analytics event with confidence + result
 * so success/failure rates can be tracked over time.
 */

// 2026-05-25 — SDK 54 moved readAsStringAsync to the legacy module.
// Same fix pattern as the tutorialAnalysis + custom-caddie SDK 54
// sweep. Without /legacy this throws "undefined is not a function" as
// soon as a club sole photo upload fires.
import * as FileSystem from 'expo-file-system/legacy';
import { track } from './analytics';

// Catalog matches the legacy CLUBS array in app/cage/index.tsx so values
// stored in cageStore.activeSession.club / clubSegments[].club_id line up
// with what the manual selector grid writes today. New tokens added for
// woods (7W) and hybrids (2H-5H) per BL scope.
export type ClubId =
  | 'DR' | '3W' | '5W' | '7W'
  | '2H' | '3H' | '4H' | '5H'
  | '3I' | '4I' | '5I' | '6I' | '7I' | '8I' | '9I'
  | 'PW' | 'GW' | 'AW' | 'SW' | 'LW'
  | 'PT'
  | 'unknown';

export type ClubType = 'iron' | 'wedge' | 'hybrid' | 'wood' | 'driver' | 'putter' | 'unknown';

// The pure bag-reconcile logic lives in its own dependency-free module (testable in node).
import { reconcileClubWithBag } from './clubBagReconcile';
import { digitizeNumberWords } from './clubNormalize';
export { reconcileClubWithBag } from './clubBagReconcile';

export interface ClubRecognitionResult {
  kind: 'ok';
  club_id: ClubId;
  club_type: ClubType;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  latency_ms: number;
}

export type ClubRecognitionOutcome =
  | ClubRecognitionResult
  | { kind: 'no_network'; latency_ms: number }
  | { kind: 'error'; message: string; latency_ms: number };

// 2026-06-23 (smoke-test) — 15s aborted BEFORE the 30s server cap on a cold
// Lambda, so a healthy-but-slow recognition was killed client-side on good
// signal and mislabeled no_network. 28s keeps the client UNDER the server cap.
const REQUEST_TIMEOUT_MS = 28_000;

/**
 * Convert a local image URI (as returned by expo-image-picker /
 * expo-camera takePictureAsync) into a base64 string. expo-camera's
 * takePictureAsync({ base64: true }) already returns base64, so this is
 * only needed when we have a URI.
 */
async function uriToBase64(uri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  });
  return b64;
}

/**
 * Recognize a club from a base64-encoded photo of its sole. Returns a
 * structured outcome — never throws on network failures (returns a
 * tagged error variant instead so the UI can render fallback UX).
 */
export async function recognizeClubFromBase64(
  b64: string,
  apiUrl: string,
): Promise<ClubRecognitionOutcome> {
  const startedAt = Date.now();

  if (!apiUrl || !b64) {
    return { kind: 'error', message: 'Missing apiUrl or image data', latency_ms: 0 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${apiUrl}/api/club-recognition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: { b64, media_type: 'image/jpeg' } }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      track('club_recognition_failed', {
        status: res.status,
        latency_ms,
        body_preview: text.slice(0, 200),
      });
      return { kind: 'error', message: `HTTP ${res.status}: ${text.slice(0, 200)}`, latency_ms };
    }

    const data = (await res.json()) as {
      club_id?: ClubId;
      club_type?: ClubType;
      confidence?: 'high' | 'medium' | 'low';
      reasoning?: string;
    };

    const rawClubId = data.club_id ?? 'unknown';
    const confidence = data.confidence ?? 'low';
    // Turn the known bag around onto this read: snap an ambiguous read to an owned neighbor.
    // Lazy require avoids any import cycle with the store; empty bag → reconcile is a no-op.
    let club_id = rawClubId;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const owned = (require('../store/clubBagStore') as typeof import('../store/clubBagStore'))
        .useClubBagStore.getState().bagList().map((c) => c.club_id);
      club_id = reconcileClubWithBag(rawClubId, confidence, owned) as ClubId;
    } catch { /* no bag / store unavailable → keep the raw read */ }

    const result: ClubRecognitionResult = {
      kind: 'ok',
      club_id,
      club_type: data.club_type ?? 'unknown',
      confidence,
      reasoning: data.reasoning ?? '',
      latency_ms,
    };

    track('club_recognition_ok', {
      club_id: result.club_id,
      club_type: result.club_type,
      confidence: result.confidence,
      latency_ms,
    });

    return result;
  } catch (e) {
    clearTimeout(timer);
    const latency_ms = Date.now() - startedAt;
    const message = e instanceof Error ? e.message : 'Unknown error';

    // 2026-06-23 (smoke-test) — only a GENUINE connectivity failure is no_network.
    // An abort/timeout = the server was slow (cold Lambda), NOT signal loss; it must
    // surface as an error, not a false "check your network" on good signal.
    if (message.includes('Network request failed') || message.includes('Network request')) {
      track('club_recognition_no_network', { latency_ms });
      return { kind: 'no_network', latency_ms };
    }

    track('club_recognition_error', { message, latency_ms });
    return { kind: 'error', message, latency_ms };
  }
}

/**
 * Recognize a club from a local image URI. Convenience wrapper that
 * reads the file and forwards to recognizeClubFromBase64.
 */
export async function recognizeClubFromUri(
  uri: string,
  apiUrl: string,
): Promise<ClubRecognitionOutcome> {
  try {
    const b64 = await uriToBase64(uri);
    return await recognizeClubFromBase64(b64, apiUrl);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    track('club_recognition_read_failed', { message });
    return { kind: 'error', message: `Could not read image: ${message}`, latency_ms: 0 };
  }
}

/**
 * Parse a spoken club name into a club_id. Used by the voice intent
 * handler to convert "switching to 6-iron" / "pitching wedge" / "driver"
 * into a stable identifier the cage session can store.
 *
 * Returns null when the phrase is too ambiguous to resolve (e.g., bare
 * "wedge" — could be PW/GW/SW/LW). Caller surfaces a clarifying prompt
 * in that case.
 */
export function parseSpokenClub(phrase: string): { club_id: ClubId; club_type: ClubType } | null {
  // 2026-07-08 (Tim — "an intelligent golf app can't tell what a club is when I say it")
  // — people say clubs SPELLED OUT as often as with a digit ("seven iron", "five hybrid",
  // "three wood"). The parser below only matched digits, so every spoken-number club fell
  // through to null → the caddie asked "which club?". Normalize number-words to digits up
  // front so "seven iron" → "7 iron" flows through the existing matchers.
  /**
   * 2026-08-17 (Tim — "if I say it's an eighteen three driver iron or a fifty two or a fifty six or
   * a fifty eight degree wedge") — this table stopped at TEN, so every loft a golfer says by name
   * died here. The loft matchers below (wedges 46-64, driving irons 14-32) were written for exactly
   * these phrases, and the 2026-08-10 commit that added driving-iron parsing quotes Tim saying
   * "eighteen degree driving iron" in its own header — a sentence that could not parse, because
   * "eighteen" never became 18. Only the typed form worked, in a voice app.
   *
   * Now shares services/clubNormalize.digitizeNumberWords with the token normalizer (compounds
   * included: "fifty two" → 52), so the two parsers cannot disagree about what a number is.
   */
  const p = digitizeNumberWords(phrase.trim());
  if (!p) return null;

  // Driver
  if (/\b(driver|big stick|the dr)\b/.test(p)) return { club_id: 'DR', club_type: 'driver' };

  // Putter (cage isn't putting-focused but voice may still trigger)
  if (/\b(putter|the putt)\b/.test(p)) return { club_id: 'PT', club_type: 'putter' };

  // Specific wedges first (so "pitching wedge" matches before bare "wedge")
  if (/\b(pw|pitching\s*wedge)\b/.test(p)) return { club_id: 'PW', club_type: 'wedge' };
  if (/\b(gw|gap\s*wedge)\b/.test(p))      return { club_id: 'GW', club_type: 'wedge' };
  if (/\b(aw|approach\s*wedge)\b/.test(p)) return { club_id: 'AW', club_type: 'wedge' };
  if (/\b(sw|sand\s*wedge)\b/.test(p))     return { club_id: 'SW', club_type: 'wedge' };
  if (/\b(lw|lob\s*wedge)\b/.test(p))      return { club_id: 'LW', club_type: 'wedge' };

  // 2026-08-08 (verification wave) — wedges BY LOFT ("56 degree", "60"+"degree wedge"): the brain's
  // register_bag tool description explicitly teaches the model to emit these phrases, but nothing
  // parsed them — the promised phrasing always landed in `missed`. Map loft → the bag's wedge slots
  // (46-49 → PW, 50-53 → GW, 54-57 → SW, 58-64 → LW).
  const deg = p.match(/\b(4[6-9]|5[0-9]|6[0-4])\s*(?:degrees?|deg\b|°)/);
  if (deg) {
    const loft = Number(deg[1]);
    const id: ClubId = loft <= 49 ? 'PW' : loft <= 53 ? 'GW' : loft <= 57 ? 'SW' : 'LW';
    return { club_id: id, club_type: 'wedge' };
  }

  // Bare "wedge" → ambiguous, return null so caller can prompt
  if (/\bwedge\b/.test(p)) return null;

  /**
   * 2026-08-10 (Tim — "you need to be able to change the bag on the fly. I can't be, like, Arccos —
   * switch, I still two weeks later haven't had time to set up. But if I say I'm gonna use an
   * eighteen degree driving iron, DON'T ASK ME WHICH IRON. Add that, put it in the bag, and
   * correlate distances").
   *
   * DRIVING / UTILITY IRONS, by name and by loft. Nothing here parsed them: only WEDGE lofts
   * (46-64°) were handled, so "18 degree driving iron" fell straight through to null and the caddie
   * asked which iron — the exact interrogation he's describing. A driving iron is a real club a lot
   * of players put in on a windy day, and swapping it in mid-round has to cost one sentence.
   *
   * Loft → slot uses standard iron lofts (3I≈20°, 4I≈23°, 5I≈26°, 6I≈29°), picking the nearest
   * slot we actually carry — an 18° driving iron sits closest to the 3-iron. When a loft is spoken
   * with "hybrid" or "wood" instead, it maps into those families by their own standard lofts, so
   * "19 degree hybrid" doesn't get filed as an iron.
   */
  const longLoft = p.match(/\b(1[4-9]|2[0-9]|3[0-2])\s*(?:degrees?|deg\b|°)/);
  const saysDrivingIron = /\b(driving|utility|driver'?s?)\s*iron\b|\bdi\b|\butility\b/.test(p);
  if (longLoft && (saysDrivingIron || /\b(iron|hybrid|wood)\b/.test(p))) {
    const loft = Number(longLoft[1]);
    if (/\bhybrid|rescue\b/.test(p)) {
      // 2H≈17, 3H≈19, 4H≈22, 5H≈25
      const id: ClubId = loft <= 18 ? '2H' : loft <= 20 ? '3H' : loft <= 23 ? '4H' : '5H';
      return { club_id: id, club_type: 'hybrid' };
    }
    if (/\bwood\b/.test(p)) {
      // 3W≈15, 5W≈18, 7W≈21
      const id: ClubId = loft <= 16 ? '3W' : loft <= 19 ? '5W' : '7W';
      return { club_id: id, club_type: 'wood' };
    }
    // Irons (incl. driving/utility irons): nearest standard iron loft.
    const id: ClubId = loft <= 21 ? '3I' : loft <= 24 ? '4I' : loft <= 27 ? '5I' : loft <= 30 ? '6I' : '7I';
    return { club_id: id, club_type: 'iron' };
  }
  // Named driving iron with no loft spoken — a driving iron is a 2/3-iron by convention.
  if (saysDrivingIron) return { club_id: '3I', club_type: 'iron' };

  // Hybrids: "3 hybrid", "4h", "rescue 3"
  const hyb = p.match(/\b([2-5])\s*(?:h|hybrid|rescue)\b/);
  if (hyb) return { club_id: `${hyb[1]}H` as ClubId, club_type: 'hybrid' };

  // Woods: "3 wood", "5w", "fairway 3". 2026-08-08 — '9' removed: there is NO 9W slot in
  // CLUB_ORDER/ClubName, so a parsed '9W' flowed into stores as a garbage key no reader ever read
  // (while the caddie confirmed it). Out-of-bag clubs must land in `missed` (ask), never register.
  const wood = p.match(/\b([357])\s*(?:w|wood)\b/);
  if (wood) return { club_id: `${wood[1]}W` as ClubId, club_type: 'wood' };

  // Numbered irons: "6 iron", "6-iron". 2026-05-17 — the bare-digit
  // form ("my 6") was previously caught here too via an optional
  // `(?:i|iron)?` group, which over-fired: "3 of us", "ace 7" all
  // parsed as irons. Iron cue (i / iron) is now required.
  const iron = p.match(/\b([3-9])\s*(?:i\b|iron\b)/);
  if (iron) return { club_id: `${iron[1]}I` as ClubId, club_type: 'iron' };

  return null;
}

/**
 * Friendly label for TTS / UI ("6-iron", "Pitching Wedge", "Driver").
 * Accepts string rather than ClubId so legacy SwingSession.club values
 * (which are arbitrary strings from the manual selector grid) render too.
 */
export function clubLabel(club_id: string): string {
  switch (club_id as ClubId) {
    case 'DR': return 'driver';
    case 'PT': return 'putter';
    case 'PW': return 'pitching wedge';
    case 'GW': return 'gap wedge';
    case 'AW': return 'approach wedge';
    case 'SW': return 'sand wedge';
    case 'LW': return 'lob wedge';
    case 'unknown': return 'unknown club';
    default:
      // Legacy bare-number values like '7' (without 'I' suffix) still
      // render as "7-iron" so older sessions don't show a raw token.
      if (/^[3-9]$/.test(club_id)) return `${club_id}-iron`;
      if (/^[3-9]I$/.test(club_id)) return `${club_id[0]}-iron`;
      if (/^[2-5]H$/.test(club_id)) return `${club_id[0]}-hybrid`;
      if (/^[3579]W$/.test(club_id)) return `${club_id[0]}-wood`;
      return club_id;
  }
}
