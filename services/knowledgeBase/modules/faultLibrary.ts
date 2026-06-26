/**
 * FAULT LIBRARY — golf-knowledge module (broad-world fault taxonomy).
 *
 * This is the KNOWLEDGE layer (sourced from established instruction + famous
 * coaches), NOT the app's own per-swing detector output. It COMPLEMENTS
 * services/knowledgeBase/modules/fullSwing.ts (the 14 motion-phase entries) by
 * naming the common MID/HIGH-HANDICAP miss-killers the way a PLAYER describes
 * them ("i keep slicing", "i hit it fat", "i shank it") and tying each one back
 * to its earliest root cause + a growth-coaching fix progression + the go-to
 * drill (see ./drills.ts). It references fullSwing/setup/contact/ballFlight ids
 * in `related[]` rather than re-defining those motion entries.
 *
 * HONESTY (the #1 law). Two tiers:
 *   - The app's REAL detected faults (over-the-top, sway, slide, casting,
 *     early-extension, chicken-wing, reverse-pivot, thin, fat, steep — from
 *     api/swing-analysis.ts + services/swingIssueClassifier.ts) → 'directional'
 *     with appSignals ['pose_biomech']: pose sees them ROUGHLY, never precisely.
 *   - Everything broader the app does NOT measure (slice/hook curve amount,
 *     shank, pop-up, scoop, grip strength, the FEELS and FIXES) → 'coaching_only'
 *     unless a real signal genuinely backs it. We UNDER-CLAIM. We never invent a
 *     measurement.
 *
 * GROWTH model: every fault carries the FIRST-DOMINO tie-in (fix the earliest
 * cause and the downstream faults resolve) and an encouraging fix progression
 * (first step → next step). Never "you're broken" — "here's the one thing that
 * unlocks the rest."
 *
 * Pure data — no React, no Node, importable client AND server.
 */

import type { KBEntry } from '../schema';

const MODULE = 'fault_library';

export const FAULT_LIBRARY: KBEntry[] = [
  // ══ THE BIG MISS-KILLERS (curved shots) ══════════════════════════════════
  {
    id: 'fault.slice',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'slice — ball curves hard right (for a righty)',
    aliases: ['slice', 'i keep slicing', 'i slice everything', 'ball curves right', 'banana ball', 'big slice', 'i slice my driver'],
    principle:
      'A slice is the face being OPEN to the swing path at impact — the ball starts left-ish and curves hard right (for a righty). The modern ball-flight law: the face sets where it STARTS, the path-to-face gap sets the CURVE. The root is almost always an open face plus an over-the-top, out-to-in path — so the first domino is usually grip/face, then path. Start by strengthening a weak grip (see two knuckles) and squaring the face; the slice shrinks before you ever touch the path.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: check grip — see two knuckles of the lead hand, fix a weak grip',
      'next: square the face — back of lead hand to target through impact',
      'then path: feel the club drop to the inside, swing out to right field',
      'feel: the toe of the club passing your hands releases the face',
    ],
    related: ['fault.weak-grip', 'fault.over-the-top', 'fs.transition.over-the-top', 'bf.face-to-path', 'setup.grip.neutral', 'drill.split-hand-grip', 'drill.alignment-gate'],
    source: 'ball-flight-laws / Trackman-FlightScope / Harmon anti-slice',
  },
  {
    id: 'fault.hook',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'hook — ball curves hard left (for a righty)',
    aliases: ['hook', 'i hook it', 'ball curves left', 'snap hook', 'duck hook', 'i keep hooking', 'big draw turns into a hook'],
    principle:
      'A hook is the face being CLOSED to the path at impact — the ball curves hard left (for a righty). It is the slicer\'s opposite and often the slicer\'s over-correction: a too-strong grip plus an excessively in-to-out path. First domino is usually grip — weaken an over-strong grip toward neutral; then quiet the in-to-out path so it isn\'t fighting a shut face.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: check grip — a snap hook usually rides a too-strong grip; rotate toward neutral',
      'next: calm the path — stop swinging so far out to the right',
      'feel: keep the chest rotating through so the hands don\'t flip the face shut',
    ],
    related: ['fault.strong-grip', 'fs.transition.stall', 'bf.face-to-path', 'setup.grip.neutral', 'drill.alignment-gate'],
    source: 'ball-flight-laws / Leadbetter',
  },
  {
    id: 'fault.pull',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'pull — ball flies straight left (for a righty)',
    aliases: ['pull', 'i pull it left', 'pulling everything left', 'straight left', 'i keep pulling'],
    principle:
      'A pull flies straight left (for a righty) — the face and path BOTH point left of target (square to each other, so little curve). It\'s the over-the-top swing\'s straight cousin: the club comes across the ball from out-to-in with the face matching the path. The fix is the same first domino as the slice — start the downswing from the ground up so the path stops cutting across.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['ground-up transition, not arms-first', 'feel the club drop to the inside', 'swing out toward right field'],
    related: ['fault.over-the-top', 'fs.transition.over-the-top', 'bf.face-to-path', 'drill.pump-transition'],
    source: 'ball-flight-laws',
  },
  {
    id: 'fault.push',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'push — ball flies straight right (for a righty)',
    aliases: ['push', 'i push it right', 'pushing everything right', 'straight right', 'block'],
    principle:
      'A push flies straight right (for a righty) — face and path both point right of target. It often comes from the body stalling and the club getting stuck behind, or early extension that traps the arms. Keep rotating through so the path isn\'t left way out to the right, and hold your posture so the arms have room.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['keep the chest rotating through impact', 'hold your tilt — don\'t stand up and trap the arms'],
    related: ['fault.early-extension', 'fs.transition.stall', 'fs.transition.early-extension', 'bf.face-to-path'],
    source: 'ball-flight-laws',
  },

  // ══ CONTACT FAULTS (the score-killers) ═══════════════════════════════════
  {
    id: 'fault.fat',
    layer: 'contact',
    module: MODULE,
    topic: 'fat / chunk — club hits ground before the ball',
    aliases: ['fat', 'i hit it fat', 'chunk', 'chunking it', 'hitting behind the ball', 'heavy', 'i keep hitting it fat', 'fat shot'],
    principle:
      'A fat (chunk) shot is the club bottoming out BEHIND the ball — the low point is too far back, so you hit ground first and the strike dies. The root is usually weight hanging on the trail foot (or a reverse pivot) so the swing\'s low point never moves forward. First domino: get pressure to the lead side early. The towel-behind-the-ball drill makes it physical — miss the towel, flush the ball.',
    appSignals: ['pose_biomech', 'acoustic_strike'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: get to your front side — pressure into the lead foot by the time hands reach hip height',
      'next: feel the low point AHEAD of the ball — ball first, then turf',
      'feel: brush a divot that starts at the target side of the ball',
    ],
    related: ['fault.hanging-back', 'fault.reverse-pivot', 'fs.finish.hanging-back', 'contact.low-point', 'setup.ball-position', 'drill.towel-behind-ball', 'drill.low-point-line', 'drill.step-through'],
    source: 'low-point-control / Hogan ball-first contact',
  },
  {
    id: 'fault.thin',
    layer: 'contact',
    module: MODULE,
    topic: 'thin / top — club catches the ball\'s equator',
    aliases: ['thin', 'i hit it thin', 'top', 'topping it', 'i keep topping it', 'skulled it', 'bladed it', 'thin shot', 'topped'],
    principle:
      'Thin/topped shots catch the upper half of the ball — the low point is too HIGH or too far forward, often because the body stood up out of posture (early extension) or the weight hung back and the club caught it on the way up. Counter-intuitively, topping is rarely "lifting your head" — it\'s usually early extension or a back-weighted low point. Hold your posture and get forward; the same low-point work that cures fat cures thin.',
    appSignals: ['pose_biomech', 'acoustic_strike'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: hold your tilt — keep your chest down through the ball, don\'t stand up',
      'next: get to your front side so the low point moves forward, not up',
      'feel: trust the loft — try to hit the back-bottom of the ball',
    ],
    related: ['fault.early-extension', 'fault.hanging-back', 'fs.transition.early-extension', 'contact.low-point', 'drill.low-point-line', 'drill.divot-board'],
    source: 'low-point-control',
  },
  {
    id: 'fault.shank',
    layer: 'contact',
    module: MODULE,
    topic: 'shank — strike off the hosel, shoots dead right',
    aliases: ['shank', 'i shank it', 'shanks', 'hosel rocket', 'off the hosel', 'i keep shanking', 'shanking', 'lateral'],
    principle:
      'A shank strikes the hosel (the neck where shaft meets head), firing the ball dead right and low — the most confidence-rattling miss in golf, and almost always a fixable contact issue, NOT a swing you have to rebuild. The club is reaching the ball too far from the body: usually early extension (hips thrust toward the ball) or the weight moving onto the toes. The cure is room and balance — keep your weight in your heels and your tilt, and the strike moves back to center.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: feel pressure in your heels, not rolling onto your toes',
      'next: hold your tilt and trail glute back — early extension pushes the hosel into the ball',
      'reframe: a shank is a near-miss of a great strike, not a broken swing — one setup tweak usually clears it',
      'drill: hit balls off the toe of the club for a few swings to re-center contact',
    ],
    related: ['fault.early-extension', 'fault.standing-too-close', 'fs.transition.early-extension', 'setup.distance-from-ball', 'contact.dispersion-centroid', 'drill.toe-gate', 'drill.heels-pressure'],
    source: 'contact / early-extension lineage',
  },
  {
    id: 'fault.pop-up',
    layer: 'contact',
    module: MODULE,
    topic: 'pop-up — sky-high weak driver, often a sky mark',
    aliases: ['pop up', 'pop-up', 'i pop up my driver', 'sky ball', 'sky mark', 'popping it straight up', 'hitting under the ball', 'skying it'],
    principle:
      'A driver pop-up (sky ball) is too STEEP an angle of attack with the driver — you swing down on a ball you\'re meant to catch on the up, contacting the top edge of the face (the white sky-mark gives it away). Roots: ball too far back, too high a tee, or an over-the-top steep chop. Tee it so half the ball is above the crown, move it off the lead heel, and feel the driver SWEEP up, not down.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: tee height + ball position — half the ball above the crown, off the lead heel',
      'next: feel the driver catch the ball on the UP, sweeping not chopping',
      'feel: tilt your spine slightly away from target at address so you hit up',
    ],
    related: ['fault.steep', 'fault.over-the-top', 'setup.ball-position', 'drill.tee-sweep'],
    source: 'driver setup / attack-angle',
  },

  // ══ THE APP-DETECTED MOTION FAULTS (player-language entries) ══════════════
  // These restate the app's REAL detected faults in plain "what a player says"
  // language and tie them to the first domino. The mechanism detail lives in
  // fullSwing.ts (referenced in related[]); here = symptom→root→progression.
  {
    id: 'fault.over-the-top',
    layer: 'full_swing',
    module: MODULE,
    topic: 'over the top — the slice/pull engine',
    aliases: ['over the top', 'coming over the top', 'outside in', 'i come over the top', 'casting over the top', 'my downswing comes across'],
    principle:
      'Over-the-top is the club starting down OUTSIDE the plane so it cuts across the ball — the #1 amateur engine for slices and pulls. It\'s a SYMPTOM: the upper body and arms fire first instead of the ground-up sequence. The first domino is the transition order — start down with lead-foot pressure and hips, let the club drop to the inside. Fix the sequence and the slice, pull and steep strike all calm down together.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: ground-up start — pressure to the lead foot, then hips, then arms',
      'next: feel the club DROP behind you (shallow) as the lower body opens',
      'feel: swing out toward right field; the headcover/pump drill teaches the inside path',
    ],
    related: ['fault.slice', 'fault.pull', 'fs.transition.over-the-top', 'fs.architecture.shoulder-turn', 'drill.pump-transition', 'drill.headcover-path-gate', 'drill.split-hand-grip'],
    source: 'over-the-top lineage / Harmon / Leadbetter',
  },
  {
    id: 'fault.casting',
    layer: 'full_swing',
    module: MODULE,
    topic: 'casting / scooping — throwing the lag away early',
    aliases: ['casting', 'scooping', 'i scoop it', 'throwing away lag', 'losing lag', 'early release', 'flipping at impact', 'adding loft'],
    principle:
      'Casting is releasing the wrist hinge too early from the top, throwing the clubhead out and away — it bleeds speed, adds loft, and scatters low point (weak high shots, fat and thin). The scoop is its impact face: hands flipping to lift the ball instead of compressing it. First domino: let the lower body lead so the club SHALLOWS while the wrists hold — then train hands-ahead at impact.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: lower body leads the downswing — the club shallows instead of throwing',
      'next: feel the handle leading the clubhead into impact (hands ahead, shaft leaning forward)',
      'reframe: you don\'t lift the ball — the loft does; trust it and compress',
    ],
    related: ['fault.thin', 'fault.fat', 'fs.transition.casting', 'contact.compression', 'drill.pump-transition', 'drill.impact-bag', 'drill.split-hand-grip'],
    source: 'casting / lag lineage',
  },
  {
    id: 'fault.early-extension',
    layer: 'full_swing',
    module: MODULE,
    topic: 'early extension — standing up out of the shot',
    aliases: ['early extension', 'standing up out of the shot', 'losing posture', 'hips thrust toward the ball', 'losing my spine angle', 'standing up'],
    principle:
      'Early extension is the hips thrusting toward the ball and the spine standing up through impact — it steals the room the arms need, causing blocks, hooks, thins and shanks. It\'s an early-causal fault: fix it and a cluster of strike misses resolves. First domino: keep the trail glute back and hold your forward tilt as you rotate through, so you make room for the arms instead of crowding them out.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: feel your trail glute (butt cheek) stay back against an imaginary wall',
      'next: rotate the hips AROUND, not toward the ball — hold the tilt',
      'feel: keep your chest covering the ball through impact',
    ],
    related: ['fault.shank', 'fault.thin', 'fault.push', 'fs.transition.early-extension', 'setup.posture', 'drill.wall-butt-back', 'drill.pump-transition'],
    source: 'early-extension lineage / GolfTec data',
  },
  {
    id: 'fault.reverse-pivot',
    layer: 'full_swing',
    module: MODULE,
    topic: 'reverse pivot — weight backward on the way down',
    aliases: ['reverse pivot', 'weight goes the wrong way', 'falling back', 'weight on lead foot at top', 'i lean toward the target going back'],
    principle:
      'A reverse pivot is weight loading onto the LEAD foot in the backswing (spine tilting toward target at the top), then falling back to the trail foot through impact — exactly backwards. It robs power and is a prime cause of fat, thin and weak contact. First domino: load INTO the trail side going back (feel pressure in the trail heel at the top), then shift forward to start down. The step-through drill bakes the correct weight flow in.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: load into the trail side going back — pressure in the trail heel at the top',
      'next: start down by pressing into the LEAD foot, then rotate',
      'feel: spine tilts slightly AWAY from target at the top, not toward it',
    ],
    related: ['fault.fat', 'fault.thin', 'fault.sway', 'fs.finish.hanging-back', 'drill.step-through', 'drill.feet-together'],
    source: 'reverse-pivot lineage',
  },
  {
    id: 'fault.sway',
    layer: 'full_swing',
    module: MODULE,
    topic: 'sway — hips slide off the ball going back',
    aliases: ['sway', 'i sway', 'sliding off the ball', 'swaying off it', 'hips slide back going back', 'lateral move back'],
    principle:
      'A sway is the hips sliding laterally AWAY from the target in the backswing instead of rotating in place — it moves the swing\'s center off the ball, so the low point becomes a moving target (fat, thin, inconsistent). The fix is rotation over translation: turn into a stable trail leg without the hip drifting outside the foot. First domino is the backswing load — coil against the trail leg, keep pressure on its inside.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: TURN into the trail leg, don\'t slide — keep the hip inside the trail foot',
      'next: feel pressure on the INSIDE of the trail foot at the top, not the outside',
      'drill: an alignment stick / wall just outside the trail hip catches a sway',
    ],
    related: ['fault.slide', 'fault.reverse-pivot', 'fault.fat', 'fs.architecture.shoulder-turn', 'drill.trail-hip-wall', 'drill.feet-together'],
    source: 'sway/slide lineage / golf-fitness',
  },
  {
    id: 'fault.slide',
    layer: 'full_swing',
    module: MODULE,
    topic: 'slide — hips slide toward target instead of rotating',
    aliases: ['slide', 'i slide', 'sliding toward the target', 'hips slide through', 'lateral slide downswing', 'too much lateral'],
    principle:
      'A slide is the downswing version of a sway — the hips drive laterally toward the target instead of rotating, so the body gets ahead of the ball, the face stays open and you push/block or flip to save it. A LITTLE lateral shift to start down is good; a slide is when it never turns into rotation. First domino: shift a touch, then ROTATE — the lead hip clears around, it doesn\'t keep sliding past.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: small lateral bump to start down, then the lead hip ROTATES around behind you',
      'next: feel the belt buckle turn to face the target — not slide past it',
      'drill: a wall / stick just outside the lead hip stops the slide and trains rotation',
    ],
    related: ['fault.sway', 'fault.push', 'fault.early-extension', 'fs.transition.stall', 'drill.lead-hip-wall', 'drill.step-through'],
    source: 'sway/slide lineage',
  },
  {
    id: 'fault.chicken-wing',
    layer: 'full_swing',
    module: MODULE,
    topic: 'chicken wing — lead elbow bends and bails at impact',
    aliases: ['chicken wing', 'lead arm collapses', 'bent lead elbow at impact', 'my arm breaks down', 'i chicken wing it', 'elbow flies out through impact'],
    principle:
      'The chicken wing is the lead elbow bending and pulling IN through impact to bail out an open face — it kills extension, speed and compression and usually scatters strike. It\'s a downstream RESCUE move: the body stalled or stood up, so the arm flinches to square the face. First domino is upstream (keep rotating / hold posture); then train both arms extending long down the target line after impact.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: fix the cause — keep the body rotating, don\'t stall or stand up',
      'next: feel both arms EXTEND toward the target past the ball — long arms, tall finish',
      'drill: lead-hand-only swings teach the arm to stay long',
    ],
    related: ['fault.early-extension', 'fs.finish.chicken-wing', 'fs.transition.stall', 'drill.one-handed', 'drill.towel-under-arms'],
    source: 'chicken-wing / connection lineage',
  },
  {
    id: 'fault.steep',
    layer: 'full_swing',
    module: MODULE,
    topic: 'steep — chopping down too much, deep divots after the ball',
    aliases: ['steep', 'too steep', 'i chop down on it', 'deep divots', 'digging', 'steep angle of attack', 'coming down too steep'],
    principle:
      'A steep angle of attack is the club descending too sharply into the ball — deep divots, ballooning irons, and with the driver, pop-ups. It usually rides an over-the-top or upright move. The cure is SHALLOWING: let the club drop behind you as the lower body starts down, so it approaches from the inside on a shallower path. The pump drill is the go-to feel.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: feel the club drop/shallow behind you as the lower body starts down',
      'next: brush the grass after the ball — sweep, don\'t dig',
      'feel: trail elbow leads into the slot, club approaches from the inside',
    ],
    related: ['fault.over-the-top', 'fault.pop-up', 'fs.transition.over-the-top', 'fs.transition.casting', 'drill.pump-transition', 'drill.headcover-path-gate'],
    source: 'attack-angle / shallowing lineage',
  },
  {
    id: 'fault.hanging-back',
    layer: 'full_swing',
    module: MODULE,
    topic: 'hanging back — weight stuck on the trail foot at impact',
    aliases: ['hanging back', 'weight on back foot', 'falling back', 'not getting through', 'cant get to my front side', 'weight stays back'],
    principle:
      'Hanging back is finishing with weight still on the trail foot — the low point stays behind the ball, producing fat, thin and weak high shots, and it commonly chases scooping. First domino: get pressure to the lead side EARLY (by hip-height in the downswing) and finish balanced over the front foot. The step-through drill makes the forward shift unavoidable.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: pressure to the lead foot by the time the hands reach hip height',
      'next: finish over the front foot — trail heel up, belt buckle to target',
      'feel: post up on the lead leg through impact',
    ],
    related: ['fault.fat', 'fault.thin', 'fault.casting', 'fault.reverse-pivot', 'fs.finish.hanging-back', 'drill.step-through', 'drill.impact-bag'],
    source: 'weight-transfer lineage',
  },

  // ══ SETUP-ROOT FAULTS (P5 — fix the input first) ═════════════════════════
  {
    id: 'fault.weak-grip',
    layer: 'setup',
    module: MODULE,
    topic: 'weak grip — hands rotated toward target, face leaks open',
    aliases: ['weak grip', 'my grip is too weak', 'face stays open', 'cant square the face', 'hands too far left on the grip'],
    principle:
      'A weak grip (hands rotated toward the target, fewer than two knuckles showing) defaults the face OPEN — a leading cause of the chronic slice and the inability to release. It\'s a P5 root input: fixing it can clear a slice without touching the swing. Rotate both hands slightly away from the target until you see about two knuckles of the lead hand and the V\'s point to the trail shoulder.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['rotate the hands away from target until you see two knuckles', "V\'s point to the trail shoulder", 'a stronger grip is the simplest anti-slice move there is'],
    related: ['fault.slice', 'setup.grip.neutral', 'bf.face-to-path', 'bf.start-direction-face', 'drill.split-hand-grip'],
    source: 'grip fundamentals / Hogan / Harmon',
  },
  {
    id: 'fault.strong-grip',
    layer: 'setup',
    module: MODULE,
    topic: 'strong grip — hands rotated away, face shuts',
    aliases: ['strong grip', 'my grip is too strong', 'i hook because of my grip', 'hands too far right on the grip', 'face shuts down'],
    principle:
      'A too-strong grip (hands rotated well away from target, three-plus knuckles showing) defaults the face CLOSED — a leading cause of the chronic hook and a low, left miss. It\'s often a slicer\'s over-correction that went too far. Ease both hands back toward neutral (about two knuckles) so the face isn\'t fighting to stay shut.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['ease the hands back toward neutral — about two knuckles', "V\'s to the trail shoulder, not past it", 'let the face be neutral so you stop snap-hooking'],
    related: ['fault.hook', 'setup.grip.neutral', 'bf.face-to-path', 'bf.start-direction-face'],
    source: 'grip fundamentals',
  },
  {
    id: 'fault.poor-aim',
    layer: 'setup',
    module: MODULE,
    topic: 'misalignment — aiming the body where the swing can\'t go',
    aliases: ['aim', 'i aim wrong', 'i line up wrong', 'always aimed right', 'always aimed left', 'my alignment is off', 'i cant aim'],
    principle:
      'Most "swing" misses are really an AIM error — the body points somewhere the target isn\'t, and the swing either obeys (and misses) or compensates (and gets weird). It\'s a P5 root: a player aimed 20 yards right who "pulls it back" has a perfect swing producing a bad result. Aim the FACE at the target first, then set feet/hips/shoulders parallel-left on a railroad track, using an intermediate spot a foot ahead.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['face to target FIRST, then the body parallel-left', 'pick an intermediate spot a foot in front of the ball', 'lay a club down on the range to see your true aim'],
    related: ['setup.alignment', 'fault.pull', 'fault.push', 'cm.commitment', 'drill.alignment-gate'],
    source: 'setup fundamentals / Hogan',
  },
  {
    id: 'fault.ball-position',
    layer: 'setup',
    module: MODULE,
    topic: 'ball position — wrong spot moves your low point',
    aliases: ['ball position', 'ball too far forward', 'ball too far back', 'where do i play the ball', 'my ball position is off'],
    principle:
      'Ball position moves where the club bottoms out. Too far back delofts and steepens (low, pushed, fat); too far forward adds loft and catches it late (thin, pulled, popped-up). It\'s a P5 root that masquerades as a strike fault. Driver forward off the lead heel (catch it up), irons progressively back toward center for ball-first contact, wedges near center.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['driver off the lead heel', 'irons toward center', 'wedges center', 'a strike fault that won\'t fix is often a ball-position fault'],
    related: ['fault.fat', 'fault.thin', 'fault.pop-up', 'setup.ball-position', 'contact.ball-position-calibration'],
    source: 'setup fundamentals',
  },
  {
    id: 'fault.posture',
    layer: 'setup',
    module: MODULE,
    topic: 'poor posture — slumped or too upright at address',
    aliases: ['posture', 'my posture is bad', 'i stand wrong', 'slumped over the ball', 'too upright', 'rounded back'],
    principle:
      'Posture is the platform the whole swing rotates on. Slumped (rounded back) or too upright (no tilt) both rob the body of room to turn, forcing the arms to take over and inviting early extension. It\'s a P5 root. Tilt from the HIPS with a straight (not stiff) back, let the arms hang under the shoulders, soft knees, balanced over the middle of the feet.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['hinge from the hips, not the waist', 'arms hang free under the shoulders', 'athletic and balanced, ready to move'],
    related: ['fault.early-extension', 'fault.standing-too-close', 'setup.posture', 'fs.transition.early-extension'],
    source: 'setup fundamentals',
  },
  {
    id: 'fault.standing-too-close',
    layer: 'setup',
    module: MODULE,
    topic: 'crowding / reaching — wrong distance from the ball',
    aliases: ['standing too close', 'standing too far', 'too close to the ball', 'reaching for the ball', 'crowding the ball', 'distance from the ball'],
    principle:
      'Standing the wrong distance from the ball forces a compensation: too close crowds the arms and steepens the swing (toe contact, shanks); too far makes you reach and lunge (heel contact, loss of balance). Let posture set it — arms hang naturally with about a hand-width between hands and body, not reaching, not jammed.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['a hand-width between the hands and your body', 'let the arms hang — don\'t reach', 'posture sets the distance, not your reach'],
    related: ['fault.shank', 'fault.posture', 'setup.distance-from-ball', 'contact.dispersion-centroid'],
    source: 'setup fundamentals',
  },

  // ══ TEMPO / SEQUENCE (the honest-signal one) ═════════════════════════════
  {
    id: 'fault.rushed-tempo',
    layer: 'full_swing',
    module: MODULE,
    topic: 'rushed tempo — quick from the top, out of sequence',
    aliases: ['rushed tempo', 'i swing too fast', 'too quick from the top', 'i rush it', 'no rhythm', 'quick transition', 'i swing too hard'],
    principle:
      'Rushing the transition — going hard from the top before the backswing finishes — throws the sequence off (the arms beat the body), which is the seed of over-the-top, casting and a lost low point. Tempo is the ratio of backswing to downswing time; tour players cluster near a smooth 3-to-1. Smooth doesn\'t mean slow — it means UNHURRIED at the top so the body can lead. Swing to a balance you can hold.',
    appSignals: ['pose_tempo'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: feel a complete, unhurried top before you start down',
      'next: let the lower body begin while the club is still finishing back',
      'feel: smooth back, smooth down, hold a balanced finish for three seconds',
    ],
    related: ['fault.over-the-top', 'fault.casting', 'fault.reverse-pivot', 'fs.finish.balance', 'drill.pause-at-top', 'drill.feet-together'],
    source: 'tempo lineage / Tour Tempo 3:1',
  },
];
