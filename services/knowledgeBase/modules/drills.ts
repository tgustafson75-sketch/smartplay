/**
 * DRILLS — golf-knowledge module (layer 'practice').
 *
 * The famous, established, high-ROI practice drills the broad golf world relies
 * on, curated and tied to the faults they fix (see ./faultLibrary.ts and
 * ./fullSwing.ts via `related[]`). This is KNOWLEDGE the caddie can prescribe,
 * NOT a list of in-app drill cards (those live in app/(tabs)/swinglab.tsx +
 * services/drillRecommendation.ts; the brain already knows those by route).
 *
 * HONESTY (the #1 law):
 *   - A drill's MECHANIC is coaching wisdom → 'coaching_only' by default.
 *   - It earns 'directional' ONLY when the app can actually read the drill's
 *     OUTCOME with a real signal: tempo via 'pose_tempo', contact/strike via
 *     'acoustic_strike', body motion via 'pose_biomech'. Even then it's a rough
 *     read, never a measurement. We UNDER-CLAIM and never invent a number.
 *
 * Each drill carries a fix PROGRESSION (first rep → next rep) and the FEEL, in
 * encouraging growth-coaching language. Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'drills';

export const DRILLS: KBEntry[] = [
  // ══ ANTI-SLICE / PATH / FACE ═════════════════════════════════════════════
  {
    id: 'drill.split-hand-grip',
    layer: 'practice',
    module: MODULE,
    topic: 'split-hand (anti-slice) drill',
    aliases: ['split hand drill', 'split grip drill', 'how do i stop slicing', 'anti slice drill', 'release drill'],
    principle:
      'Trains the face to release and the forearms to rotate — the antidote to the open-face slice. Grip a mid-iron with the trail hand 3-4 inches BELOW the lead hand (a gap between them) and make smooth three-quarter swings, letting the trail hand roll over and "throw" through impact. The split exaggerates the forearm rotation a slicer is missing. Fixes: slice, over-the-top, casting.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: slow three-quarter swings, feel the trail hand roll over the lead through impact',
      'next: rejoin your normal grip and keep that same release feel',
      'feel: the toe of the club passing your hands — that\'s the face squaring',
    ],
    related: ['fault.slice', 'fault.over-the-top', 'fault.weak-grip', 'fs.transition.over-the-top', 'bf.face-to-path'],
    source: 'Harmon / classic anti-slice',
  },
  {
    id: 'drill.headcover-path-gate',
    layer: 'practice',
    module: MODULE,
    topic: 'headcover-outside-the-ball path gate',
    aliases: ['headcover drill', 'headcover outside the ball', 'how do i stop coming over the top', 'path gate drill', 'object outside the ball'],
    principle:
      'Trains an in-to-out path and kills the over-the-top cut. Place a headcover (or a second ball) a few inches OUTSIDE and slightly behind the ball on the target line. If you come over the top, you clip the headcover; an inside path misses it cleanly. Instant, honest feedback. Fixes: over-the-top, slice, pull, steep.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: slow swings just missing the headcover from the inside',
      'next: build to full speed still missing it',
      'feel: the club approaches from behind you, swinging out to right field',
    ],
    related: ['fault.over-the-top', 'fault.slice', 'fault.pull', 'fault.steep', 'fs.transition.over-the-top'],
    source: 'over-the-top lineage',
  },
  {
    id: 'drill.pump-transition',
    layer: 'practice',
    module: MODULE,
    topic: 'pump / shallowing transition drill',
    aliases: ['pump drill', 'transition drill', 'shallowing drill', 'how do i shallow the club', 'stop casting drill'],
    principle:
      'A slow-motion rehearsal of the downswing transition that trains the club to SHALLOW (drop to the inside) as the lower body leads — curing over-the-top, casting and steep. From the top, make small "pump" motions: start the lower body, feel the club drop behind you, return to the top, repeat 15-20 times, then hit a ball keeping that feel. Fixes: over-the-top, casting, steep, early extension.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: 15-20 slow pumps — lower body starts, club drops behind you',
      'next: from the last pump, swing through and hit a ball with that feel',
      'feel: the trail elbow leads into the slot; the club shallows, not throws',
    ],
    related: ['fault.over-the-top', 'fault.casting', 'fault.steep', 'fs.transition.casting', 'fs.transition.over-the-top'],
    source: 'pump-drill lineage',
  },

  // ══ SEQUENCE / WEIGHT TRANSFER / BALANCE ═════════════════════════════════
  {
    id: 'drill.step-through',
    layer: 'practice',
    module: MODULE,
    topic: 'step-through (weight-transfer / sequence) drill',
    aliases: ['step drill', 'step through drill', 'weight transfer drill', 'how do i transfer my weight', 'sequence drill'],
    principle:
      'Forces correct ground-up sequencing and full forward weight transfer — the cure for hanging back, reverse pivot and a stalled body. Start with feet together (or trail foot back); as you start the downswing, STEP toward the target with the lead foot, then swing through. The step makes you lead with the lower body and get fully to your front side. Fixes: reverse pivot, hanging back, fat/thin, over-the-top.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: half swings, step toward the target to start down, swing through',
      'next: keep the feel with a normal stance — lower body leads, weight goes forward',
      'feel: finish fully over the lead leg, trail heel up',
    ],
    related: ['fault.reverse-pivot', 'fault.hanging-back', 'fault.fat', 'fault.over-the-top', 'fs.finish.hanging-back'],
    source: 'sequence / weight-transfer lineage',
  },
  {
    id: 'drill.feet-together',
    layer: 'practice',
    module: MODULE,
    topic: 'feet-together balance drill',
    aliases: ['feet together drill', 'balance drill', 'narrow stance drill', 'how do i swing in balance', 'sway fix drill'],
    principle:
      'Stand with the feet a few inches apart and hit smooth half-to-three-quarter shots. With no wide base to lean on, any sway, slide, lunge or over-swing throws you off balance instantly — so the drill forces centered rotation and a tempo you can control. A diagnostic AND a fix. Fixes: sway, slide, rushed tempo, balance, reverse pivot.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: feet almost together, smooth half swings, stay balanced',
      'next: widen gradually back to normal, keeping the centered feel',
      'feel: you turn around a stable center — no lateral lurch',
    ],
    related: ['fault.sway', 'fault.slide', 'fault.rushed-tempo', 'fault.reverse-pivot', 'fs.finish.balance'],
    source: 'balance / centeredness lineage',
  },
  {
    id: 'drill.pause-at-top',
    layer: 'practice',
    module: MODULE,
    topic: 'pause-at-the-top tempo drill',
    aliases: ['pause at the top drill', 'tempo drill', 'how do i fix my tempo', 'rhythm drill', 'stop rushing drill'],
    principle:
      'Cures a rushed transition that wrecks sequence. Swing to the top and PAUSE for a beat, then start down smoothly with the lower body. The pause separates backswing from downswing so the arms can\'t fire early — re-grooving an unhurried, sequenced move toward the classic ~3:1 backswing-to-downswing ratio. Outcome the app can roughly read via pose tempo. Fixes: rushed tempo, over-the-top, casting.',
    appSignals: ['pose_tempo'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: full swings with a deliberate one-beat pause at the top',
      'next: shrink the pause until it\'s just an unhurried, complete top',
      'feel: smooth is fast — let the body lead, hold a balanced finish',
    ],
    related: ['fault.rushed-tempo', 'fault.over-the-top', 'fault.casting', 'fs.finish.balance'],
    source: 'Tour Tempo / Els-style rhythm',
  },

  // ══ CONNECTION / EXTENSION ═══════════════════════════════════════════════
  {
    id: 'drill.towel-under-arms',
    layer: 'practice',
    module: MODULE,
    topic: 'towel/headcover-under-both-arms connection drill',
    aliases: ['towel under arms drill', 'connection drill', 'headcover under arm drill', 'arms connected drill', 'tees under armpits'],
    principle:
      'Tuck a towel (or headcover) under BOTH upper arms / armpits and make smooth swings keeping it pinned. It trains the arms to stay connected to the rotating chest instead of running away — the antidote to disconnection, flying elbow and the chicken wing. Drop it and you know the arms separated. Fixes: connection, chicken wing, flying elbow, over-the-top.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'first: short swings keeping the towel pinned both back and through',
      'next: lengthen toward full while it stays put',
      'feel: the arms move WITH the chest turn, not independently',
    ],
    related: ['fs.architecture.connection', 'fault.chicken-wing', 'fs.backswing.flying-elbow', 'fault.over-the-top'],
    source: 'connection lineage / RotarySwing-style',
  },
  {
    id: 'drill.headcover-lead-arm',
    layer: 'practice',
    module: MODULE,
    topic: 'headcover-under-lead-arm drill',
    aliases: ['headcover under lead arm', 'lead arm connection drill', 'one headcover drill', 'keep the arm connected drill'],
    principle:
      'A single headcover under the LEAD armpit, held there through the swing, keeps the lead arm connected across the chest — directly fighting the chicken wing and the flying lead arm that costs extension and compression. Simpler than the two-arm version and great for the through-swing. Fixes: chicken wing, connection, disconnection.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['hold the headcover under the lead arm back AND through', 'feel the lead arm stay across the chest past impact', 'long lead arm = extension and speed'],
    related: ['fault.chicken-wing', 'fs.architecture.connection', 'fs.finish.chicken-wing'],
    source: 'connection lineage',
  },
  {
    id: 'drill.one-handed',
    layer: 'practice',
    module: MODULE,
    topic: 'lead-hand-only swings',
    aliases: ['one handed drill', 'lead hand only drill', 'left arm only drill', 'how do i fix my chicken wing', 'single arm swings'],
    principle:
      'Make slow, short swings with the LEAD hand only (choke down, small pitches). With nothing to bail it out, the lead arm learns to stay long and extend through impact instead of collapsing — the core fix for the chicken wing and a weak release. Builds the connection and extension the full swing needs. Fixes: chicken wing, lead-arm collapse, connection.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['first: lead-hand-only, choke down, small pitches', 'next: add the trail hand back keeping the long-arm feel', 'feel: the lead arm extends down the line, doesn\'t fold'],
    related: ['fault.chicken-wing', 'fs.finish.chicken-wing', 'fs.architecture.connection'],
    source: 'one-arm drill lineage',
  },

  // ══ LOW POINT / CONTACT ══════════════════════════════════════════════════
  {
    id: 'drill.towel-behind-ball',
    layer: 'practice',
    module: MODULE,
    topic: 'towel-behind-the-ball anti-fat drill',
    aliases: ['towel drill', 'towel behind the ball', 'how do i stop hitting it fat', 'anti chunk drill', 'stop hitting behind it'],
    principle:
      'The classic fat-shot cure. Lay a small towel (or headcover) on the ground about 6-8 inches BEHIND the ball. If your low point is behind the ball you thump the towel; if your weight gets forward and the low point moves ahead, you miss it and flush the ball. Physically punishes a back-of-ball low point. Fixes: fat/chunk, hanging back, casting.',
    appSignals: ['acoustic_strike'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'first: towel ~6-8 inches behind the ball, swing to miss it and clip the ball',
      'next: inch the towel closer as you improve',
      'feel: weight forward, low point AHEAD of the ball — ball first, then turf',
    ],
    related: ['fault.fat', 'fault.hanging-back', 'fault.casting', 'contact.low-point', 'fs.finish.hanging-back'],
    source: 'low-point-control lineage',
  },
  {
    id: 'drill.low-point-line',
    layer: 'practice',
    module: MODULE,
    topic: 'low-point line / divot-start drill',
    aliases: ['line drill', 'low point drill', 'draw a line drill', 'divot start drill', 'how do i control low point'],
    principle:
      'Draw a line on the ground (spray paint, or a tee line) and make swings trying to start the divot ON or just AFTER the line (the target side) — no ball needed at first. It trains the low point forward of the ball for ball-first contact, the root cure for BOTH fat and thin. Then put a ball on the back of the line. Fixes: fat, thin, low-point control.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: brush-swings, divot starts on the target side of the line', 'next: add a ball at the back edge of the line', 'feel: ball first, then the turf — low point lives ahead of the ball'],
    related: ['fault.fat', 'fault.thin', 'contact.low-point', 'contact.compression'],
    source: 'low-point-control / Hogan ball-first',
  },
  {
    id: 'drill.divot-board',
    layer: 'practice',
    module: MODULE,
    topic: 'divot-board / strike-board feedback drill',
    aliases: ['divot board drill', 'strike board', 'impact board drill', 'where is my low point', 'contact feedback drill'],
    principle:
      'A divot/strike board marks exactly where the club contacts the ground, making low point, path and strike location visible swing-to-swing. Indoors or out, it turns an invisible fault into instant feedback you can correct on the spot. Pairs with the line drill. Fixes: fat, thin, low-point and path awareness.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['read the mark each rep — too far back = fat, find it forward', 'aim for a consistent strike spot just target-side of center', 'feel: weight forward moves the mark forward'],
    related: ['fault.fat', 'fault.thin', 'contact.low-point'],
    source: 'low-point / strike-feedback lineage',
  },
  {
    id: 'drill.impact-bag',
    layer: 'practice',
    module: MODULE,
    topic: 'impact-bag drill',
    aliases: ['impact bag drill', 'how do i get hands ahead', 'impact position drill', 'compression drill', 'stop flipping drill'],
    principle:
      'Swing into an impact bag and HOLD the position — it trains a strong impact: hands ahead of the clubhead, shaft leaning toward the target, weight forward, body rotated. It directly fights casting/scooping and the flip, building the compressed strike. Feel the body deliver into the bag, not the hands. Fixes: casting, scooping, hanging back, weak contact.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: slow swings into the bag, freeze a strong impact', 'next: hands ahead, shaft leaning forward, weight on the lead side', 'feel: the body drives into the bag, the wrists hold their angle'],
    related: ['fault.casting', 'fault.hanging-back', 'contact.compression', 'fs.transition.casting'],
    source: 'impact-position lineage',
  },
  {
    id: 'drill.toe-gate',
    layer: 'practice',
    module: MODULE,
    topic: 'toe-strike / anti-shank re-centering drill',
    aliases: ['toe gate drill', 'how do i stop shanking', 'anti shank drill', 'shank fix drill', 'hit it off the toe drill'],
    principle:
      'A shank antidote that re-centers contact. Set a tee (or a ball) just OUTSIDE the toe of the club at address and try to miss it — or simply hit a few balls off the TOE on purpose. It moves the strike away from the hosel and breaks the early-extension/toe-pressure pattern that causes shanks. Confidence-restoring because it works fast. Fixes: shank, heel strike.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: place a tee outside the toe — swing to miss it', 'next: hit a few off the toe deliberately to move contact away from the hosel', 'feel: weight in the heels, hold your tilt — a shank is a near-miss, not a broken swing'],
    related: ['fault.shank', 'fault.early-extension', 'fault.standing-too-close', 'contact.dispersion-centroid'],
    source: 'anti-shank lineage',
  },
  {
    id: 'drill.tee-sweep',
    layer: 'practice',
    module: MODULE,
    topic: 'tee-only sweep (anti-pop-up) drill',
    aliases: ['tee sweep drill', 'how do i stop popping up my driver', 'sky ball fix drill', 'hit up on the driver drill', 'clip the tee drill'],
    principle:
      'For driver pop-ups: tee a ball up and try to clip ONLY the top of the tee on the way UP (or tee with no ball and sweep the tee away). It trains an ascending, sweeping driver strike instead of a steep chop, and the right tee height/ball-forward setup that prevents catching the top edge. Fixes: pop-up/sky, steep with driver.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: tee half the ball above the crown, ball off the lead heel', 'next: feel the driver sweep UP through the tee, not down', 'feel: slight spine tilt away from target so you catch it on the up'],
    related: ['fault.pop-up', 'fault.steep', 'setup.ball-position'],
    source: 'driver attack-angle lineage',
  },

  // ══ SETUP / AIM / EARLY-EXTENSION ════════════════════════════════════════
  {
    id: 'drill.alignment-gate',
    layer: 'practice',
    module: MODULE,
    topic: 'alignment-stick gate / railroad-track drill',
    aliases: ['alignment stick drill', 'railroad track drill', 'how do i aim better', 'alignment gate', 'check my aim drill'],
    principle:
      'Lay two alignment sticks (or clubs) on the ground: one on the ball-to-target line, one along your toes parallel-left. It calibrates true aim — most players who "aim fine" are pointed yards off and never see it. A path "gate" of two sticks/tees just wider than the clubhead also exposes an out-to-in or in-to-out path. Fixes: misalignment, slice/pull/push from aim, path.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: stick on the target line, stick on your toes parallel-left', 'next: build a tee gate just wider than the head to check path', 'feel: face to target first, body parallel-left on the tracks'],
    related: ['fault.poor-aim', 'fault.slice', 'fault.pull', 'setup.alignment', 'bf.face-to-path'],
    source: 'setup fundamentals / Hogan railroad',
  },
  {
    id: 'drill.wall-butt-back',
    layer: 'practice',
    module: MODULE,
    topic: 'butt-against-the-wall (anti-early-extension) drill',
    aliases: ['wall drill', 'butt on the wall drill', 'how do i stop standing up', 'early extension fix drill', 'keep my posture drill'],
    principle:
      'Set up with your backside lightly touching a wall (or a chair / alignment stick behind the hips). Swing and keep the trail glute in contact going back, and the LEAD glute finding the wall through impact. It trains the hips to rotate AROUND instead of thrusting toward the ball — the direct cure for early extension and its shanks/blocks/thins. Fixes: early extension, shank, push.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: trail glute stays on the wall going back', 'next: lead glute finds the wall through impact — hips rotate, don\'t thrust', 'feel: keep your tilt and make room for the arms'],
    related: ['fault.early-extension', 'fault.shank', 'fault.push', 'fs.transition.early-extension', 'setup.posture'],
    source: 'early-extension lineage / GolfTec wall drill',
  },
  {
    id: 'drill.trail-hip-wall',
    layer: 'practice',
    module: MODULE,
    topic: 'trail-hip barrier (anti-sway) drill',
    aliases: ['anti sway drill', 'trail hip wall drill', 'how do i stop swaying', 'sway barrier drill', 'stick outside trail hip'],
    principle:
      'Place an alignment stick (or stand near a wall) just OUTSIDE your trail hip. Make backswings turning into the trail leg WITHOUT the hip bumping the stick — if you sway laterally, you hit it. It trains rotation over lateral slide and keeps the swing centered over the ball. Fixes: sway, reverse pivot, inconsistent low point.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: turn into the trail leg without touching the stick', 'next: feel pressure on the INSIDE of the trail foot at the top', 'feel: you coil, you don\'t slide off the ball'],
    related: ['fault.sway', 'fault.reverse-pivot', 'fs.architecture.shoulder-turn'],
    source: 'sway/slide lineage',
  },
  {
    id: 'drill.lead-hip-wall',
    layer: 'practice',
    module: MODULE,
    topic: 'lead-hip barrier (anti-slide) drill',
    aliases: ['anti slide drill', 'lead hip wall drill', 'how do i stop sliding', 'slide fix drill', 'hip rotation drill'],
    principle:
      'Place a stick (or wall) just OUTSIDE your LEAD hip. Start the downswing with a small bump, then ROTATE the lead hip back and around — if you slide laterally past the stick you hit it. It converts an over-slide into rotation, so the body clears and you stop blocking/flipping. Fixes: slide, push/block, early extension.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: small bump to start down, then the lead hip rotates back', 'next: belt buckle turns to the target, hip clears past the stick by rotating not sliding', 'feel: post and turn on the lead leg'],
    related: ['fault.slide', 'fault.push', 'fault.early-extension', 'fs.transition.stall'],
    source: 'sway/slide lineage',
  },
  {
    id: 'drill.heels-pressure',
    layer: 'practice',
    module: MODULE,
    topic: 'heels-pressure (anti-shank / anti-early-extension) feel',
    aliases: ['heels pressure drill', 'weight in heels drill', 'how do i keep weight in my heels', 'anti shank balance drill'],
    principle:
      'A simple feel: keep pressure toward your HEELS through the swing rather than rolling onto your toes. Toe-pressure (and early extension) pushes the hosel toward the ball, the seed of shanks and a steepening path. Rehearse swings feeling the heels stay loaded and the chest staying over the ball. Fixes: shank, early extension, balance toward the toes.',
    appSignals: ['pose_biomech'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['feel pressure in the heels, not the balls of the feet', 'keep the chest over the ball, hold your tilt', 'pairs with the wall drill to lock out early extension'],
    related: ['fault.shank', 'fault.early-extension', 'setup.distance-from-ball'],
    source: 'balance / anti-shank lineage',
  },

  // ══ SHORT GAME / PUTTING (famous high-ROI) ═══════════════════════════════
  {
    id: 'drill.gate-putting',
    layer: 'practice',
    module: MODULE,
    topic: 'gate putting drill (start line / face)',
    aliases: ['gate putting drill', 'tee gate putting', 'how do i start my putts on line', 'putting face drill', 'two tee putting drill'],
    principle:
      'Set two tees just wider than the putter head a few inches in front of the ball, forming a gate. Roll putts through the gate without clipping a tee — it trains a square face and an on-line start, the single biggest factor in holing short putts. A Stockton-school staple for face control. Fixes: pushed/pulled putts, start-line, face control.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: short putts through the gate, face square, ball through clean', 'next: widen distance keeping the gate clean', 'feel: roll it on your start line and trust the read'],
    related: ['fault.push', 'fault.pull'],
    source: 'Stockton / putting-face lineage',
  },
  {
    id: 'drill.ladder-lag-putting',
    layer: 'practice',
    module: MODULE,
    topic: 'ladder / lag-putting distance drill',
    aliases: ['ladder drill', 'lag putting drill', 'how do i lag putt better', 'distance control putting drill', 'speed putting drill'],
    principle:
      'Putt to progressively farther targets (or tees) in a "ladder," matching stroke LENGTH to distance — the cure for three-putts, which come from poor SPEED, not bad lines. Most amateurs save more strokes from distance control than from a perfect read. Fixes: three-putting, lag distance control, speed.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: roll putts to 10, 20, 30 feet matching backstroke length', 'next: aim to leave every lag inside a 3-foot circle', 'feel: stroke LENGTH controls speed, not a hit'],
    related: ['cm.center-green'],
    source: 'Pelz / lag-putting lineage',
  },
  {
    id: 'drill.clock-short-game',
    layer: 'practice',
    module: MODULE,
    topic: 'clock-face wedge distance drill',
    aliases: ['clock drill', 'clock face wedge drill', 'how do i control wedge distance', 'wedge yardage drill', 'partial wedge drill'],
    principle:
      'Pelz\'s clock system: make wedge swings to set backswing "clock" positions (e.g. 7:30, 9:00, 10:30) and learn the carry each produces with each wedge. It replaces guesswork on partial wedges with repeatable, known yardages — where mid-handicappers leak strokes inside 100. Fixes: scoring-zone distance control, the awkward in-between wedge.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: pick three backswing lengths, learn each wedge\'s carry', 'next: log the yardages so you have known numbers, not guesses', 'feel: same smooth tempo, the length sets the distance'],
    related: ['sg.chip.club-selection', 'sg.chip.landing-spot', 'cm.center-green'],
    source: 'Pelz short-game lineage',
  },
  {
    id: 'drill.chip-landing-spot',
    layer: 'practice',
    module: MODULE,
    topic: 'chip landing-spot drill',
    aliases: ['landing spot drill', 'chip drill', 'how do i chip better', 'land it on a spot drill', 'towel chipping drill'],
    principle:
      'Put a towel (or marker) at the spot where you want each chip to LAND, and practice landing the ball on it, letting the club\'s loft control the roll. It shifts chipping from "where does it finish" to "land it here, let it release" — Utley/short-game thinking that makes chipping a repeatable landing game. Fixes: chunked/thin chips, distance control around the green.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first: pick a landing spot, land the ball on the towel', 'next: change clubs to change the roll, same landing spot', 'feel: low point ahead, weight slightly forward, ball-first then brush'],
    related: ['sg.chip.landing-spot', 'sg.chip.low-point', 'fault.fat', 'fault.thin'],
    source: 'Utley / Pelz short-game lineage',
  },
];
