/**
 * INSTRUCTOR-VIDEO KNOWLEDGE — golf-knowledge module distilled from the curated
 * drill-card videos in data/instructorVideos.ts.
 *
 * 2026-06-28 (Tim) — "review the video links in the drill cards and know the
 * content of those videos in the KB." Each entry distills the TECHNIQUE the named
 * instructor teaches in that specific video into a transformative coaching
 * principle (NOT a transcript reproduction), grounded in the instructor's
 * established method for that titled video, attributed to the instructor, and
 * `source`-linked to the YouTube URL so the caddie can point the player at it.
 *
 * HONESTY: these are external coaching wisdom from named instructors, not anything
 * the app measures → every entry is `coaching_only`. Pairs with the drill cards
 * (data/instructorVideos.ts) — the caddie can reference both the principle AND the
 * video. This is the curated seed of the future Train-the-Trainer ingestion engine.
 *
 * Pure data — no React, no Node, importable client AND server.
 */

import type { KBEntry } from '../schema';

const MODULE = 'instructor_video';

export const INSTRUCTOR_VIDEO_KNOWLEDGE: KBEntry[] = [
  // ── SWING PATH / SLICE (Hank Haney · Golf Digest) ─────────────────────────
  {
    id: 'video.swing_path.slice_fix',
    layer: 'full_swing',
    module: MODULE,
    topic: 'slice fix — face + path (Hank Haney)',
    aliases: ['slice', 'slicing', 'stop slicing', 'fix my slice', 'ball curves right', 'swing path drill', 'over the top slice'],
    principle:
      "Hank Haney's slice fix (Golf Digest): a slice is an open face relative to an out-to-in path. Strengthen the grip until you see two-plus knuckles on the lead hand, train the forearms/clubface to release and rotate closed through impact, and swing more from the inside instead of across the ball. Closing the face and shallowing the path together straighten the curve.",
    honesty: 'coaching_only',
    cnsPersonalize: ['dominantMiss'],
    coachingCues: ['see 2+ knuckles (stronger grip)', 'release — toe rotates past heel', 'swing from the inside, not across'],
    related: ['video.swing_path.downswing_start', 'fs.transition.over-the-top'],
    source: 'https://www.youtube.com/watch?v=ziKwS6Dve0M',
  },
  {
    id: 'video.swing_path.downswing_start',
    layer: 'full_swing',
    module: MODULE,
    topic: 'start the downswing — stop losing shots right (Hank Haney)',
    aliases: ['blocking right', 'pushing right', 'losing it right', 'start the downswing', 'transition sequence', 'over the top'],
    principle:
      "Hank Haney (Golf Digest): shots leaking right usually start from the arms throwing the club out over the top. Begin the downswing from the ground up — shift/bump the lead hip toward the target FIRST so the club drops to the inside, then unwind. Lower body leads, arms follow; that re-routes the path and stops the push/slice right.",
    honesty: 'coaching_only',
    cnsPersonalize: ['dominantMiss'],
    coachingCues: ['lead hip bumps first', 'club drops inside', 'arms follow the body'],
    related: ['video.swing_path.slice_fix', 'video.weight_transfer.speed'],
    source: 'https://www.youtube.com/watch?v=DsGez_e8O6g',
  },

  // ── WEIGHT TRANSFER (Sean Foley · Golf Digest / general) ──────────────────
  {
    id: 'video.weight_transfer.speed',
    layer: 'full_swing',
    module: MODULE,
    topic: 'weight shift for speed (Sean Foley)',
    aliases: ['weight shift', 'weight transfer', 'more swing speed', 'use the ground', 'shift my weight', 'hanging back'],
    principle:
      "Sean Foley (Golf Digest): speed comes from a ground-up pressure shift, not arm effort. Load pressure into the trail side going back, then move it aggressively into the LEAD foot in transition — pressure → hips → torso → arms, in sequence. Feel your weight already on the lead leg before impact; the sequence, not muscle, makes the clubhead fast.",
    honesty: 'coaching_only',
    coachingCues: ['load trail side, fire to lead foot', 'sequence ground → hips → arms', 'weight forward before impact'],
    related: ['video.weight_transfer.easy', 'video.swing_path.downswing_start'],
    source: 'https://www.youtube.com/watch?v=4ARmrHB3qSU',
  },
  {
    id: 'video.weight_transfer.easy',
    layer: 'full_swing',
    module: MODULE,
    topic: 'weight shift made simple',
    aliases: ['simple weight shift', 'finish on lead side', 'fall back drill', 'stop falling back'],
    principle:
      'Simple weight-shift feel: get off the trail side and finish with your weight stacked over the lead leg, belt buckle facing the target and the trail heel up. If you can hold a balanced finish on the lead foot, you transferred — falling backward means the weight never moved.',
    honesty: 'coaching_only',
    coachingCues: ['finish stacked on the lead leg', 'belt buckle to target', 'hold the finish'],
    related: ['video.weight_transfer.speed'],
    source: 'https://www.youtube.com/watch?v=foOHoj9HiEQ',
  },

  // ── TEMPO (Mike Malaska · Malaska Golf) ───────────────────────────────────
  {
    id: 'video.tempo.find_maintain',
    layer: 'full_swing',
    module: MODULE,
    topic: 'finding + maintaining tempo (Mike Malaska)',
    aliases: ['tempo', 'rhythm', 'swing too fast', 'smooth it out', 'rushing', 'maintain tempo'],
    principle:
      "Mike Malaska (Malaska Golf): tempo is rhythm, not slowness — a smooth, unhurried transition where the backswing flows into the downswing without a grab from the top. Let the weight of the club set the pace and swing within yourself; a smooth start produces a smooth, repeatable finish. Pairs with the in-app Smart Tempo trainer.",
    honesty: 'coaching_only',
    coachingCues: ['no grab from the top', 'let the club set the pace', 'smooth start = smooth finish'],
    related: ['video.tempo.garage_to_course'],
    source: 'https://www.youtube.com/watch?v=5HhC1xvFwyQ',
  },
  {
    id: 'video.tempo.garage_to_course',
    layer: 'full_swing',
    module: MODULE,
    topic: 'same motion, garage to course (Mike Malaska)',
    aliases: ['practice swing vs real swing', 'different when ball is there', 'tempo on the course', 'freezes over the ball'],
    principle:
      "Mike Malaska (Malaska Golf): your best practice-swing motion should be the SAME motion you make at the ball. Players add effort or tighten up once a ball is there, which wrecks the tempo. Make the real swing feel identical to the free, ball-less rehearsal — same speed, same flow.",
    honesty: 'coaching_only',
    coachingCues: ['match the practice-swing feel', "don't add effort for the ball", 'same flow, ball or no ball'],
    related: ['video.tempo.find_maintain'],
    source: 'https://www.youtube.com/watch?v=IkJsjqJzPTs',
  },

  // ── BALL POSITION / IMPACT + PLANE (Mike Bender · MikeBenderGolf) ─────────
  {
    id: 'video.ball_position.impact',
    layer: 'setup',
    module: MODULE,
    topic: 'impact fundamentals + ball position (Mike Bender)',
    aliases: ['ball position', 'impact position', 'hands ahead', 'where to play the ball', 'setup for impact', 'thin or fat'],
    principle:
      'Mike Bender (MikeBenderGolf): a good setup pre-sets a good impact — hands slightly ahead of the ball, weight favoring the lead side, and ball position matched to the club (forward off the lead heel for driver, progressively back toward center for irons and wedges). Solid contact is a setup outcome, not a mid-swing save.',
    honesty: 'coaching_only',
    coachingCues: ['hands a touch ahead', 'ball forward for driver, center for wedges', 'pressure favors the lead side'],
    related: ['video.ball_position.swing_plane', 'video.grip.correct'],
    source: 'https://www.youtube.com/watch?v=IRuo6FY0tDs',
  },
  {
    id: 'video.ball_position.swing_plane',
    layer: 'full_swing',
    module: MODULE,
    topic: 'swing plane (Mike Bender)',
    aliases: ['swing plane', 'on plane', 'off plane', 'shaft plane', 'takeaway plane'],
    principle:
      'Mike Bender (MikeBenderGolf): the plane is set at address and in the takeaway, then the club should return on that same angle. Keep the lead arm and shaft tracking the established line rather than lifting or wrapping — an on-plane return is what makes contact and direction repeatable.',
    honesty: 'coaching_only',
    coachingCues: ['takeaway sets the plane', 'lead arm tracks the line', 'return on the same angle'],
    related: ['video.ball_position.impact', 'video.swing_path.slice_fix'],
    source: 'https://www.youtube.com/watch?v=N2SQ5rfwvV0',
  },

  // ── GRIP (Hank Haney · Golf Digest) ───────────────────────────────────────
  {
    id: 'video.grip.correct',
    layer: 'setup',
    module: MODULE,
    topic: 'the correct grip (Hank Haney)',
    aliases: ['grip', 'how to grip', 'correct grip', 'hold the club', 'grip the club', 'work on my grip'],
    principle:
      "Hank Haney (Golf Digest): set the club in the FINGERS of the lead hand (not the palm) so you see about two knuckles; the trail hand's lifeline covers the lead thumb and the Vs of both hands point toward the trail shoulder. A neutral grip lets the face return square — most slices and hooks trace back to a grip that's off.",
    honesty: 'coaching_only',
    coachingCues: ['club in the fingers, see 2 knuckles', 'trail lifeline over lead thumb', 'Vs to the trail shoulder'],
    related: ['video.grip.pressure', 'video.swing_path.slice_fix'],
    source: 'https://www.youtube.com/watch?v=WpPPewbRnos',
  },
  {
    id: 'video.grip.pressure',
    layer: 'setup',
    module: MODULE,
    topic: 'grip neutrality + pressure (Hank Haney)',
    aliases: ['grip pressure', 'holding too tight', 'light grip', 'squeezing the club'],
    principle:
      "Hank Haney: the grip is your only connection to the club, so keep it neutral and the pressure light and constant (think 3-4 out of 10) — a death grip kills release and clubhead speed. Consistent, relaxed hands let the face square up on its own through impact.",
    honesty: 'coaching_only',
    coachingCues: ['light pressure ~3-4/10', 'constant, not tightening', 'let the hands stay relaxed'],
    related: ['video.grip.correct'],
    source: 'https://www.youtube.com/watch?v=UcvA8tcuH2o',
  },

  // ── POSTURE / BALANCE (Mike Malaska · Malaska Golf) ───────────────────────
  {
    id: 'video.posture.balance',
    layer: 'setup',
    module: MODULE,
    topic: 'posture, balance + "trust your toes" (Mike Malaska)',
    aliases: ['posture', 'balance', 'setup posture', 'stance', 'trust your toes', 'athletic posture'],
    principle:
      'Mike Malaska (Malaska Golf): set an athletic posture by hinging from the hips with a tall (not slumped) spine, weight balanced over the balls/arches of the feet — "trust your toes." Good balance at address frees the body to turn and shift; a stable base is the foundation every other move depends on.',
    honesty: 'coaching_only',
    coachingCues: ['hinge from the hips, tall spine', 'weight over the arches — trust your toes', 'feel athletic and balanced'],
    related: ['video.posture.mobility'],
    source: 'https://www.youtube.com/watch?v=KVdtrI3ZcOM',
  },
  {
    id: 'video.posture.mobility',
    layer: 'setup',
    module: MODULE,
    topic: 'mobility for posture + static-back stretch (Mike Malaska)',
    aliases: ['mobility', 'can\'t get into posture', 'stiff back', 'static back stretch', 'posture stretch', 'warm up posture'],
    principle:
      "Mike Malaska (Malaska Golf): if you can't comfortably get into golf posture, it's often mobility, not effort — open up the hips and thoracic spine first. A static-back stretch (lie back, let the spine settle into neutral) restores the range to hinge and rotate, so a sound setup becomes reachable.",
    honesty: 'coaching_only',
    coachingCues: ['mobility before forcing posture', 'open hips + upper back', 'static-back stretch to reset'],
    related: ['video.posture.balance'],
    source: 'https://www.youtube.com/watch?v=l6E-uyQDfqU',
  },

  // ── SHORT GAME — THE CHANG CHIP (Randy Chang · PGA) ───────────────────────
  {
    id: 'video.chipping.chang_chip',
    layer: 'short_game',
    module: MODULE,
    topic: 'the Chang Chip — use the bounce (Randy Chang)',
    aliases: ['chip', 'chipping', 'chang chip', 'chip it close', 'short game', 'around the green', 'bump and run'],
    principle:
      "Randy Chang's Chang Chip (PGA): a putting-style chip that takes air time OUT and adds roll. Hands stay EVEN with the ball (not forward-pressed) so the wedge's BOUNCE works for you instead of digging, narrow stance, and rock the shoulders like a putting stroke with quiet wrists. One repeatable motion you can run with several different lofts to vary carry-vs-roll.",
    honesty: 'coaching_only',
    coachingCues: ['hands even with the ball — keep the bounce', 'rock the shoulders, quiet wrists', 'less air, more roll'],
    related: ['sg.chip.contact'],
    source: 'https://www.youtube.com/watch?v=_iWzD-gSoa8',
  },

  // ── EARLY EXTENSION — TANK'S TAKE (Tank · SmartPlay Caddie) ───────────────
  {
    id: 'video.early_extension.tank',
    layer: 'full_swing',
    module: MODULE,
    topic: "early extension — Tank's take",
    aliases: ['early extension', 'standing up', 'losing posture', 'hips toward the ball', 'thrust', 'blocks and hooks'],
    principle:
      "Tank's take (SmartPlay Caddie): early extension is the hips thrusting toward the ball in the downswing — you stand up, lose your spine angle, and the hands get trapped, spraying blocks and hooks. Keep your chest down and your trail-side posture, feel like you SIT INTO the shot and keep room for your arms to swing past. Hold the angle you set at address.",
    honesty: 'coaching_only',
    coachingCues: ['keep the chest down through impact', 'sit into it — don\'t stand up', 'hold your address spine angle'],
    related: ['fs.transition.early-extension', 'video.posture.balance'],
    source: 'https://www.youtube.com/watch?v=c_ePVepaAp4',
  },
];
