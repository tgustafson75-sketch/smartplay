/**
 * FULL SWING — golf-knowledge module (layer 'full_swing').
 *
 * The fault taxonomy across the three phases:
 *   - BACKSWING   : flat / upright / across-the-line / flying-elbow
 *   - TRANSITION  : casting / over-the-top / early-extension / stall
 *   - FINISH      : hanging-back / chicken-wing / loss-of-balance
 *
 * Each entry's `id` is also a key the causal engine ranks (FAULT_PRIORITY).
 * Backswing/architecture faults are earlier-causal (higher priority) than the
 * transition faults they feed, which are earlier than finish symptoms.
 *
 * HONESTY: pose gives directional body-angle reads (`pose_biomech`) when on
 * device; nothing here is a precise measurement, so directional at best.
 */

import type { KBEntry } from '../schema';

const MODULE = 'full_swing';

export const FULL_SWING: KBEntry[] = [
  // ── BACKSWING ────────────────────────────────────────────────────────────
  {
    id: 'fs.backswing.flat',
    layer: 'full_swing',
    module: MODULE,
    topic: 'backswing — too flat',
    aliases: ['flat backswing', 'swing is too flat', 'too around me', 'shallow backswing'],
    principle:
      'A too-flat backswing wraps the club behind you and tends to drop it under plane, producing hooks, pushes and inside-out misses. Feel the lead arm work more up across the chest so the club sets on plane rather than around you.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['lead arm works up, not around', 'set on plane'],
    related: ['fs.backswing.across-the-line', 'fs.transition.over-the-top'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.backswing.upright',
    layer: 'full_swing',
    module: MODULE,
    topic: 'backswing — too upright',
    aliases: ['upright backswing', 'too steep going back', 'lifting the club', 'too vertical backswing'],
    principle:
      'A too-upright backswing lifts the arms with little body turn, steepening the downswing into over-the-top and slices/pulls. Replace lift with TURN — let the shoulders rotate to move the club up, keeping width.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['turn, don’t lift', 'keep width', 'shoulders move the club up'],
    related: ['fs.backswing.flying-elbow', 'fs.transition.over-the-top', 'fs.architecture.shoulder-turn'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.backswing.across-the-line',
    layer: 'full_swing',
    module: MODULE,
    topic: 'backswing — across the line',
    aliases: ['across the line', 'club points right at the top', 'overswing at the top'],
    principle:
      'At the top the shaft pointing right of target (for a righty) is "across the line" — it usually comes with a long, loose or flat backswing and invites a steep, redirecting transition. Shorten and tighten the top so the shaft matches the target line.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['shaft parallel to the target line at the top', 'shorter, more connected'],
    related: ['fs.backswing.flat', 'fs.transition.casting'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.backswing.flying-elbow',
    layer: 'full_swing',
    module: MODULE,
    topic: 'backswing — flying trail elbow',
    aliases: ['flying elbow', 'trail elbow', 'elbow flying out', 'chicken wing going back'],
    principle:
      'The trail elbow lifting and separating from the body at the top disconnects the arms from the turn and steepens the downswing. Keep the trail elbow softer and more in front of the body so the arms stay connected to the rotation.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['trail elbow stays in front', 'keep arms connected to the turn'],
    related: ['fs.backswing.upright', 'fs.architecture.connection'],
    source: 'swing-mechanics',
  },

  // ── ARCHITECTURE (motion) ────────────────────────────────────────────────
  {
    id: 'fs.architecture.takeaway',
    layer: 'full_swing',
    module: MODULE,
    topic: 'motion — one-piece takeaway',
    aliases: ['takeaway', 'first move back', 'one piece takeaway', 'snatch it back'],
    principle:
      'Start the club back with the shoulders, arms and club moving together — a one-piece takeaway sets width and plane early. Snatching it inside with the hands or yanking it outside both force a mid-swing correction.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['low and slow, one piece', 'set width early'],
    related: ['fs.architecture.shoulder-turn', 'fs.backswing.flat'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.architecture.shoulder-turn',
    layer: 'full_swing',
    module: MODULE,
    topic: 'motion — shoulder / hip turn',
    aliases: ['shoulder turn', 'hip turn', 'not enough turn', 'restricted backswing', 'no coil'],
    principle:
      'A full shoulder turn against a stable lower body builds the coil that powers the downswing and keeps the arms passive. A restricted turn forces the arms and hands to make up the power and length — the root of many over-the-top moves.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['turn the back to the target', 'coil against the lower body'],
    related: ['fs.architecture.takeaway', 'fs.transition.over-the-top'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.architecture.connection',
    layer: 'full_swing',
    module: MODULE,
    topic: 'motion — arm/body connection',
    aliases: ['connection', 'arms disconnected', 'arms running away', 'stay connected'],
    principle:
      'When the arms stay connected to the rotating body, the club delivers from the inside on a repeatable plane. Disconnection lets the arms swing independently, scattering low point and face — the single most common driver of inconsistency.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['arms move with the chest', 'feel the lead arm across the body'],
    related: ['fs.backswing.flying-elbow', 'contact.dispersion-centroid'],
    source: 'swing-mechanics',
  },

  // ── TRANSITION ───────────────────────────────────────────────────────────
  {
    id: 'fs.transition.over-the-top',
    layer: 'full_swing',
    module: MODULE,
    topic: 'transition — over the top',
    aliases: ['over the top', 'i keep slicing', 'slice', 'coming over the top', 'outside in', 'pull slice'],
    principle:
      'Over-the-top is the club starting down outside the plane so it cuts across the ball — the classic slice/pull. It is usually a SYMPTOM of the upper body and arms firing first. Start the downswing from the ground up (lead-foot pressure, then hips) so the club drops to the inside.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['ground up, not arms first', 'drop the club to the inside', 'shift then turn'],
    related: ['fs.architecture.shoulder-turn', 'fs.transition.casting', 'bf.face-to-path'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.transition.casting',
    layer: 'full_swing',
    module: MODULE,
    topic: 'transition — casting / early release',
    aliases: ['casting', 'early release', 'throwing away the lag', 'losing lag', 'casting the club'],
    principle:
      'Casting is releasing the wrist angle too early from the top, throwing the clubhead out and away. It bleeds speed, steepens the path and adds loft (weak, high, fat shots). Let the wrists hold their angle while the lower body leads, so the club shallows.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['hold the angle, lead with the body', 'feel the club shallow, not throw'],
    related: ['fs.transition.over-the-top', 'contact.compression'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.transition.early-extension',
    layer: 'full_swing',
    module: MODULE,
    topic: 'transition — early extension',
    aliases: ['early extension', 'standing up out of the shot', 'hips thrust toward the ball', 'losing posture'],
    principle:
      'Early extension is the hips thrusting toward the ball and the spine standing up through impact — it narrows the room for the arms and causes blocks, hooks and toe/heel scatter. Keep the trail glute back and maintain the forward tilt as you rotate through.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['keep the trail glute back', 'hold your tilt, rotate through', 'make room for the arms'],
    related: ['setup.posture', 'contact.low-point', 'fs.transition.stall'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.transition.stall',
    layer: 'full_swing',
    module: MODULE,
    topic: 'transition — body stall',
    aliases: ['body stall', 'stopping my rotation', 'flipping because i stall', 'not rotating through'],
    principle:
      'When the body stops rotating in the downswing, the hands take over and flip to square the face — producing inconsistent low point and a hooky/blocky pattern. Keep the chest and hips rotating through to a full finish so the body, not the hands, delivers the club.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['keep rotating through impact', 'body delivers, not the hands'],
    related: ['fs.transition.early-extension', 'fs.finish.chicken-wing', 'contact.compression'],
    source: 'swing-mechanics',
  },

  // ── FINISH ───────────────────────────────────────────────────────────────
  {
    id: 'fs.finish.hanging-back',
    layer: 'full_swing',
    module: MODULE,
    topic: 'finish — hanging back',
    aliases: ['hanging back', 'weight stays on back foot', 'falling back', 'not getting to my front side'],
    principle:
      'Finishing with weight still on the trail foot moves the low point behind the ball (fat, thin, weak high shots). Get pressure to the lead side early and finish balanced over the front foot with the trail heel up.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['pressure to the lead side', 'finish over the front foot', 'trail heel up, belt buckle to target'],
    related: ['contact.compression', 'fs.finish.balance'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.finish.chicken-wing',
    layer: 'full_swing',
    module: MODULE,
    topic: 'finish — chicken wing',
    aliases: ['chicken wing', 'lead arm collapses', 'breaking down through impact', 'bent lead elbow at impact'],
    principle:
      'The chicken wing is the lead elbow bending and pulling in through impact to bail out the face — it kills extension, speed and compression and is usually a downstream rescue for an early-extension or stall. Extend both arms toward the target after impact.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['extend both arms past the ball', 'keep the lead arm long through impact'],
    related: ['fs.transition.early-extension', 'fs.transition.stall'],
    source: 'swing-mechanics',
  },
  {
    id: 'fs.finish.balance',
    layer: 'full_swing',
    module: MODULE,
    topic: 'finish — balance',
    aliases: ['off balance', 'losing my balance', 'falling over after the swing', 'cant hold my finish'],
    principle:
      'A balanced, held finish is the tell-tale of a sequenced swing — if you can’t hold it, something earlier was over-effort or out of sequence. Swing at an effort you can finish in balance; balance is a feedback signal, not just a pose.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['hold the finish for three seconds', 'swing to a balance you can hold'],
    related: ['fs.finish.hanging-back', 'psych.over-control'],
    source: 'swing-mechanics',
  },
];
