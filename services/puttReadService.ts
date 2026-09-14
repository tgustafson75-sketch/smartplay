/**
 * 2026-09-13 (Tim) — "most of the time I ask the Caddie to look at the Putt which works every time and
 * I think it opens SmartFinder in Putt mode… Or maybe it was actually opening tightlie but I get a pic
 * analysis. You just make a very simple assumption and ran with it."
 *
 * He was right, and the trace settled it. What "look at my putt" actually did:
 *
 *   1. the local precheck returned NULL for every putt phrasing, so the cloud classifier decided
 *   2. it landed on open_tool{look|scene_read}, which speaks "Let me take a look." and navigates to
 *      /smartfinder?autoread=1
 *   3. SmartFinder opened at its PERSISTED mode — putt only because that is what he last used; the
 *      autoread override rewrites 'map'→'target' and leaves anything else alone
 *   4. autoread then fired `runSceneRead`: a photo through `readScene`, which is the general
 *      "what's out there" hole read, with no putt context whatsoever
 *
 * So the feature he uses every round was reachable only by accident of a zustand-persisted mode, and
 * the analysis it fired was the wrong analysis — a hole read, pointed at a putt, BEFORE either end of
 * the putt had been tapped. Nothing in the app opened SmartFinder in putt mode on purpose: there was no
 * `mode` param anywhere, and the only setMode('putt') in the codebase is the on-screen tab button.
 *
 * THIS is the putt read. It runs on a MEASURED putt, and only once there is something to measure.
 *
 * ── WHAT IT WILL AND WILL NOT SAY ───────────────────────────────────────────────────────────────────
 *
 * The slope comes from the GROUNDED reading in services/puttSlopeRead — the phone laid on the green,
 * where its attitude IS the surface gradient. The aimed reading is deliberately NOT sent: inferring the
 * green's incline from where the camera points is the defect that produced "uphill when it's down", and
 * handing that inference to a language model would launder a bad number into a confident sentence.
 *
 * With no grounded reading the block says so and the caddie asks for one. That is the whole discipline:
 * a putt read with no slope is honest; a putt read with a fabricated slope is the thing we are fixing.
 * [[silence-is-not-an-answer]] — it never goes quiet, it says what it still needs.
 */

import { askCaddie } from './caddieBrain';
import { useSettingsStore } from '../store/settingsStore';
import {
  describeGroundSlope,
  groundConfidenceNote,
  type GroundSlopeRead,
  type ReadConfidence,
} from './puttSlopeRead';

const PUTT_INSTRUCTION =
  "I'm on the green, over this putt. Read it for me from the measurements below — pace first, then " +
  'the line, then one sentence on how to commit to it. Use ONLY the slope I actually measured: if ' +
  "there is no slope measurement, say you don't have one and ask me to lay the phone on the green, " +
  'and do NOT guess a direction from the picture. Never invent inches of break or a cup count. Keep ' +
  'it tight and spoken, no lists.';

/**
 * 2026-09-13 (Tim) — "See if you can bake in a vision step to look for the flag stick and flag and hole."
 *
 * THE PICTURE'S JOB IS TO CHECK THE MEASUREMENT, not to decorate the answer.
 *
 * The A/B distance is only as good as the second tap landing on the hole, and nothing has ever verified
 * that it did — which is a direct contributor to the accuracy Tim has been chasing ("Ive loved the
 * feature but accuracy has been a challenge"). So the frame goes up with the tapped point expressed as a
 * fraction of it, and the model is asked one narrow, checkable question: is the hole or the flagstick
 * actually there?
 *
 * Deliberately qualitative. A vision model can tell a flagstick from grass and say roughly where it sits;
 * it cannot measure pixels, so it is never asked to. And a MISS is the valuable answer — it means the
 * distance is wrong and should be re-tapped, which is worth more than a confident number.
 */
/**
 * 2026-09-13 (Tim) — "could there be a second level placing phone on the ground and it sees the terrain
 * lie to the pin clearly?"
 *
 * THE GRAZING READ. When the frame was taken with the phone standing on the green, the camera is an
 * inch off the deck looking down the line — the crouch-behind-the-ball view — and vertical relief that
 * is invisible from chest height stands up against the backdrop. That is a genuinely different picture
 * to reason about, so it gets a different question.
 *
 * Still QUALITATIVE, deliberately. The inclinometer owns the number; a photograph does not get to
 * produce a percentage, and asking it to would re-introduce exactly the confident-and-unfounded slope
 * this whole pass exists to remove. What a grazing frame CAN support is shape and sequence: where the
 * ground falls away, which side is high, whether the line crests or dips before the hole.
 */
const GRAZING_INSTRUCTION =
  'This frame was taken with the phone resting ON the green, camera an inch off the ground looking down ' +
  'the line — the view you get crouching behind the ball, where slope that is invisible from standing ' +
  'height shows up against the background. Read the SHAPE of the ground between me and the hole: which ' +
  'side is high, where it falls away, whether the line crests or dips before it gets there, and whether ' +
  'the last few feet run out or hold up. Describe shape and sequence only — do NOT give me a slope ' +
  'percentage or inches of break from a picture; the measured slope is above and it owns the numbers. ' +
  'If the ground between us is hidden or the frame is too dark to read, say so instead of guessing.';

const FLAG_INSTRUCTION =
  'Also look at the picture for the hole and the flagstick. Say whether you can see a hole, a flagstick ' +
  'or a flag at all, and roughly where it sits in the frame (left / centre / right, near / far). Compare ' +
  "that to the spot I tapped as the hole, given below. If the hole clearly is NOT where I tapped, say so " +
  "plainly and tell me to re-tap it — my distance is wrong if the tap missed. If you can't see a hole or " +
  "flagstick, say that rather than assuming my tap was right. If the flag is visibly moving, mention the " +
  'wind on the green. Never estimate a distance from the picture — the distance comes from my taps.';

export interface PuttReadMeasurement {
  /** A/B tap distance, in feet, from the tilt projection in services/rangefinder. */
  distanceFeet: number | null;
  /** ± feet propagated through that geometry. Null when there is no distance to qualify. */
  distanceUncertaintyFeet?: number | null;
  /** The grounded reading, or null when the player has not laid the phone down yet. */
  ground: GroundSlopeRead | null;
  groundConfidence: ReadConfidence | null;
  /** How many spots along the line were sampled for the grounded reading. */
  groundSpots: number;
  /** The player's own read, verbatim, when he gave one ("left edge, 8 inches"). */
  spokenRead?: string | null;
  /**
   * Where point B was tapped, as a fraction of the frame (0-1, origin top-left). Sent so the vision step
   * can check the tap against where the hole actually is. Null when there is no frame to check against.
   */
  targetPoint?: { xNorm: number; yNorm: number } | null;
  /**
   * True when the frame came from the phone STANDING on the green rather than held at chest height.
   * A different picture deserves a different question — see GRAZING_INSTRUCTION.
   */
  frameFromGround?: boolean;
}

/**
 * Which questions this frame can actually support. A text-only turn is never asked to look at a picture
 * — that invites it to invent one — and a chest-height frame is never asked the grazing question, which
 * only means anything from ground level.
 */
export function composeInstruction(input: PuttReadMeasurement & { imageBase64?: string | null }): string {
  if (!input.imageBase64) return PUTT_INSTRUCTION;
  const parts = [PUTT_INSTRUCTION, FLAG_INSTRUCTION];
  if (input.frameFromGround) parts.push(GRAZING_INSTRUCTION);
  return parts.join('\n\n');
}

export interface PuttReadResult {
  text: string;
  /** True when a grounded slope actually backed the read. False means the caddie asked for one. */
  usedGround: boolean;
}

/**
 * The measured truth, written out for the brain. Every line is something the phone or the player
 * actually produced; anything absent is stated as absent rather than omitted, because an omission reads
 * to a language model as permission to fill the gap.
 */
export function buildPuttMeasurementBlock(m: PuttReadMeasurement): string {
  const lines: string[] = ['THIS PUTT — measured on the green just now:'];

  if (m.distanceFeet != null) {
    /**
     * 2026-09-13 — this used to say "rough visual estimate", and it was: pixels over a fixed constant.
     * It is now a tilt projection through the learned hold height, and it comes with a ± propagated
     * from the actual geometry. So the number is stated, and the ± carries the honesty — rather than a
     * hedge in words that the model then has to decide how much to discount.
     */
    const pm = m.distanceUncertaintyFeet;
    lines.push(pm != null
      ? `- Length: ${m.distanceFeet} feet, give or take ${pm}. Use the range when it matters to the call — a ${m.distanceFeet}-footer that could be ${Math.round((m.distanceFeet + pm) * 10) / 10} is a different lag.`
      : `- Length: ${m.distanceFeet} feet.`);
  } else {
    lines.push('- Length: not measured yet.');
  }

  const desc = m.ground ? describeGroundSlope(m.ground) : null;
  if (desc && m.groundConfidence) {
    lines.push(`- Slope, phone laid on the green: ${desc}`);
    lines.push(`- Confidence in that slope: ${m.groundConfidence} (${groundConfidenceNote(m.groundConfidence, { spots: m.groundSpots })}).`);
    if (m.groundConfidence === 'low') {
      lines.push('- Because confidence is low, give the pace call but say plainly that the slope reading is marginal.');
    }
    if (m.groundSpots < 2) {
      lines.push('- Only one spot on the line was sampled, so this describes that patch rather than the whole putt.');
    }
  } else {
    lines.push('- Slope: NO MEASUREMENT. Do not state uphill or downhill. Ask him to lay the phone flat on the green, top end toward the hole, and say you will read it then.');
  }

  if (m.targetPoint) {
    const { xNorm, yNorm } = m.targetPoint;
    const across = xNorm < 0.34 ? 'left' : xNorm > 0.66 ? 'right' : 'centre';
    const up = yNorm < 0.34 ? 'upper' : yNorm > 0.66 ? 'lower' : 'middle';
    lines.push(`- I tapped the hole at the ${up} ${across} of the frame (${Math.round(xNorm * 100)}% across, ${Math.round(yNorm * 100)}% down). Check that against where the hole actually is.`);
  }

  if (m.spokenRead && m.spokenRead.trim()) {
    /**
     * His read covers the WHOLE line; the phone covers one patch of it. So neither automatically wins,
     * and the useful output is naming whether they agree — which is what he asked this feature to do:
     * "settle the issue we are working on when other factors dont agree."
     */
    lines.push(`- His own read, in his words: "${m.spokenRead.trim()}". His eye covers the whole line; the phone measured one patch of it. Say whether the two AGREE, and if they do not, say which part of the line to go look at again. Do not simply overrule him.`);
  }

  return lines.join('\n');
}

/**
 * Ask the caddie to read the measured putt.
 *
 * THROUGH `askCaddie`, WHICH MEANS THROUGH THE ONE BUILDER. The first version of this hand-assembled
 * its own payload and pulled the putting record and the prior green read itself — and the one-payload
 * guard went red, correctly. Its comment says a second exception is the moment to ask whether the rule
 * or the code is wrong, and here the code was: `buildCaddieRequestBody` ALREADY emits both of those
 * blocks, so the hand-rolled version was a second assembly of context that existed, which is the exact
 * shape of the ten payloads that made Tim hear the voice change between surfaces.
 *
 * Going through it also puts the read in the conversation history, so "what did you say about that
 * putt?" reaches something. [[two-owners-is-the-root-cause]] [[one-caddie-one-payload]]
 *
 * Returns null when the brain could not answer, so the caller keeps the local on-screen read rather
 * than showing nothing.
 */
export async function readPutt(input: PuttReadMeasurement & {
  imageBase64?: string | null;
  mediaType?: string;
}): Promise<PuttReadResult | null> {
  const settings = useSettingsStore.getState();
  const usedGround = !!(input.ground && describeGroundSlope(input.ground) && input.groundConfidence);

  const turn = await askCaddie({
    // The flag cross-check is only asked for when there is actually a picture to check against —
    // asking a text-only turn to look at a frame invites it to invent one.
    message: composeInstruction(input),
    language: settings.language ?? 'en',
    /** The measurements are FACTS, so they ride in the live block with the rest of the situation. */
    liveBlock: buildPuttMeasurementBlock(input),
    image_base64: input.imageBase64 ?? null,
    image_media_type: input.imageBase64 ? (input.mediaType ?? 'image/jpeg') : null,
    image_caption: input.imageBase64
      ? (input.frameFromGround
          ? 'Phone resting on the green, camera at ground level looking down the line of a putt.'
          : 'Looking down the line of a putt on the green.')
      : null,
    // The screen speaks this itself through the same path the scene read uses, so the server TTS
    // round-trip would be paid for and thrown away.
    skipTts: true,
    // Matches the scene read's headroom: a multimodal turn on a cold cache can take 30-40 s.
    timeoutMs: 60_000,
  });

  const text = turn?.text?.trim();
  if (!text) return null;
  return { text, usedGround };
}
