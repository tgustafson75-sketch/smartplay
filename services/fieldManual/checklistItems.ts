/**
 * Field Manual — verification checklist items.
 *
 * Static list of checkable claims derived from the field-manual sections
 * (docs/field-manual/). Each item is something the owner can verify by
 * inspection or device test, then check off + note. The checklist is
 * meant to be run pre-beta against a real Z Fold / iPhone build.
 *
 * Persisted state (checked + notes) lives in store/fieldManualChecklistStore.ts.
 * Export-as-markdown lives in the screen at app/field-manual.tsx.
 *
 * 2026-05-24 — Built per the field-manual sprint.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  detail?: string;
}

export interface ChecklistSection {
  id: string;
  title: string;
  hint?: string;
  items: readonly ChecklistItem[];
}

export const CHECKLIST_SECTIONS: readonly ChecklistSection[] = [
  {
    id: 'product',
    title: '01 — Product',
    hint: 'Verify brand + persona equality on device.',
    items: [
      { id: 'p1', label: 'App name reads "SmartPlay Caddie" on every surface' },
      { id: 'p2', label: 'Builder line reads "Built by SmartPlay AI" (never a single caddie)' },
      { id: 'p3', label: 'All four caddies are selectable; Tank is scoped to ask_golf_father volume' },
      { id: 'p4', label: 'No surface elevates one caddie as "the face"' },
      { id: 'p5', label: 'Per-pillar caddie assignment works (settingsStore.caddieAssignments)' },
    ],
  },
  {
    id: 'architecture',
    title: '02 — Architecture',
    hint: 'Voice + GPS + capture pipelines functional end-to-end.',
    items: [
      { id: 'a1', label: 'Voice intent classifier auto-detects ES/ZH from utterance text' },
      { id: 'a2', label: 'voiceCommandRouter.dispatch returns IntentResult with voice_response + side_effects' },
      { id: 'a3', label: 'Auto-speak fires on voice path; tap path does NOT auto-speak' },
      { id: 'a4', label: 'GPS adaptive polling: active / walking / stationary modes engage correctly' },
      { id: 'a5', label: 'resolveGreenCoords cascade returns truth > override > courseHoles > geometryCache > none', detail: 'Verify the source label on a hole with each tier seeded.' },
      { id: 'a6', label: 'Spoken yardage matches on-screen yardage (no drift)' },
      { id: 'a7', label: 'Metric ~ prefix shows on pose/acoustic/profile sources; dropped on truth-grade' },
      { id: 'a8', label: 'Trust L1 (Quiet / Cockpit) silences proactive speech but allows userInitiated taps' },
      { id: 'a9', label: 'Slider order is [1,2,3] (TRUST_LEVEL_SLIDER_ORDER) — L1 Cockpit, L2 Companion, L3 Active' },
    ],
  },
  {
    id: 'features',
    title: '03 — Feature state',
    hint: 'Each shipped feature behaves per spec; stubs degrade honestly.',
    items: [
      { id: 'f1', label: 'SmartMotion: vision read returns structured PrimaryIssue (fault + cause + fix + drill + evidence)' },
      { id: 'f2', label: 'SmartMotion: inconclusive / no_dominant_fault render the honest empty state (no fake fix)' },
      { id: 'f3', label: 'SmartMotion: acoustic ball speed renders with ~ + (acoustic, club-typical, med)' },
      { id: 'f4', label: 'SmartMotion: skeleton overlay does NOT render in production (DEV-gated)' },
      { id: 'f5', label: 'SmartMotion: club picker pre-fills from recognition + manual override works' },
      { id: 'f6', label: 'SmartVision: Golfshot satellite + Vector SVG renderers both functional' },
      { id: 'f7', label: 'SmartVision: no_geometry fallback shows Mark Green prompt (no silent ok)' },
      { id: 'f8', label: 'TightLie: lie analysis captures, attaches to next logged shot, then clears' },
      { id: 'f9', label: 'PLAY: Play tab course discovery + Start Round + factor pickers all work' },
      { id: 'f10', label: 'PLAY: Dashboard renders weather + recent rounds + stats roll-up' },
      { id: 'f11', label: 'Feel capture (owner-only): toggle on → transcript persists on shot' },
      { id: 'f12', label: 'Club recognition: photo of sole returns confident club_id; manual override available' },
      { id: 'f13', label: 'Meta glasses ingest: new photo/video surfaces a banner; analysis routes correctly' },
      { id: 'f14', label: 'Caddie rewards: 250+ measured drive fires; 1-putt fires; both vary, no immediate repeat' },
      { id: 'f15', label: 'Caddie rewards: silent at L1 (Quiet/Cockpit); fire at L2-L3' },
      { id: 'f16', label: 'Acoustic ball speed: ~ prefix + range + med confidence (never truth-grade)' },
      { id: 'f17', label: 'pose-analysis returns 200-with-null when unconfigured (no crash)' },
      { id: 'f18', label: 'swing-tempo 501 is intentional (Vercel Edge ffmpeg limit)' },
      { id: 'f19', label: 'Truth-first resolver: setCourseTruth wins over Mark Green + courseHoles + geometry cache' },
      { id: 'f20', label: 'Scenario harness at /harness: all 17 scenarios PASS or SKIP cleanly' },
    ],
  },
  {
    id: 'conventions',
    title: '04 — Conventions & rules',
    hint: 'Standing rules observable in code + behavior.',
    items: [
      { id: 'c1', label: 'OTA-first: this build came via eas update, not new APK' },
      { id: 'c2', label: 'No fake precision: every number on screen has a source + confidence' },
      { id: 'c3', label: 'L1 silence verified: speak() at L1 without userInitiated is blocked' },
      { id: 'c4', label: 'isWide responsive layout works on tablet / fold open (centered max-width)' },
      { id: 'c5', label: 'CaddieAvatar canonical layout unchanged on Z Fold (no shift, no scale)' },
      { id: 'c6', label: 'CaddieAvatar state badge clears Dynamic Island on iPhone 15/16 Pro' },
      { id: 'c7', label: 'KeyboardAvoidingView wraps Play / Caddie notes / Settings / Reference / Cage / Custom Caddie inputs on iOS' },
      { id: 'c8', label: 'Branding: "@SmartPlayCaddie" and "support@smartplaycaddie.com" appear correctly in About / contact surfaces' },
    ],
  },
  {
    id: 'ship',
    title: '06 — Ship status',
    hint: 'Pre-beta gate readiness.',
    items: [
      { id: 's1', label: 'SHIP-QA: 0 P0 confirmed' },
      { id: 's2', label: 'SHIP-QA P1.1 acoustic 7I fallback removed (ball_speed_mph: null path verified)' },
      { id: 's3', label: 'SHIP-QA P1.2 carry_check uses practiceStore.avgCarryDriver + honest fallback' },
      { id: 's4', label: 'PLATFORM-QA P1.1: Play/Dashboard/SwingLab tabs constrain content on wide form factors' },
      { id: 's5', label: 'PLATFORM-QA P1.2: iOS keyboard does not obscure TextInputs' },
      { id: 's6', label: 'PLATFORM-QA P1.3: stateTag clears Dynamic Island' },
      { id: 's7', label: 'Field validation on real cart round (Z Fold) — no regressions' },
      { id: 's8', label: 'Field validation on iPhone — no regressions' },
      { id: 's9', label: 'iOS-sim visual confirmation pass complete' },
      { id: 's10', label: 'Fold open + closed visual confirmation pass complete' },
    ],
  },
  {
    id: 'known-issues',
    title: '07 — Known issues',
    hint: 'Verified-not-regressed pre-beta.',
    items: [
      { id: 'k1', label: 'Phantom round boot guard works (>8h stale rounds discarded)' },
      { id: 'k2', label: 'Library + videos persist across app close (no cloud sync, but device-local works)' },
      { id: 'k3', label: 'Sentry: confirmed not blocking build (SENTRY_DISABLE_AUTO_UPLOAD=true intentional)' },
      { id: 'k4', label: 'BT media-button no-op gracefully on both platforms (no crash)' },
      { id: 'k5', label: 'Galaxy Watch IMU: graceful empty state, no fake "watch connected" UI' },
    ],
  },
];

export const ALL_CHECKLIST_ITEM_IDS: readonly string[] = CHECKLIST_SECTIONS.flatMap(s =>
  s.items.map(i => `${s.id}.${i.id}`),
);

export function totalCheckCount(): number {
  return ALL_CHECKLIST_ITEM_IDS.length;
}

export function getItem(sectionId: string, itemId: string): ChecklistItem | undefined {
  const section = CHECKLIST_SECTIONS.find(s => s.id === sectionId);
  return section?.items.find(i => i.id === itemId);
}
