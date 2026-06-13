/**
 * Phase v3-port (step 3/5) — diagnostic drill catalog.
 *
 * Ported from v3's constants/drills.ts. Maps each canonical swing
 * issue to a Primary Issue description, Common Faults bullets, drill
 * steps, a fundamentals card image, and a videoCategory for the
 * curated instructor video lookup.
 *
 * Pro previously had only prescriptive drills (Bullseye / Tempo /
 * Impact / etc.) — no issue → fix mapping. This catalog brings v3's
 * diagnostic system over so the Drills screen can show
 * "Over the Top → here are 3 fixes + a Hank Haney video."
 *
 * The previous Pro drills body (prescriptive drills) is preserved at
 * app/swinglab/drills-legacy.tsx as a separate sub-route; the main
 * Drills experience is now v3-style diagnostic.
 */

import type { ImageSourcePropType } from 'react-native';
import type { IssueCategory } from './instructorVideos';

export type CanonicalIssue =
  | 'club_face_open'
  | 'club_face_closed'
  | 'swing_path_outside_in'
  | 'swing_path_inside_out'
  | 'attack_angle_steep'
  | 'attack_angle_shallow'
  | 'early_extension'
  | 'over_the_top'
  | 'chicken_wing'
  | 'reverse_pivot'
  // 2026-05-26 — Short-game + branded categories. chipping_inconsistent
  // surfaces Randy Chang's "Chang Chip" video; tank_caddie_practice
  // surfaces the SmartPlay-branded Tank placeholder card. Both fit the
  // pair-grid layout on the Drills surface (Tim's "drills go in twos"
  // observation — six prior + chipping + tank_caddie = eight, two
  // clean rows of four).
  | 'chipping_inconsistent'
  | 'tank_caddie_practice'
  // 2026-06-13 (#5) — Tempo isn't a fault, it's the flagship practice drill:
  // tie tempo to swing %. Lives on the Drills surface like the rest.
  | 'tempo_consistency';

// 2026-06-13 (#5) — optional "practice in Smart Motion" descriptor. When set, the
// drill detail screen shows a "Practice this drill" button that opens Smart Motion
// in DRILL mode: it reads this descriptor to cap the session at shotCount swings
// (3–5), label the capture, and surface only the metric the drill is about.
// The ONE thing the camera + pose can honestly observe for this drill. Each maps
// to a capture view and an honest, pose-derivable read (no fabricated metrics):
//   tempo      — backswing:downswing rhythm (timing)
//   path       — over-the-top / in-to-out plane (DTL)
//   grip       — face-on SLOW look at the grip + lead wrist (cupped/flat/bowed)
//   posture    — hip depth / standing-up / spine tilt (early extension, reverse pivot)
//   connection — lead-arm extension / chicken-wing, towel-under-arm connection
//   contact    — descending strike, hands-ahead (chipping)
export type DrillFocus = 'tempo' | 'path' | 'grip' | 'posture' | 'connection' | 'contact';
export type DrillShotType = 'chip' | 'pitch' | 'full';
export type DrillPractice = {
  /** Swings to record for this drill. Tim's rule: keep drills to 3–5. */
  shotCount: number;
  shotType: DrillShotType;
  /** The single thing the engine reports for this drill — kept honest. */
  focus: DrillFocus;
  /** Which view Smart Motion opens in — the angle that actually shows the focus. */
  angle: 'face_on' | 'down_the_line';
  /** Tempo drill only: the swing efforts to work through (e.g. 50/75/100). */
  swingPercents?: readonly number[];
};

export type Drill = {
  name: string;
  steps: string;
};

export type DrillEntry = {
  id: CanonicalIssue;
  title: string;
  primary: string;
  commonFaults: readonly string[];
  missPattern: string;
  drills: readonly Drill[];
  // 2026-06-13 (#5) — when set, the card shows a "Practice in Smart Motion" action
  // that opens a drill-aware capture (right view + 3–5 swings + honest focus read).
  // Entry-level so there's ONE clear practice action per fault. Also the hook for a
  // future practice-POINTS system: each captureKind:'drill' session is a countable,
  // attributable completion that points can attach to.
  practice?: DrillPractice;
  videoCategory: IssueCategory;
  cardImage?: ImageSourcePropType;
  // 2026-05-27 — Fix EF: optional "Tank's Tips" infographic. Full-page
  // dense visual reference card (PGA-vs-Golf-Father comparison format).
  // When set, the drill detail screen renders a dedicated tap-to-zoom
  // section in addition to the standard cardImage + video. Currently
  // only Tank's drill has one (early extension); future drill entries
  // can add their own tipsImage to surface similar deep-reference cards.
  tipsImage?: ImageSourcePropType;
};

// Each fundamentals card maps to one of the visual teaching diagrams
// in assets/drills/. A card can be referenced by multiple drills.
const CARD_SWING_PATH = require('../assets/drills/swing-path.png');
const CARD_GRIP = require('../assets/drills/grip.png');
const CARD_POSTURE = require('../assets/drills/posture.png');
const CARD_WEIGHT_TRANSFER = require('../assets/drills/weight-transfer.png');
const CARD_BALL_POSITION = require('../assets/drills/ball-position.png');
const CARD_TEMPO = require('../assets/drills/tempo.png');

export const DRILL_CATALOG: readonly DrillEntry[] = [
  {
    id: 'over_the_top',
    practice: { shotCount: 5, shotType: 'full', focus: 'path', angle: 'down_the_line' },
    title: 'Over the Top',
    primary: 'Club is thrown outside the target line in transition, cutting across the ball at impact.',
    commonFaults: [
      'Right shoulder lurches toward the ball at the start of downswing',
      'Trail elbow flares away from the body',
      'Hands move out toward the ball before they drop',
    ],
    missPattern: 'Pull, pull-slice, or steep-and-fat contact',
    drills: [
      { name: 'Headcover gate',   steps: 'Place a headcover just outside your trail foot. Swing without hitting it — forces the club to drop inside on the way down.' },
      { name: 'Pump-and-pause',   steps: 'Take a half backswing, pause, then "pump" three times feeling the club shallow before any rotation. Then swing for real.' },
      { name: 'Trail-elbow tuck', steps: 'Tuck a glove or alignment stick under your trail armpit. Make slow swings keeping it pinned through transition.' },
    ],
    videoCategory: 'swing_path',
    cardImage: CARD_SWING_PATH,
  },
  {
    id: 'swing_path_outside_in',
    practice: { shotCount: 5, shotType: 'full', focus: 'path', angle: 'down_the_line' },
    title: 'Outside-In Path',
    primary: 'Club approaches the ball from outside the target line and exits inside.',
    commonFaults: [
      'Stance closed at address, opens too aggressively in transition',
      'Lead arm crosses the chest line early',
      'Hips spin without trail foot push',
    ],
    missPattern: 'Slice or pull (depending on face)',
    drills: [
      { name: 'Tee gate',          steps: 'Stick two tees in the ground forming a 6-inch gate, ball in the middle. Swing through — outside-in path knocks the outside tee.' },
      { name: 'Step-through swing', steps: '7-iron only. Take a normal swing, then step your trail foot past your lead foot at finish. Forces inside-out path through impact.' },
    ],
    videoCategory: 'swing_path',
    cardImage: CARD_SWING_PATH,
  },
  {
    id: 'swing_path_inside_out',
    practice: { shotCount: 5, shotType: 'full', focus: 'path', angle: 'down_the_line' },
    title: 'Inside-Out Path',
    primary: 'Club approaches from too far inside, leaving the face open relative to path.',
    commonFaults: [
      'Excessive hip slide toward target without rotation',
      'Hands trapped behind the trail thigh',
      'Stance too closed for the shot shape you want',
    ],
    missPattern: 'Push or push-fade',
    drills: [
      { name: 'Lead heel up',  steps: 'Raise your lead heel about an inch at address. Forces upper-body rotation through impact instead of just hands.' },
      { name: 'Square-it-up',  steps: 'Set a stick along your toe line, exactly square to target. Make 10 swings checking the stick stays parallel through finish.' },
    ],
    videoCategory: 'swing_path',
    cardImage: CARD_SWING_PATH,
  },
  {
    id: 'club_face_open',
    practice: { shotCount: 3, shotType: 'full', focus: 'grip', angle: 'face_on' },
    title: 'Open Clubface',
    primary: 'Face is pointing right of target at impact (right-handed).',
    commonFaults: [
      'Weak grip — only one knuckle visible on top hand',
      'Cupped lead wrist at the top of the swing',
      'No forearm rotation through impact',
    ],
    missPattern: 'Slice or push depending on path',
    drills: [
      { name: 'Knuckle check',    steps: 'Set up to a mirror or your phone propped up. Top hand should show 2-3 knuckles. Hold for a 3-count before each rep.' },
      { name: 'Flat-wrist drill', steps: 'Swing to the top in slow-motion and check the lead wrist is flat or slightly bowed — never cupped. Hold the position 5 seconds.' },
    ],
    videoCategory: 'grip',
    cardImage: CARD_GRIP,
  },
  {
    id: 'club_face_closed',
    practice: { shotCount: 3, shotType: 'full', focus: 'grip', angle: 'face_on' },
    title: 'Closed Clubface',
    primary: 'Face is pointing left of target at impact (right-handed).',
    commonFaults: [
      'Strong grip — three+ knuckles visible',
      'Bowed lead wrist at impact',
      'Hands rolling through too aggressively',
    ],
    missPattern: 'Hook or pull-hook',
    drills: [
      { name: 'Soft-hands punch', steps: '7-iron, half-swing. Hold finish low with the toe of the club pointing skyward — no roll. Reps until the hook stops appearing.' },
      { name: 'Glove pinch',      steps: 'Pinch a glove between your forearms. Keep it pinched through impact — kills excessive forearm roll.' },
    ],
    videoCategory: 'grip',
    cardImage: CARD_GRIP,
  },
  {
    id: 'early_extension',
    practice: { shotCount: 5, shotType: 'full', focus: 'posture', angle: 'down_the_line' },
    title: 'Early Extension',
    primary: 'Hips push toward the ball in the downswing, standing up out of posture.',
    commonFaults: [
      'Trail glute disengages on the way down',
      'Belt buckle moves toward the ball before rotation',
      'Hands get stuck behind the body, hosel-y contact',
    ],
    missPattern: 'Shanks, blocks right, or pulls when the player saves with hands',
    drills: [
      { name: 'Wall drill',       steps: 'Stand with your butt touching a wall. Make swings keeping butt on the wall through impact. Most players will feel this in the trail glute.' },
      { name: 'Chair behind you', steps: 'Place a chair right behind your butt at address. Swing without pushing into the chair — forces hip depth.' },
    ],
    videoCategory: 'posture',
    cardImage: CARD_POSTURE,
  },
  {
    id: 'attack_angle_steep',
    practice: { shotCount: 5, shotType: 'full', focus: 'posture', angle: 'down_the_line' },
    title: 'Steep Attack',
    primary: 'Club approaches the ball too vertically, deep divots and high spin.',
    commonFaults: [
      'Weight stuck on lead side at the top',
      'Backswing too short and arms-only',
      'No trail-shoulder turn through impact',
    ],
    missPattern: 'Fat shots, ballooned distances, deep divots',
    drills: [
      { name: 'Headcover behind ball', steps: 'Place a headcover 6 inches behind the ball. Swing without hitting it — forces a shallow approach.' },
      { name: 'Belt-loop turn',        steps: 'Slow swings focusing on rotating both belt loops past the ball, not the hands. Shallows the angle naturally.' },
    ],
    videoCategory: 'ball_position',
    cardImage: CARD_BALL_POSITION,
  },
  {
    id: 'attack_angle_shallow',
    practice: { shotCount: 5, shotType: 'full', focus: 'posture', angle: 'down_the_line' },
    title: 'Shallow Attack',
    primary: 'Club approaches too horizontally, thin contact and weak spin.',
    commonFaults: [
      'Reverse weight shift — leaning back through impact',
      'Trying to "help the ball up"',
      'Trail shoulder dropping below lead too soon',
    ],
    missPattern: 'Thins, tops, or low knockdowns when not intended',
    drills: [
      { name: 'Lead shoulder down', steps: 'At setup, drop your lead shoulder 1 inch lower than feels natural. Swing — encourages a slightly steeper approach.' },
      { name: 'Stand-board feel',   steps: 'Hit balls off a slightly raised mat or board. The slight lift forces you to compress down into it.' },
    ],
    videoCategory: 'ball_position',
    cardImage: CARD_BALL_POSITION,
  },
  {
    id: 'chicken_wing',
    practice: { shotCount: 5, shotType: 'full', focus: 'connection', angle: 'face_on' },
    title: 'Chicken Wing',
    primary: 'Lead arm bends and breaks down through impact — short, weak release.',
    commonFaults: [
      'Lead elbow flares away from body in follow-through',
      'Loss of width on the lead side',
      'Body stops rotating; arms try to do everything',
    ],
    missPattern: 'Weak fade, low ball flight, distance loss',
    drills: [
      { name: 'Wide-and-rotate',    steps: 'Make swings holding the finish with both arms extended toward target. Lead arm should be straight or near-straight at chest height.' },
      { name: 'Towel under armpit', steps: 'Tuck a towel under the LEAD armpit. Swing keeping it pinned through impact, then release into a full extension.' },
    ],
    videoCategory: 'posture',
    cardImage: CARD_POSTURE,
  },
  {
    id: 'reverse_pivot',
    practice: { shotCount: 5, shotType: 'full', focus: 'posture', angle: 'face_on' },
    title: 'Reverse Pivot',
    primary: 'Weight shifts toward the lead side on the backswing and trail side on the downswing — opposite of a sound move.',
    commonFaults: [
      'Lead shoulder dips on the backswing',
      'Hips slide toward the target on the way back',
      'Trail leg straightens too early',
    ],
    missPattern: 'Big inconsistency: pushes, pulls, occasional skies',
    drills: [
      { name: 'Trail-foot weight', steps: 'At the top, pause and check 60-70% of weight is in the TRAIL foot, not the lead. Repeat 10 times before swinging full.' },
      { name: 'Step-back',         steps: 'Take address, then step the trail foot back 6 inches. Swing — exaggerates the correct weight shift back and through.' },
    ],
    videoCategory: 'weight_transfer',
    cardImage: CARD_WEIGHT_TRANSFER,
  },
  // 2026-05-26 — Chipping drill that routes to Randy Chang's
  // "Chang Chip" video. cardImage intentionally omitted (no
  // chipping fundamentals image bundled yet); the Drills surface
  // falls back to the title + video thumbnail.
  {
    id: 'chipping_inconsistent',
    practice: { shotCount: 5, shotType: 'chip', focus: 'contact', angle: 'face_on' },
    title: 'Inconsistent Chipping',
    primary: 'Strike inconsistent around the green — sometimes thin, sometimes fat, distance unpredictable.',
    commonFaults: [
      'Wrists release too aggressively at the ball — adds loft variability',
      'Weight stuck on trail foot through the strike',
      'Stance too wide or too narrow for the swing length',
    ],
    missPattern: 'Bladed runners, chunky shorts, distance scatter inside 30 yards',
    drills: [
      { name: 'Chang Chip setup', steps: 'Narrow stance, weight 60% on lead foot, ball back of center. Hands stay ahead of the clubhead through impact — no flip.' },
      { name: 'Towel drill',      steps: 'Place a towel 12 inches behind the ball. Chip without the club hitting the towel — forces a descending strike instead of a scoop.' },
      { name: '3-distance ladder',steps: 'Pick three landing spots (5 / 10 / 15 yards). Hit five chips to each, same club. Train carry distance through length-of-swing, not effort.' },
    ],
    videoCategory: 'chipping',
    // 2026-05-26 — Fix DF: thumbnail pulled from the Chang Chip video's
    // YouTube poster frame. Remote URI works in ImageSourcePropType
    // without bundling an asset; renders the actual instructor frame
    // so testers recognize Randy on the Drills grid.
    cardImage: { uri: 'https://img.youtube.com/vi/_iWzD-gSoa8/maxresdefault.jpg' },
  },
  // 2026-05-26 — Reserved 8th slot for Tank-narrated SmartPlay-branded
  // content. Drill entry exists so the slot appears on the Drills
  // surface; the linked InstructorVideoLink renders the SmartPlay
  // placeholder thumbnail until Tank's recording lands (url === '').
  {
    id: 'tank_caddie_practice',
    title: "Tank's Take — Practice with Standards",
    primary: 'When you bring intensity to practice, the round takes care of itself.',
    commonFaults: [
      'Practice with no intent — beating balls instead of working a routine',
      'Skipping the uncomfortable shots (the ones you actually need)',
      'Stopping before fatigue sets in (where the bad habits show up)',
    ],
    missPattern: 'Performance plateau despite hours on the range',
    drills: [
      { name: '10-ball pressure block', steps: 'Pick one club, one target. Hit 10 in a row. Restart from zero on the first miss-direction. Builds focus under pressure.' },
      { name: 'Worst-shot warm-up',     steps: 'Start each session with the shot you LEAST want to hit. Three solid reps before moving on. Removes avoidance from your range pattern.' },
    ],
    videoCategory: 'tank_caddie',
    // 2026-05-27 — Fix EI: swapped from tank_v2_lets_go_marine.png
    // (which is a 9-face COMPOSITE grid — bad for a drill card; reads
    // as cluttered) to tank_v2_lets_go.png — a SINGLE Tank portrait
    // with the SmartPlay Caddie polo and the fist-pump energy that
    // matches "Practice with Standards." Tim's call:
    // "we don't need tanks card to be fifteen tanks pictures."
    cardImage: require('../assets/avatars/tank_v2_lets_go.png'),
    // 2026-05-27 — Fix EF: Tank's Tips card for early extension.
    // Full-page PGA-vs-Golf-Father infographic Tim authored. Rendered
    // as a dedicated tap-to-zoom section on the drill detail screen
    // (text is dense — the modal is the right place to read it).
    tipsImage: require('../assets/tank-tips/early-extension.png'),
  },
  // 2026-06-13 (#5) — Flagship practice drill: Tempo × Swing %. Not a fault —
  // the first drill wired to the Smart Motion drill engine. Reuses the honest
  // tempo read + the effort% estimate already in the app; nothing fabricated.
  {
    id: 'tempo_consistency',
    practice: { shotCount: 5, shotType: 'full', focus: 'tempo', angle: 'face_on', swingPercents: [50, 75, 100] },
    title: 'Tempo',
    primary: 'Smooth, repeatable tempo — the same rhythm whether you swing easy or hard.',
    commonFaults: [
      'Backswing rushes the moment you try to hit it harder',
      'Quick from the top — no transition pause',
      'Tempo drifts from club to club',
    ],
    missPattern: 'Inconsistent strike + dispersion',
    drills: [
      {
        name: 'Tempo × Swing %',
        steps:
          'Pick an effort — 50%, then 75%, then 100%. Hit 3–5 balls and hold the SAME rhythm at every level. Your tempo ratio should barely move even as the power climbs. Most players rush the backswing when they go after it — this makes that visible.',
      },
    ],
    videoCategory: 'tempo',
    cardImage: CARD_TEMPO,
  },
];

export function getDrillEntry(id: string): DrillEntry | undefined {
  return DRILL_CATALOG.find((d) => d.id === id);
}
