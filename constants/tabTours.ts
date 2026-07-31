/**
 * 2026-07-30 (Tim — "Show me around on the SwingLab tab, and basics on all main tabs"). Per-tab "basics"
 * guided-tour steps for the main bottom-bar tabs. Reuses components/onboarding/TourOverlay (the same dim
 * scrim + tooltip card the caddie tab uses). Mostly `center` cards (no per-element measurement needed) plus
 * the shared bottom-bar step, so each tab explains its purpose without extra instrumentation.
 *
 * Shown once per tab on first visit (within the first few opens) and on demand via Settings → "Show me
 * around" (relaunchTour bumps relaunchNonce; see hooks/useTabTour + store/onboardingTourStore).
 */
import type { TourStep } from '../components/onboarding/TourOverlay';

const BAR_STEP: TourStep = {
  key: 'bar', anchor: 'bottomBar', targetId: 'caddie.bar', icon: 'chevron-forward',
  title: 'The caddie is always here',
  body: 'This bar rides on every screen — tap the mic to talk to your caddie from anywhere, and use the arrows to move around. You never have to hunt through menus.',
};

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    key: 'dash-welcome', anchor: 'center', icon: 'home-outline',
    title: 'Your home base',
    body: "This is your dashboard — your rounds, stats, your bag, and how you're trending over time. Everything your caddie learns about your game lives here.",
  },
  {
    key: 'dash-bag', anchor: 'center', icon: 'golf-outline',
    title: 'Your bag + numbers',
    body: 'Your club distances and handicap update as you play. Tap your bag to edit it, or import your numbers — the caddie uses them for every club call.',
  },
  BAR_STEP,
];

export const PLAY_TOUR_STEPS: TourStep[] = [
  {
    key: 'play-welcome', anchor: 'center', icon: 'flag-outline',
    title: 'Start a round',
    body: 'Pick your course here and tee off. Once the round starts, your caddie follows you hole by hole with live yardages, club calls, and aim.',
  },
  {
    key: 'play-voice', anchor: 'center', icon: 'mic-outline',
    title: 'Play hands-free',
    body: 'During a round just talk — "how far?", "what club?", "I hit driver 260", "next hole". The caddie tracks your shots and keeps your scorecard as you go.',
  },
  BAR_STEP,
];

export const SCORECARD_TOUR_STEPS: TourStep[] = [
  {
    key: 'card-welcome', anchor: 'center', icon: 'list-outline',
    title: 'Your live scorecard',
    body: 'Your round, hole by hole. Log a score by voice ("I made a 5") or a tap — the caddie keeps the running total, putts, and your handicap.',
  },
  BAR_STEP,
];

export const SWINGLAB_TOUR_STEPS: TourStep[] = [
  {
    key: 'lab-welcome', anchor: 'center', icon: 'body-outline',
    title: 'Your swing coach',
    body: 'SwingLab is where the AI watches your motion. Record a swing or upload one, and it breaks down your tempo, body, and club path — clean, no gimmicks.',
  },
  {
    key: 'lab-analyze', anchor: 'center', icon: 'analytics-outline',
    title: 'Analyze + practice',
    body: 'Every swing gets an instant read and one thing to work on. Then run a drill built for that fault — your practice ties straight back to your rounds.',
  },
  {
    key: 'lab-upload', anchor: 'center', icon: 'cloud-upload-outline',
    title: 'Record or upload',
    body: 'New swings record right here, or upload from your camera roll — set who hit it and the angle so the read is accurate. Old clips in your library work too.',
  },
  BAR_STEP,
];
