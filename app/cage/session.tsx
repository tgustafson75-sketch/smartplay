/**
 * Phase BV — Reconcile dual cage UIs.
 *
 * This file previously hosted the older feel/shape grid + Log Shot button
 * + Kevin coach box live-session UI (1012 lines). Phase BU audit
 * Component 2 finding F4 identified that as the second of two parallel
 * cage UIs, root cause of the "buttons jumbled" symptom Tim observed in
 * the studio session.
 *
 * Phase BV reconciles to a single canonical UI: components/CageSessionOverlay.tsx.
 * This route (/cage/session) now thin-wraps the overlay so every cage
 * entry point converges on the same component:
 *
 *   - SwingLab tab Cage Mode card → inline overlay (existing path)
 *   - SwingLab tab Cage Setup card → /cage → /cage/session (this file → overlay)
 *   - Caddie Tools menu Cage Mode → /cage → /cage/session (this file → overlay)
 *
 * Feature migration decisions documented in docs/phase-BV-migration.md.
 *
 * The cageLog [path3:cage] markers in the overlay carry the trace; this
 * wrapper adds one boundary marker so the route handoff is visible in
 * logcat for verification recipes (see docs/cage-telemetry-map.md).
 */

import React from 'react';
import { useRouter } from 'expo-router';
import CageSessionOverlay from '../../components/CageSessionOverlay';
import { cageLog } from '../../services/cageTelemetry';

export default function CageSession() {
  const router = useRouter();

  return (
    <CageSessionOverlay
      onComplete={(sessionId) => {
        cageLog('route-session-complete', 'ok', { library_entry_id: sessionId });
        if (sessionId) {
          router.replace(`/swinglab/swing/${sessionId}` as never);
        } else {
          router.replace('/swinglab/library' as never);
        }
      }}
      onCancel={() => {
        cageLog('route-session-cancel', 'ok');
        router.replace('/cage' as never);
      }}
    />
  );
}
