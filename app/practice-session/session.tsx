/**
 * Phase BV — Reconcile dual cage UIs.
 *
 * This file previously hosted the older feel/shape grid + Log Shot button
 * + Kevin coach box live-session UI (1012 lines). Phase BU audit
 * Component 2 finding F4 identified that as the second of two parallel
 * cage UIs, root cause of the "buttons jumbled" symptom Tim observed in
 * the studio session.
 *
 * Phase BV reconciles to a single canonical UI: components/PracticeSessionOverlay.tsx.
 * This route (/practice-session/session) now thin-wraps the overlay so every cage
 * entry point converges on the same component:
 *
 *   - SwingLab tab Cage Mode card → inline overlay (existing path)
 *   - SwingLab tab Cage Setup card → /cage → /practice-session/session (this file → overlay)
 *   - Caddie Tools menu Cage Mode → /cage → /practice-session/session (this file → overlay)
 *
 * Feature migration decisions documented in docs/phase-BV-migration.md.
 *
 * The practiceLog [path3:cage] markers in the overlay carry the trace; this
 * wrapper adds one boundary marker so the route handoff is visible in
 * logcat for verification recipes (see docs/cage-telemetry-map.md).
 */

import React from 'react';
import { useRouter } from 'expo-router';
import PracticeSessionOverlay from '../../components/PracticeSessionOverlay';
import { practiceLog } from '../../services/practiceTelemetry';

export default function SwingSession() {
  const router = useRouter();

  return (
    <PracticeSessionOverlay
      onComplete={(sessionId) => {
        practiceLog('route-session-complete', 'ok', { library_entry_id: sessionId });
        if (sessionId) {
          router.replace(`/swinglab/swing/${sessionId}` as never);
        } else {
          router.replace('/swinglab/library' as never);
        }
      }}
      onCancel={() => {
        practiceLog('route-session-cancel', 'ok');
        router.replace('/practice-session' as never);
      }}
    />
  );
}
