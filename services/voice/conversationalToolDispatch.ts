/**
 * 2026-07-04 (clean-audit C1 — "the brain SPEAKS as if it acted but doesn't act") —
 * the FULL service-level tool-action dispatcher for the hands-free mic paths
 * (earbud / badge / watch via services/listeningSession).
 *
 * History: the 2026-07-01 version dispatched only a 3-tool "service-safe subset"
 * (switch_caddie / navigate / navigate_replace) and silently IGNORED the other ~17
 * tools the brain can emit — while the server had already told the model the tool
 * was "dispatched to device", so the caddie verbally confirmed actions that never
 * happened ("Reminder set!" → nothing saved). That violates the honesty rule.
 * Every brain-emittable tool is now dispatched here with the SAME semantics as the
 * caddie-tab dispatcher.
 *
 * NOTE (drift guard): app/(tabs)/caddie.tsx handleToolAction is the tab-mounted
 * twin of this dispatcher (it additionally updates on-screen caddie text). When a
 * NEW tool is added, wire it in BOTH places — the sim scenario suite asserts the
 * shared tool set stays in sync.
 */

import { router } from 'expo-router';
import { Linking } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';
import { getScreenContext } from '../screenContext';

const PERSONAS = ['kevin', 'serena', 'harry', 'tank', 'custom'] as const;

// 2026-07-30 (Tim — "in the tell-your-caddie mode, caddie keeps opening SwingLab while I'm
// telling it my faults; the conversation is meant to gather info and build the profile by
// voice"). The get-to-know conversation is a PURE profile-building interview — describing a
// swing fault ("I come over the top", "I slice it") is INFORMATION, not a command to open a
// drill. The brain sometimes maps a named fault → its fault-drill → navigate, yanking the
// player out of the interview. This is a deterministic client-side guard so it can NEVER
// happen while the get-to-know context is active, regardless of what the LLM emits — we drop
// every navigational / tool-opening action and keep only the profile-building ones
// (log_issue, set_reminder, log_emotional_state, set_golfer, switch_caddie stay useful).
const GET_TO_KNOW_SCREEN = 'getting to know the golfer';
const NAV_OPEN_ACTIONS = new Set([
  'navigate', 'navigate_replace',
  'open_smartvision', 'open_smartfinder', 'open_swinglab',
  'record_swing', 'configure_drill', 'set_angle', 'close_swinglab',
]);
/** True while the voice conversation is the get-to-know profile interview. */
export function isGetToKnowMode(): boolean {
  try {
    return getScreenContext()?.screen === GET_TO_KNOW_SCREEN;
  } catch {
    return false;
  }
}
/** In get-to-know mode, a navigational/tool-opening action must be suppressed. */
export function isSuppressedInGetToKnow(actionType: string | undefined): boolean {
  return isGetToKnowMode() && !!actionType && NAV_OPEN_ACTIONS.has(actionType);
}

// The ONE external-URL allowlist for voice-driven open_url actions (moved here
// from listeningSession when tool dispatch was centralized). HTTPS-only + these
// hosts, to prevent open-redirect via a compromised/malformed server response.
const ALLOWED_URL_HOSTS = [
  'smartplaycaddie.com',
  'support.smartplaycaddie.com',
  'apps.apple.com',
  'play.google.com',
  'golfcourseapi.com',
];
function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

type AnyAction = {
  type?: string;
  // navigate / open_url
  path?: string;
  url?: string;
  // switch_caddie / set_golfer
  personality?: string;
  name?: string;
  // register_bag (2026-08-08 — spoken bag registration)
  clubs?: string[];
  distances?: { club: string; yards: number; kind?: 'carry' | 'total' | null }[];
  // log_score / log_shot / plan_shot
  hole?: number;
  score?: number;
  club?: string;
  direction?: string;
  contactQuality?: string;
  outcome?: string;
  feel?: string;
  shot_number?: number;
  distance_yards?: number;
  target?: string;
  shape?: string;
  // set_reminder
  text?: string;
  when?: string;
  // log_emotional_state
  state?: string;
  valence?: 'positive' | 'neutral' | 'negative';
  // log_issue
  note?: string;
  // configure_drill / set_angle
  shot_count?: number;
  angle?: string;
  // zoom_target (2026-08-20 — voice magnification of the rangefinder scene)
  level?: 'in' | 'out' | 'reset';
  // set_session_focus / set_playing_condition (2026-08-21)
  goal?: string;
  stated?: string;
  kind?: string;
  compensate?: string;
  clear?: boolean;
};

function toast(msg: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../../store/toastStore') as typeof import('../../store/toastStore')).useToastStore.getState().show(msg);
  } catch { /* toast is best-effort */ }
}

/** Paywall-gated navigation, mirroring the tab dispatcher's open_* cases. */
function gatedOpen(feature: 'smartvision' | 'smartfinder', path: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { canAccess } = require('../featureAccess') as typeof import('../featureAccess');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { triggerPaywall } = require('../paywallGuard') as typeof import('../paywallGuard');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile = (require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore')).usePlayerProfileStore.getState();
    if (!canAccess(feature, profile.subscription_status)) {
      void triggerPaywall(feature, () => router.push('/paywall' as never));
      return;
    }
  } catch { /* gate is best-effort — fall through to open */ }
  router.push(path as never);
}

function dispatchOne(a: AnyAction): void {
  switch (a.type) {
    case 'switch_caddie': {
      if (a.personality && (PERSONAS as readonly string[]).includes(a.personality)) {
        // setCaddiePersonality fires its own spoken handoff intro; sync the
        // custom-caddie flag exactly like the tab cycler does.
        useSettingsStore.getState().setCaddiePersonality(a.personality as (typeof PERSONAS)[number]);
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../../store/playerProfileStore') as typeof import('../../store/playerProfileStore'))
            .usePlayerProfileStore.getState().setUseCustomCaddie(a.personality === 'custom');
        } catch { /* sync is best-effort */ }
      }
      break;
    }
    case 'navigate':
      if (typeof a.path === 'string' && a.path.length > 0) router.push(a.path as never);
      break;
    case 'navigate_replace':
      if (typeof a.path === 'string' && a.path.length > 0) router.replace(a.path as never);
      break;
    case 'open_smartvision':
      gatedOpen('smartvision', '/smartvision');
      break;
    case 'open_smartfinder':
      gatedOpen('smartfinder', '/smartfinder');
      break;
    case 'open_swinglab':
      router.push('/(tabs)/swinglab' as never);
      break;
    case 'set_session_focus': {
      /**
       * 2026-08-21 — completes a wire that existed on the CLASSIFIER path since early on and never
       * became a brain tool. Saying "let's work on tempo today" hands-free set a focus; saying it to
       * the caddie in conversation did nothing, which is how most people talk to it.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sf = require('../../store/sessionFocusStore') as typeof import('../../store/sessionFocusStore');
      if (a.clear) sf.useSessionFocusStore.getState().clearFocus();
      else if (typeof a.goal === 'string' && a.goal.trim()) {
        sf.useSessionFocusStore.getState().setFocus(a.goal.trim(), { note: typeof a.note === 'string' ? a.note : null });
      }
      break;
    }
    case 'set_playing_condition': {
      /**
       * 2026-08-21 (Tim) — "I'm hitting everything left today… that's where I'm gonna hit. We gotta
       * say okay, we're gonna aim a little the other direction now."
       *
       * Recorded as the operating truth for the session, NOT as something to coach. The store keeps
       * the arc so an overcorrection later reads as an overcorrection rather than a fresh fault.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pc = require('../../store/playingConditionStore') as typeof import('../../store/playingConditionStore');
      if (a.clear) pc.usePlayingConditionStore.getState().clearCondition();
      else if (typeof a.stated === 'string' && a.stated.trim()) {
        pc.usePlayingConditionStore.getState().setCondition({
          stated: a.stated.trim(),
          kind: (a.kind as 'ball_flight' | 'physical' | 'feel') ?? 'ball_flight',
          compensate: (a.compensate as 'left' | 'right' | 'shorter' | 'longer' | undefined) ?? null,
        });
      }
      break;
    }
    case 'zoom_target': {
      /**
       * 2026-08-20 (Tim — "tap OR ASK to zoom the pin flag and get a tight read").
       *
       * Mirrors record_swing: if the screen is up, nudge it; if it is not, OPEN it and then nudge.
       * Asking to zoom while looking at something else should land you on the rangefinder already
       * magnified, not silently do nothing — that gap is the difference between a tool that exists
       * and a tool that feels connected.
       *
       * The command is emitted after the push because the screen has to mount and subscribe first;
       * an emit into an empty listener set is simply lost, and the player would have to ask twice.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bus = require('../smartFinderCommandBus') as typeof import('../smartFinderCommandBus');
      const level = a.level === 'out' ? 'zoomOut' : a.level === 'reset' ? 'zoomReset' : 'zoomIn';
      if (bus.isSmartFinderActive()) {
        bus.emitSmartFinderCommand(level);
      } else {
        gatedOpen('smartfinder', '/smartfinder');
        setTimeout(() => { try { bus.emitSmartFinderCommand(level); } catch { /* screen may have closed */ } }, 900);
      }
      break;
    }
    case 'record_swing': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bus = require('../smartMotionRecordBus') as typeof import('../smartMotionRecordBus');
      if (bus.isSmartMotionActive()) bus.emitSmartMotionCommand('start');
      else router.push('/swinglab/smartmotion?autoRecord=1' as never);
      break;
    }
    case 'configure_drill': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bus = require('../smartMotionRecordBus') as typeof import('../smartMotionRecordBus');
      // 2026-07-06 (nav audit) — if SmartMotion is CLOSED there are no bus listeners,
      // so the drill config was silently dropped. Open SmartMotion carrying the shot
      // count + rolling (parity with the record_swing fallback above).
      if (bus.isSmartMotionActive()) {
        bus.emitDrillConfig({ club: a.club, shotCount: a.shot_count });
      } else {
        const parts = ['autoRecord=1'];
        if (typeof a.shot_count === 'number' && a.shot_count > 0) parts.push(`drillShots=${Math.round(a.shot_count)}`);
        // 2026-07-10 (audit V7) — carry the club too; the closed-app launch was dropping it,
        // so "set me up a 7-iron drill" opened with the right shot count but no club selected.
        if (a.club) parts.push(`club=${encodeURIComponent(String(a.club))}`);
        router.push(`/swinglab/smartmotion?${parts.join('&')}` as never);
      }
      break;
    }
    case 'close_swinglab': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bus = require('../smartMotionRecordBus') as typeof import('../smartMotionRecordBus');
      bus.emitSmartMotionCommand('close');
      break;
    }
    case 'set_angle': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bus = require('../smartMotionRecordBus') as typeof import('../smartMotionRecordBus');
      // 2026-07-06 (nav audit) — same as configure_drill: a closed SmartMotion has no
      // listeners, so "record me face on" was dropped. Open it set to that angle + rolling.
      if (bus.isSmartMotionActive()) {
        if (a.angle === 'face_on') bus.emitSmartMotionCommand('angleFaceOn');
        else if (a.angle === 'putt') bus.emitSmartMotionCommand('puttOn');
        else bus.emitSmartMotionCommand('angleDtl');
      } else {
        const angleParam = a.angle === 'face_on' ? 'face_on' : a.angle === 'putt' ? 'putt' : 'down_the_line';
        router.push(`/swinglab/smartmotion?angle=${angleParam}&autoRecord=1` as never);
      }
      break;
    }
    case 'set_golfer': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fam = (require('../../store/familyStore') as typeof import('../../store/familyStore')).useFamilyStore.getState();
      const name = a.name?.trim();
      if (!name || /^(me|myself|i)$/i.test(name)) fam.setActiveMember(null);
      else {
        const lower = name.toLowerCase();
        const m = fam.members.find((mm) => (mm.firstName ?? '').toLowerCase() === lower)
          ?? fam.members.find((mm) => (mm.firstName ?? '').toLowerCase().startsWith(lower));
        if (m) fam.setActiveMember(m.id);
      }
      break;
    }
    case 'register_bag': {
      // 2026-08-08 (Tim — "tell the caddie what's in my bag and my yardages and it registers"). One
      // guarded seam (bagVoiceRegistration): clubs → clubBagStore (source 'voice'), stated yardages →
      // clubStatsStore honest-carry chain — the SAME stores the brain's registered-bag/club_distances
      // prompt reads, so the next club call quotes the numbers he just said. Unparsed phrases return in
      // `missed`; the brain's confirm can ask about them instead of guessing.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const reg = (require('../bagVoiceRegistration') as typeof import('../bagVoiceRegistration'));
        const result = reg.registerBagFromSpeech({
          clubs: Array.isArray(a.clubs) ? (a.clubs as string[]) : null,
          distances: Array.isArray(a.distances)
            ? (a.distances as { club: string; yards: number; kind?: 'carry' | 'total' | null }[])
            : null,
        });
        if (result.registered.length > 0 || result.distancesSet.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../../store/toastStore') as typeof import('../../store/toastStore'))
            .useToastStore.getState().show(result.confirmLine || 'Bag updated');
        }
        console.log(`[register_bag] +${result.registered.length} clubs, ${result.distancesSet.length} distances, missed=${result.missed.join('|') || 'none'}`);
      } catch (e) { console.log('[register_bag] failed (non-fatal):', e); }
      break;
    }
    case 'mark_tee': {
      // 2026-07-09 — actually PERSIST the mark from GPS (was only signalling the usually-
      // unmounted SmartVision screen, so "marked" was a lie off that screen). Still signal so
      // a mounted SmartVision updates its on-screen marker too.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void (require('../gpsMarkOverride') as typeof import('../gpsMarkOverride')).writeGpsMarkOverride('tee');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore'))
        .useSmartVisionSignalStore.getState().signalMark('tee');
      break;
    }
    case 'mark_green': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      void (require('../gpsMarkOverride') as typeof import('../gpsMarkOverride')).writeGpsMarkOverride('green');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore'))
        .useSmartVisionSignalStore.getState().signalMark('pin');
      break;
    }
    case 'log_score': {
      if (typeof a.score !== 'number' || !Number.isFinite(a.score)) break;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
      // 2026-08-09 (pass-2 P5) — don't write into a dead store: a brain-emitted log_score racing just
      // after endRound would flash a transient score on the scorecard between rounds (never persisted).
      if (!round.isRoundActive) break;
      // 2026-08-09 (on-course audit C2) — bare score → lowest unscored hole at/behind currentHole.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { voiceScoreHole } = require('../../store/roundStore') as typeof import('../../store/roundStore');
      const targetHole = typeof a.hole === 'number' && a.hole > 0 ? Math.round(a.hole) : voiceScoreHole(round);
      const rounded = Math.round(a.score);
      const alreadyScored = (round.scores[targetHole] ?? 0) > 0;
      round.logScore(targetHole, rounded);
      if (!alreadyScored) {
        // 2026-08-11 (adversarial audit) — REMOVED. roundStore.logScore now DERIVES the mental state
        // from the scorecard at the one seam every score path funnels through. This ran right after
        // logScore and re-accumulated over it, so the per-surface tally won and the derived value was
        // thrown away — the "forget the last three" fix was inert on this path too.
      }
      break;
    }
    case 'log_shot': {
      // Mirrors the tab dispatcher's log_shot case (caddie.tsx) — keep in sync.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const roundMod = require('../../store/roundStore') as typeof import('../../store/roundStore');
      const round = roundMod.useRoundStore.getState();
      const dirMap: Record<string, 'left' | 'straight' | 'right' | null> = {
        left: 'left', pull: 'left', hook: 'left',
        right: 'right', push: 'right', slice: 'right',
        straight: 'straight', fade: 'straight', draw: 'straight',
      };
      const shapeMap: Record<string, 'draw' | 'straight' | 'fade' | null> = {
        draw: 'draw', hook: 'draw', fade: 'fade', slice: 'fade', push: 'fade', pull: 'draw', straight: 'straight',
      };
      const feelMap: Record<string, import('../../store/roundStore').ShotResult['feel']> = {
        fat: 'fat', thin: 'thin', heel: 'heel', toe: 'toe', pure: 'pure', topped: 'topped',
      };
      let startLoc: { lat: number; lng: number } | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fix = (require('../gpsManager') as typeof import('../gpsManager')).getLastFix();
        if (fix) startLoc = { lat: fix.lat, lng: fix.lng };
      } catch { /* non-fatal */ }
      // 2026-08-09 (Tim — club-use logic) — ONE arbiter: explicit club > the more RECENT of the
      // player's declared club vs the caddie's advice. Silent adherence now attributes the ADVISED
      // club to the shot (it used to log club:null and learn nothing).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveShotClub } = require('../shotClubResolver') as typeof import('../shotClubResolver');
      const resolved = resolveShotClub(typeof a.club === 'string' ? a.club : null);
      const shotClub = resolved.club;
      const shotHole = typeof a.hole === 'number' && a.hole > 0 ? Math.round(a.hole) : round.currentHole;
      const dist = typeof a.distance_yards === 'number' && a.distance_yards > 0 && a.distance_yards <= 500
        ? Math.round(a.distance_yards) : null;
      round.logShot({
        hole: shotHole,
        timestamp: Date.now(),
        feel: a.contactQuality ? feelMap[a.contactQuality] ?? null : null,
        direction: a.direction ? dirMap[a.direction] ?? null : null,
        shape: a.direction ? shapeMap[a.direction] ?? null : null,
        club: shotClub,
        acousticContact: null,
        outcome_text: a.outcome ?? null,
        swing_feel: a.feel ?? null,
        logged_via: 'voice',
        start_location: startLoc,
        distance_yards: dist,
        shot_number: typeof a.shot_number === 'number' && a.shot_number > 0 ? Math.round(a.shot_number) : null,
        kevin_rec_club: resolved.recClub,
        kevin_rec_shape: resolved.recShape,
        kevin_adhered: resolved.adhered,
      });
      round.clearPendingKevinRec();
      break;
    }
    case 'recommend_club': {
      // 2026-08-09 (Tim — exact club attribution) — the caddie just advised a club for THIS shot.
      // Stamp it as the pending rec with the EXACT spoken club (overwrites the distance-proxy stamp
      // from the shot-strategy query path). If the player then hits it without changing clubs, the
      // shot-club resolver attributes THIS club and its measured distance trains the bag. Active-round
      // only; clears on hole change; the resolver arbitrates it against any club the player declares.
      if (typeof a.club === 'string' && a.club.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const round = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
        if (round.isRoundActive) {
          // kind 'spoken': the caddie said this club out loud. The only kind adherence is measured on.
          round.setPendingKevinRec({ club: a.club.trim(), shape: typeof a.shape === 'string' && a.shape.trim() ? a.shape.trim() : null, aimPoint: null, kind: 'spoken' });
        }
      }
      break;
    }
    case 'plan_shot': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
      if (typeof a.club === 'string' && a.club.trim()) round.setClub(a.club.trim());
      if (typeof a.distance_yards === 'number' && a.distance_yards > 0 && a.distance_yards <= 700) {
        round.setUserStatedYardage(Math.round(a.distance_yards), 'user');
      }
      const bits = [
        a.club?.trim() || null,
        typeof a.distance_yards === 'number' && a.distance_yards > 0 ? `${Math.round(a.distance_yards)}y` : null,
        typeof a.shot_number === 'number' && a.shot_number > 0 ? `shot ${Math.round(a.shot_number)}` : null,
        a.target?.trim() ? `→ ${a.target.trim()}` : null,
      ].filter(Boolean).join(' · ');
      toast(bits ? `Plan set — ${bits}` : 'Plan noted');
      break;
    }
    case 'set_reminder': {
      if (typeof a.text === 'string' && a.text.trim()) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../../store/practicePlanStore') as typeof import('../../store/practicePlanStore'))
          .usePracticePlanStore.getState().addReminder(a.text.trim(), a.when ?? null);
        toast(`⏰ Reminder set${a.when ? ` — ${a.when.trim()}` : ''}`);
      }
      break;
    }
    case 'log_emotional_state': {
      if (typeof a.state === 'string' && (a.valence === 'positive' || a.valence === 'neutral' || a.valence === 'negative')) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const round = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
        round.logEmotionalState(a.state, a.valence, round.currentHole);
        const emoji = a.valence === 'positive' ? '💚' : a.valence === 'negative' ? '🫶' : '👍';
        toast(a.state.trim() ? `Noted — ${a.state.trim()} ${emoji}` : `Got it ${emoji}`);
      }
      break;
    }
    case 'log_issue': {
      if (typeof a.note === 'string') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require('../../store/issueLogStore') as typeof import('../../store/issueLogStore'))
          .useIssueLogStore.getState().addUserIssue(a.note ?? '');
        toast('📝 Logged to the issue log');
      }
      break;
    }
    case 'open_url': {
      const url = a.url;
      if (typeof url !== 'string' || url.length === 0) break;
      if (url.startsWith('/')) router.push(url as never);
      else if ((url.startsWith('http://') || url.startsWith('https://')) && isAllowedExternalUrl(url)) {
        void Linking.openURL(url).catch(() => {});
      }
      break;
    }
    default:
      // Unknown tool — log loudly rather than silently swallow (audit L6).
      console.log('[toolDispatch] unhandled tool action type:', a.type);
  }
}

/**
 * Dispatch every tool action the brain returned on a hands-free path.
 * Best-effort per action: one bad action never breaks the spoken reply
 * or the remaining actions.
 */
export function dispatchConversationalToolActions(actions: unknown[]): void {
  if (!Array.isArray(actions) || actions.length === 0) return;
  for (const raw of actions) {
    try {
      const t = (raw as AnyAction)?.type;
      if (isSuppressedInGetToKnow(t)) {
        console.log('[toolDispatch] suppressed in get-to-know mode:', t);
        continue;
      }
      dispatchOne(raw as AnyAction);
    } catch (e) {
      console.log('[toolDispatch] action failed (non-fatal):', (raw as AnyAction)?.type, e);
    }
  }
}
