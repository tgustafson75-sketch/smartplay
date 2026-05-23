import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import type { ToolAction } from '../../app/api/kevin+api';

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
  // SmartMotion" is a record-NOW intent — skip the canonical
  // smartmotion screen's NoClipHero marketing card and land the user
  // on the live camera (quick-record). After recording, quick-record
  // routes back to /swinglab/smartmotion?clipUri=... where the
  // Phase 416 two-card + Phase 418 validation gate take over for the
  // analysis depth. Library + SwingLab card entries still land on
  // /swinglab/smartmotion directly (review / intro context).
  // Aliases: "smartmotion", "smart_motion", "smart motion" — classifier
  // normalizes spaces/underscores.
  smartmotion: { type: 'navigate', path: '/swinglab/quick-record' },
  smart_motion: { type: 'navigate', path: '/swinglab/quick-record' },
  // 2026-05-19 — Acoustic Test Bench (Phase BO.1) was reachable via
  // SwingLab tile but had no voice intent route. The classifier could
  // emit tool_name='acoustic' / 'acoustic_test' / 'test_bench' but
  // the handler returned "unknown tool" because the map didn't list
  // it. Now all three variants resolve to /acoustic-test.
  acoustic: { type: 'navigate', path: '/acoustic-test' },
  acoustic_test: { type: 'navigate', path: '/acoustic-test' },
  test_bench: { type: 'navigate', path: '/acoustic-test' },
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
  acoustic: 'Acoustic Test Bench',
  acoustic_test: 'Acoustic Test Bench',
  test_bench: 'Acoustic Test Bench',
  gps_test: 'GPS Test Bench',
  gps_test_bench: 'GPS Test Bench',
  mark_green: 'Mark Green',
  markgreen: 'Mark Green',
  mark_tee: 'Mark Tee',
  marktee: 'Mark Tee',
  mark_tee_box: 'Mark Tee',
  coach_mode: 'Coach Mode',
  coachmode: 'Coach Mode',
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
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const toolName = String(intent.parameters.tool_name ?? '').toLowerCase();
    const action = TOOL_NAME_TO_ACTION[toolName];

    if (!action) {
      return {
        success: false,
        voice_response: 'Which tool — SmartVision, SmartFinder, SwingLab, scorecard, dashboard, or settings?',
        side_effects: ['unknown_tool'],
        follow_up_needed: true,
      };
    }

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

      try {
        const { router } = await import('expo-router');
        // Phase H — pass play_intent through as a query param for /lie-analysis.
        // Phase AS — TightLie alias also routes here.
        if (toolName === 'lie_analysis' || toolName === 'tightlie') {
          const playIntent = String(intent.parameters.play_intent ?? '').toLowerCase();
          const path = (playIntent === 'aggressive' || playIntent === 'conservative')
            ? `${action.path}?intent=${playIntent}`
            : action.path;
          router.push(path as never);
        } else if ((toolName === 'smartmotion' || toolName === 'smart_motion') && (angle || autoStart)) {
          const params: string[] = [];
          if (angle) params.push(`angle=${angle}`);
          if (autoStart) params.push('autoStart=1');
          router.push(`${action.path}?${params.join('&')}` as never);
        } else {
          router.push(action.path as never);
        }
      } catch (err) {
        console.log('[openToolHandler] navigate failed:', err);
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
      } else {
        voiceResponse = 'Opening ' + TOOL_LABEL[toolName] + '.';
      }

      return {
        success: true,
        voice_response: voiceResponse,
        side_effects: ['navigate:' + action.path],
        follow_up_needed: false,
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
