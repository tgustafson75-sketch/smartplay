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

const PERSONAS = ['kevin', 'serena', 'harry', 'tank', 'custom'] as const;

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
      bus.emitDrillConfig({ club: a.club, shotCount: a.shot_count });
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
      if (a.angle === 'face_on') bus.emitSmartMotionCommand('angleFaceOn');
      else if (a.angle === 'putt') bus.emitSmartMotionCommand('puttOn');
      else bus.emitSmartMotionCommand('angleDtl');
      break;
    }
    case 'set_golfer': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fam = (require('../../store/familyStore') as typeof import('../../store/familyStore')).useFamilyStore.getState();
      const name = a.name?.trim();
      if (!name || /^(me|myself|i)$/i.test(name)) fam.setActiveMember(null);
      else {
        const lower = name.toLowerCase();
        const m = fam.members.find((mm) => mm.firstName.toLowerCase() === lower)
          ?? fam.members.find((mm) => mm.firstName.toLowerCase().startsWith(lower));
        if (m) fam.setActiveMember(m.id);
      }
      break;
    }
    case 'mark_tee': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore'))
        .useSmartVisionSignalStore.getState().signalMark('tee');
      break;
    }
    case 'mark_green': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../store/smartVisionSignalStore') as typeof import('../../store/smartVisionSignalStore'))
        .useSmartVisionSignalStore.getState().signalMark('pin');
      break;
    }
    case 'log_score': {
      if (typeof a.score !== 'number' || !Number.isFinite(a.score)) break;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const round = (require('../../store/roundStore') as typeof import('../../store/roundStore')).useRoundStore.getState();
      const targetHole = typeof a.hole === 'number' && a.hole > 0 ? Math.round(a.hole) : round.currentHole;
      const rounded = Math.round(a.score);
      const alreadyScored = (round.scores[targetHole] ?? 0) > 0;
      round.logScore(targetHole, rounded);
      if (!alreadyScored) {
        try {
          const targetPar = round.courseHoles.find((c) => c.hole === targetHole)?.par ?? 4;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('../../store/relationshipStore') as typeof import('../../store/relationshipStore'))
            .useRelationshipStore.getState().updateMentalState(rounded, targetPar);
        } catch { /* mental-state is best-effort */ }
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
      const pendingRec = round.pendingKevinRec ?? null;
      const shotClub = a.club ?? round.club ?? null;
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
        kevin_rec_club: pendingRec?.club ?? null,
        kevin_rec_shape: pendingRec?.shape ?? null,
        kevin_adhered: pendingRec?.club != null && shotClub != null ? shotClub === pendingRec.club : null,
      });
      round.clearPendingKevinRec();
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
      dispatchOne(raw as AnyAction);
    } catch (e) {
      console.log('[toolDispatch] action failed (non-fatal):', (raw as AnyAction)?.type, e);
    }
  }
}
