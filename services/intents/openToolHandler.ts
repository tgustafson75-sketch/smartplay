import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import type { ToolAction } from '../../app/api/kevin+api';
// 2026-06-24 — APP-FEATURE CATALOG as the routing source of truth. The explicit
// classifier-name map below stays (existing tool routes), but any tool_name or
// raw transcript that matches a catalog alias also routes deterministically —
// this is what makes "open smart tempo" / "the tempo drill card" land correctly.
import { lookupFeature } from '../knowledgeBase/appCatalog';

// 2026-05-25 — Fix E/O: voice-direct in-place mark for tee/green.
// Returns IntentResult when the mark was captured (so the caller skips
// navigation). Returns null when GPS isn't ready (caller falls through
// to navigate so the user can mark manually on-screen).
async function tryVoiceDirectMark(
  toolName: string,
): Promise<IntentResult | null> {
  // Dynamic requires avoid module-load cycles since these stores import
  // from openToolHandler's caller graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useRoundStore } = require('../../store/roundStore') as typeof import('../../store/roundStore');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gps = require('../gpsManager') as typeof import('../gpsManager');

  const round = useRoundStore.getState();
  if (!round.isRoundActive || round.activeCourseId == null) return null;

  const fix = gps.getLastFix();
  if (!fix || fix.lat == null || fix.lng == null) return null;

  // GPS quality gate: if accuracy is bad (>20m) or fix is stale (>15s),
  // don't trust this position for an override. Fall through to navigate
  // so the user can move and tap manually.
  const ageMs = Date.now() - fix.timestamp;
  if (fix.accuracy_m != null && fix.accuracy_m > 20) return null;
  if (ageMs > 15_000) return null;

  const isTee = toolName === 'mark_tee' || toolName === 'marktee' || toolName === 'mark_tee_box';
  const hole = round.currentHole;
  const label = isTee ? 'Tee' : 'Pin';

  try {
    if (isTee) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('../courseTeeOverrides') as typeof import('../courseTeeOverrides');
      await m.setTeeOverride(round.activeCourseId, hole, { lat: fix.lat, lng: fix.lng });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('../courseGreenOverrides') as typeof import('../courseGreenOverrides');
      await m.setGreenOverride(round.activeCourseId, hole, { lat: fix.lat, lng: fix.lng });
    }
  } catch (e) {
    console.log('[openToolHandler] override persist failed:', e);
    return null; // navigate fallback
  }

  // For green marks, recompute and speak the new yardage from the
  // player's current position (which is the marked spot — so 0y is
  // expected). More useful: when marking the TEE, the player is at the
  // tee and yardage to green is unchanged from courseHoles, so speak
  // confirmation only. When marking the GREEN, the player is AT the
  // green so yardage is ~0; just confirm.
  const reply = `${label} marked on ${hole}.`;
  return {
    success: true,
    voice_response: reply,
    side_effects: [isTee ? 'mark_tee:voice_direct' : 'mark_green:voice_direct'],
    follow_up_needed: false,
  };
}

const TOOL_NAME_TO_ACTION: Record<string, ToolAction | { type: 'navigate'; path: string }> = {
  smartvision: { type: 'open_smartvision' },
  smartfinder: { type: 'open_smartfinder' },
  swinglab:    { type: 'open_swinglab' },
  scorecard:   { type: 'navigate', path: '/(tabs)/scorecard' },
  dashboard:   { type: 'navigate', path: '/(tabs)/dashboard' },
  settings:    { type: 'navigate', path: '/settings' },
  // Phase H — Lie analysis camera tool. Phase AS — branded "TightLie"
  // for users (golf-flavored, recognizable term). Voice triggers
  // ("open TightLie", "check my lie", "what's the play", "analyze my
  // lie", "tight lie", etc.) classify into open_tool with
  // tool_name=lie_analysis (internal name kept; user-facing label
  // changed). play_intent parameter ("aggressive"/"conservative")
  // weights the analysis recommendation.
  lie_analysis: { type: 'navigate', path: '/lie-analysis' },
  // Phase AS — alias so the classifier can also emit tool_name=tightlie
  // and we route the same place. Both names work end-to-end.
  tightlie: { type: 'navigate', path: '/lie-analysis' },
  // 2026-05-21 — Day 2 / Fix 9B: Option D speed path. Voice "open
  // 2026-06-07 — Smart Motion rebuild: the unified screen now captures
  // in place (opens straight to the live camera in its 'setup' phase),
  // so the record-NOW intent lands directly on /swinglab/smartmotion —
  // no quick-record hop. Cage Mode merged into Smart Motion (see below).
  // Aliases: "smartmotion", "smart_motion", "smart motion" — classifier
  // normalizes spaces/underscores.
  smartmotion: { type: 'navigate', path: '/swinglab/smartmotion' },
  smart_motion: { type: 'navigate', path: '/swinglab/smartmotion' },
  // 2026-06-08 — Acoustic Test Bench removed (acoustic now lives in
  // SmartMotion calibration); its voice routes deleted with the screen.
  // 2026-05-19 — Owner GPS Test Bench voice intent. Same gating as
  // Settings → Owner Tools — non-owners get the same "unknown tool"
  // reply via the route's own gate. Aliases catch obvious phrasings.
  gps_test: { type: 'navigate', path: '/gps-test' },
  gps_test_bench: { type: 'navigate', path: '/gps-test' },
  // 2026-05-19 — Mark Green tool for capturing real per-hole green
  // coords when course geometry is missing / wrong. Aliases.
  mark_green: { type: 'navigate', path: '/mark-green' },
  markgreen: { type: 'navigate', path: '/mark-green' },
  // 2026-05-23 — Mark Tee mirrors Mark Green for the ORIGIN end of
  // the hole. With both anchored the hole length is verifiable
  // (haversine between marked tee + marked green) and the override
  // wins over GPS course data — same player-marked-as-truth pattern.
  mark_tee: { type: 'navigate', path: '/mark-tee' },
  marktee: { type: 'navigate', path: '/mark-tee' },
  mark_tee_box: { type: 'navigate', path: '/mark-tee' },
  // 2026-05-23 — Coach Mode (Fix #9). Voice phrasings "open coach mode",
  // "coach Emma", "let's coach Mike", etc. land here. The execute()
  // path below also reads parameters.player_name (or extracts from
  // raw_text as a fallback) and pre-sets familyStore.active_member_id
  // BEFORE navigating, so Coach Mode opens straight to the picked
  // player. New names quick-add via the same familyStore.addMember
  // path the Coach Mode UI uses.
  coach_mode: { type: 'navigate', path: '/swinglab/coach-mode' },
  coachmode: { type: 'navigate', path: '/swinglab/coach-mode' },
  // 2026-06-07 — Cage Mode merged into Smart Motion (rebuild). The
  // legacy cage voice phrasings ("start cage session", "start practice",
  // "open cage mode") now route to the unified Smart Motion screen,
  // which captures in place. Aliases kept so existing phrasings resolve.
  cage_mode: { type: 'navigate', path: '/swinglab/smartmotion' },
  cagemode: { type: 'navigate', path: '/swinglab/smartmotion' },
  // 2026-05-25 — Swing Library voice route. "Open library", "swing
  // library", "show me my swings" all land on the library list inside
  // SwingLab. Distinct from "open SwingLab" (which lands on the hub);
  // library is the direct list of past swings.
  library: { type: 'navigate', path: '/swinglab/library' },
  swing_library: { type: 'navigate', path: '/swinglab/library' },
  swinglibrary: { type: 'navigate', path: '/swinglab/library' },
  // 2026-06-17 — "Hey Caddy, what's the smart play?" → SmartFinder with
  // autoread=1 so the caddie reads the scene on arrival (no tap needed).
  // Visual analysis fills gaps when course hazard/geometry data is missing.
  // The old /lie-analysis?smartplay=1 route is retired; TightLie phrasings
  // ("analyze my lie", "check my lie", etc.) still land on lie_analysis.
  smartplay: { type: 'navigate', path: '/smartfinder?autoread=1' },
  smart_play: { type: 'navigate', path: '/smartfinder?autoread=1' },
  // 2026-06-30 (Tim — "the logical voice path should be: open up SmartVision and tell me what
  // you see") — a spoken "tell me what you see / what do you see out there / read the scene"
  // opens the camera scene read (SmartFinder autoread) and SPEAKS what it perceives. Same
  // autoread path as smart_play; distinct from lie_analysis (a specific lie read). This is the
  // natural voice front-end for vision ingestion — point the phone, hear what's out there.
  scene_read: { type: 'navigate', path: '/smartfinder?autoread=1' },
  look: { type: 'navigate', path: '/smartfinder?autoread=1' },
  what_you_see: { type: 'navigate', path: '/smartfinder?autoread=1' },
  // 2026-06-21 — PuttingLab voice route. "Open PuttingLab", "putting lab",
  // "putting analysis" all land on the upload screen (swinglab/upload) where
  // the user picks their putt video and the Putt tag is self-selected.
  putting_lab: { type: 'navigate', path: '/swinglab/upload' },
  puttinglab:  { type: 'navigate', path: '/swinglab/upload' },
  putting_analysis: { type: 'navigate', path: '/swinglab/upload' },
  // 2026-05-26 — Fix DW: voice "open / send / email / show issue log"
  // routes to /owner-logs. Issue Log is visible to ALL beta testers
  // (Fix AE). The execute() path below reads parameters.send_log to
  // decide whether to append ?send=1 (which auto-fires the mailto
  // export on mount) so "send issue log" is one utterance instead of
  // open-screen + tap-share.
  issue_log: { type: 'navigate', path: '/owner-logs' },
  issuelog: { type: 'navigate', path: '/owner-logs' },
  issues_log: { type: 'navigate', path: '/owner-logs' },
  bug_log: { type: 'navigate', path: '/owner-logs' },
  buglog: { type: 'navigate', path: '/owner-logs' },
  owner_logs: { type: 'navigate', path: '/owner-logs' },

  // 2026-06-24 — APP-FEATURE CATALOG routes. These SwingLab/practice cards had
  // no deterministic voice route before — the caddie "knew" them in the prompt
  // but couldn't open them. Each path is verified against the app/ tree and
  // mirrors services/knowledgeBase/appCatalog.ts. Smart Tempo (the new one) is
  // the headline fix: "open smart tempo" / "the tempo drill" now navigates.
  smart_tempo: { type: 'navigate', path: '/swinglab/smart-tempo' },
  smarttempo: { type: 'navigate', path: '/swinglab/smart-tempo' },
  tempo: { type: 'navigate', path: '/swinglab/smart-tempo' },
  tempo_drill: { type: 'navigate', path: '/swinglab/smart-tempo' },
  tempo_trainer: { type: 'navigate', path: '/swinglab/smart-tempo' },
  drills: { type: 'navigate', path: '/drills' },
  drill: { type: 'navigate', path: '/drills' },
  open_range: { type: 'navigate', path: '/practice/open-range' },
  openrange: { type: 'navigate', path: '/practice/open-range' },
  range_mode: { type: 'navigate', path: '/practice/open-range' },
  focus_session: { type: 'navigate', path: '/practice/session' },
  focussession: { type: 'navigate', path: '/practice/session' },
  shot_shapes: { type: 'navigate', path: '/practice/shot-shapes' },
  shotshapes: { type: 'navigate', path: '/practice/shot-shapes' },
  fit_profile: { type: 'navigate', path: '/practice/fit-profile' },
  fitprofile: { type: 'navigate', path: '/practice/fit-profile' },
  setup_check: { type: 'navigate', path: '/swinglab/setup-check' },
  setupcheck: { type: 'navigate', path: '/swinglab/setup-check' },
  smartplan: { type: 'navigate', path: '/practice/smartplan' },
  smart_plan: { type: 'navigate', path: '/practice/smartplan' },
  preround: { type: 'navigate', path: '/practice/preround' },
  pre_round: { type: 'navigate', path: '/practice/preround' },
  warm_up: { type: 'navigate', path: '/practice/preround' },
  warmup: { type: 'navigate', path: '/practice/preround' },
  range_import: { type: 'navigate', path: '/swinglab/range-import' },
  import_range: { type: 'navigate', path: '/swinglab/range-import' },
  // smartfinder already mapped above (open_smartfinder); add spoken aliases only.
  smart_finder: { type: 'open_smartfinder' },
  rangefinder: { type: 'open_smartfinder' },
  play: { type: 'navigate', path: '/(tabs)/play' },
  start_round: { type: 'navigate', path: '/(tabs)/play' },
};

const TOOL_LABEL: Record<string, string> = {
  smartvision: 'SmartVision',
  smartfinder: 'SmartFinder',
  swinglab:    'SwingLab',
  scorecard:   'your scorecard',
  dashboard:   'your dashboard',
  settings:    'settings',
  // Phase AS — user-facing label is now "TightLie". Internal key stays
  // lie_analysis to avoid file/route renames.
  lie_analysis: 'TightLie',
  tightlie: 'TightLie',
  smartmotion: 'SmartMotion',
  smart_motion: 'SmartMotion',
  gps_test: 'GPS Test Bench',
  gps_test_bench: 'GPS Test Bench',
  mark_green: 'Mark Green',
  markgreen: 'Mark Green',
  mark_tee: 'Mark Tee',
  marktee: 'Mark Tee',
  mark_tee_box: 'Mark Tee',
  coach_mode: 'Coach Mode',
  coachmode: 'Coach Mode',
  cage_mode: 'Cage Mode',
  cagemode: 'Cage Mode',
  library: 'Swing Library',
  swing_library: 'Swing Library',
  swinglibrary: 'Swing Library',
  smartplay: 'SmartPlay',
  smart_play: 'SmartPlay',
  putting_lab: 'PuttingLab',
  puttinglab: 'PuttingLab',
  putting_analysis: 'PuttingLab',
  issue_log: 'Issue Log',
  issuelog: 'Issue Log',
  issues_log: 'Issue Log',
  bug_log: 'Issue Log',
  buglog: 'Issue Log',
  owner_logs: 'Issue Log',
  // 2026-06-24 — APP-FEATURE CATALOG labels (parity with TOOL_NAME_TO_ACTION).
  smart_tempo: 'Smart Tempo',
  smarttempo: 'Smart Tempo',
  tempo: 'Smart Tempo',
  tempo_drill: 'Smart Tempo',
  tempo_trainer: 'Smart Tempo',
  drills: 'Drills',
  drill: 'Drills',
  open_range: 'Open Range',
  openrange: 'Open Range',
  range_mode: 'Open Range',
  focus_session: 'Focus Session',
  focussession: 'Focus Session',
  shot_shapes: 'Shot Shapes',
  shotshapes: 'Shot Shapes',
  fit_profile: 'Fit Profile',
  fitprofile: 'Fit Profile',
  setup_check: 'Setup Check',
  setupcheck: 'Setup Check',
  smartplan: 'SmartPlan',
  smart_plan: 'SmartPlan',
  preround: 'Pre-Round Warm Up',
  pre_round: 'Pre-Round Warm Up',
  warm_up: 'Pre-Round Warm Up',
  warmup: 'Pre-Round Warm Up',
  range_import: 'Import Range Session',
  import_range: 'Import Range Session',
  smart_finder: 'SmartFinder',
  rangefinder: 'SmartFinder',
  play: 'Play',
  start_round: 'Play',
};

export const openToolHandler: IntentHandler = {
  intent_type: 'open_tool',

  parameter_schema: {
    tool_name: 'one of: smartvision, smartfinder, swinglab, scorecard',
  },

  examples: [
    'open SmartVision',
    'show me the smart finder',
    'pull up SwingLab',
    'show my scorecard',
    'open the rangefinder',
    // Phase 403 — SmartMotion quick swing capture.
    'open SmartMotion',
    'start SmartMotion',
    'record my swing',
    'capture my swing',
    // 2026-05-23 (Fix #9) — Coach Mode voice phrasings.
    'open coach mode',
    'coach mode',
    'start coaching',
    "I'm coaching Emma",
    'coach Mike',
    'watch my student',
    // 2026-05-26 — Fix DW: Issue Log voice phrasings (show vs send).
    'open issue log',
    'show issue log',
    'send issue log',
    'email issue log',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const toolName = String(intent.parameters.tool_name ?? '').toLowerCase();

    // 2026-05-26 — Fix DW: detect the "send / email" verbiage before
    // navigation so "send the issue log" auto-fires the mailto export
    // (vs "show / open issue log" which just lands on the screen).
    // Classifier passes send_log:true when the verb implies dispatch;
    // we also catch it on raw_text as a fallback so older bundles work.
    const isIssueLog =
      toolName === 'issue_log' || toolName === 'issuelog' ||
      toolName === 'issues_log' || toolName === 'bug_log' ||
      toolName === 'buglog' || toolName === 'owner_logs';
    const sendLogFromParam = intent.parameters.send_log === true;
    const sendLogFromText = (() => {
      if (!isIssueLog) return false;
      const t = (intent.raw_text ?? '').toLowerCase();
      return /\b(send|email|share|export)\b/.test(t);
    })();
    const wantsSend = isIssueLog && (sendLogFromParam || sendLogFromText);

    // 2026-05-25 — Fix E/O: voice-direct mark for tee and green. If the
    // user says "mark the tee" / "mark the pin" and GPS has a usable
    // fix, capture the current GPS in place and write the override
    // immediately — NO navigation to the mark-screen. Speak an audible
    // ack with the new yardage if computable. Only falls through to
    // navigation when GPS is missing or accuracy is too soft to trust.
    if (toolName === 'mark_tee' || toolName === 'marktee' || toolName === 'mark_tee_box' ||
        toolName === 'mark_green' || toolName === 'markgreen') {
      try {
        const directResult = await tryVoiceDirectMark(toolName);
        if (directResult) return directResult;
        // null means GPS wasn't ready — fall through to navigation so
        // user can manually mark on-screen.
      } catch (e) {
        console.log('[openToolHandler] voice-direct mark failed (falling back to navigate):', e);
      }
    }

    let action = TOOL_NAME_TO_ACTION[toolName];

    // 2026-06-24 — APP-FEATURE CATALOG fallback. When the explicit map misses,
    // try the catalog's conservative alias match against the classifier's
    // tool_name AND the raw transcript. This catches phrasings the classifier
    // didn't normalize to a known key (e.g. "open the tempo drill card" →
    // Smart Tempo). Only a confident whole-phrase alias match resolves; an
    // ambiguous miss still falls through to the clarifying prompt below.
    if (!action) {
      const feature =
        lookupFeature(toolName) ?? lookupFeature(intent.raw_text ?? '');
      if (feature) {
        action = { type: 'navigate', path: feature.route };
        return {
          success: true,
          voice_response: 'Opening ' + feature.name + '.',
          side_effects: ['navigate:' + feature.route, 'catalog_match:' + feature.id],
          follow_up_needed: false,
          tool_action: { type: 'navigate', path: feature.route },
        };
      }
    }

    if (!action) {
      return {
        success: false,
        voice_response: 'Which tool — SmartVision, SmartFinder, SwingLab, scorecard, dashboard, or settings?',
        side_effects: ['unknown_tool'],
        follow_up_needed: true,
      };
    }

    // 2026-06-24 — off-device usage telemetry (opt-in; no-op if off).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../usageTelemetry').track('tool_opened', { tool: toolName });
    } catch { /* telemetry never throws */ }

    if (action.type === 'navigate') {
      // 2026-05-21 — Fix B: voice "record me down the line" / "face on"
      // routes through tool_name='smartmotion' with angle + auto_start
      // params. Forward both as URL query params so quick-record can
      // hydrate state + fire recording on mount.
      const angleRaw = String(intent.parameters.angle ?? '').toLowerCase();
      const angle: 'down_the_line' | 'face_on' | null =
        angleRaw === 'face_on' || angleRaw === 'face-on' ? 'face_on' :
        angleRaw === 'down_the_line' || angleRaw === 'down-the-line' || angleRaw === 'dtl' ? 'down_the_line' :
        null;
      const autoStart = intent.parameters.auto_start === true;
      // 2026-05-25 — Fix AJ Phase 1: surface voice-captured metadata.
      // shotType ("chip" / "putt" / "swing") — from "chip cam" / "putt
      // cam" phrasing. subject (capitalized first name) — from
      // "watching Chris's swing". Forwarded as URL params so the
      // quick-record screen pre-fills tag + activeMember properly.
      const shotTypeRaw = String(intent.parameters.shot_type ?? '').toLowerCase();
      const shotType =
        shotTypeRaw === 'chip' || shotTypeRaw === 'putt' || shotTypeRaw === 'swing'
          ? shotTypeRaw
          : null;
      const subjectRaw = typeof intent.parameters.subject === 'string'
        ? intent.parameters.subject.trim()
        : '';
      const subject = subjectRaw.length > 0 ? subjectRaw : null;

      // 2026-05-23 (Fix #9) — Coach Mode player-name resolution.
      // Voice "I'm coaching Emma" / "coach Mike" pre-sets the active
      // family member BEFORE navigating, so Coach Mode opens straight
      // to the picked player instead of the picker. Same effect Tank
      // would get by tapping the member's card on entry. New names
      // quick-add via familyStore.addMember (same path the Coach Mode
      // quick-add input uses). The Coach Mode screen reads
      // active_member_id on mount, so the navigation handoff is
      // synchronous from the screen's perspective.
      let coachedPlayerName: string | null = null;
      if (toolName === 'coach_mode' || toolName === 'coachmode') {
        const fromParam = typeof intent.parameters.player_name === 'string'
          ? intent.parameters.player_name.trim()
          : '';
        // Fallback regex on raw_text — picks up names the classifier
        // missed. Matches "coaching X", "coach X", "watch my student X"
        // where X is a capitalized first name. Bounded to one word so
        // "I'm coaching today" doesn't extract "today".
        const fromRegex = (() => {
          const t = intent.raw_text ?? '';
          const m =
            t.match(/\bcoaching\s+([A-Z][a-z]{1,20})\b/) ??
            t.match(/\bcoach\s+([A-Z][a-z]{1,20})\b/) ??
            t.match(/\bmy\s+student\s+([A-Z][a-z]{1,20})\b/);
          return m ? m[1] : null;
        })();
        const name = (fromParam.length > 0 ? fromParam : (fromRegex ?? '')).trim();
        if (name) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fam = require('../../store/familyStore') as typeof import('../../store/familyStore');
            const state = fam.useFamilyStore.getState();
            const target = name.toLowerCase();
            const existing = state.members.find(
              m => !m.archived && m.firstName.trim().toLowerCase() === target,
            );
            if (existing) {
              state.setActiveMember(existing.id);
              coachedPlayerName = existing.firstName;
            } else {
              // Quick-add — same defaults Coach Mode's UI uses for the
              // typed quick-add input. Pro doesn't fill out a full
              // roster entry by voice; just names the student.
              const id = state.addMember({
                firstName: name,
                relationship: 'other',
                age: null,
                skillLevel: 'developing',
                handedness: 'unknown',
                approximate_handicap: null,
                avatar_emoji: '🏌️',
              });
              state.setActiveMember(id);
              coachedPlayerName = name;
            }
          } catch (e) {
            console.log('[openToolHandler] coach_mode player resolve failed (non-fatal):', e);
          }
        }
      }

      // 2026-06-04 — Build the final navigation path but DON'T call
      // router.push here. Returning the path as a tool_action lets the
      // caller (useVoiceCaddie) await speak BEFORE the destination screen
      // mounts. This fixes the SmartFinder/SmartMotion/Cage Mode TTS race
      // where the destination screen's CameraView / mic-recorder claimed
      // the iOS audio session mid-utterance and clipped Kevin's reply.
      let pushPath: string;
      if (toolName === 'lie_analysis' || toolName === 'tightlie') {
        // Phase H — pass play_intent through as a query param for /lie-analysis.
        // Phase AS — TightLie alias also routes here.
        const playIntent = String(intent.parameters.play_intent ?? '').toLowerCase();
        pushPath = (playIntent === 'aggressive' || playIntent === 'conservative')
          ? `${action.path}?intent=${playIntent}`
          : action.path;
      } else if (isIssueLog && wantsSend) {
        // 2026-05-26 — Fix DW: ?send=1 tells owner-logs.tsx to fire
        // the mailto export on mount. One utterance, one tap-to-send.
        pushPath = `${action.path}?send=1`;
      } else if ((toolName === 'smartmotion' || toolName === 'smart_motion') && (angle || autoStart || shotType || subject)) {
        const params: string[] = [];
        if (angle) params.push(`angle=${angle}`);
        if (autoStart) params.push('autoStart=1');
        // 2026-05-25 — Fix AJ Phase 1: shotType ("chip"/"putt"/"swing")
        // and subject (whose swing) get forwarded as URL params so
        // quick-record can pre-fill the tag + family-member context
        // without requiring the user to tap through the picker.
        if (shotType) params.push(`shotType=${encodeURIComponent(shotType)}`);
        if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
        pushPath = `${action.path}?${params.join('&')}`;
      } else {
        pushPath = action.path;
      }

      // 2026-05-21 — Fix B: when the voice command picked an angle,
      // confirm it in the spoken response so the user knows the
      // analyst is reading the correct orientation.
      let voiceResponse: string;
      if (toolName === 'lie_analysis' || toolName === 'tightlie') {
        voiceResponse = 'Let me look.';
      } else if ((toolName === 'smartmotion' || toolName === 'smart_motion') && angle) {
        const label = angle === 'down_the_line' ? 'down the line' : 'face on';
        voiceResponse = autoStart ? `Recording ${label}.` : `SmartMotion, ${label}.`;
      } else if ((toolName === 'coach_mode' || toolName === 'coachmode') && coachedPlayerName) {
        voiceResponse = `Coach Mode — coaching ${coachedPlayerName}.`;
      } else if (toolName === 'cage_mode' || toolName === 'cagemode') {
        // 2026-05-24 — Hands-free Cage Mode opener — phrasing per spec
        // signals the user that auto-swing-capture is about to engage.
        voiceResponse = "Cage mode starting. I'll capture every swing.";
      } else if (toolName === 'smartplay' || toolName === 'smart_play') {
        voiceResponse = "I'll take a look.";
      } else if (isIssueLog) {
        voiceResponse = wantsSend ? 'Opening Issue Log to send.' : 'Opening Issue Log.';
      } else {
        voiceResponse = 'Opening ' + TOOL_LABEL[toolName] + '.';
      }

      const sideEffects =
        toolName === 'cage_mode' || toolName === 'cagemode'
          ? ['tool_opened']
          : ['navigate:' + action.path];
      return {
        success: true,
        voice_response: voiceResponse,
        side_effects: sideEffects,
        follow_up_needed: false,
        tool_action: { type: 'navigate', path: pushPath },
      };
    }

    return {
      success: true,
      voice_response: 'Opening ' + TOOL_LABEL[toolName] + '.',
      side_effects: ['tool_action:' + action.type],
      follow_up_needed: false,
      tool_action: action,
    };
  },
};
