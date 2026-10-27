/**
 * 2026-10-25 (Sentry MK / MW / MV / MT / MY / MZ / N3 — `analysis_failed · live_capture · no_network`) —
 * A SWING CAPTURED WITHOUT SIGNAL IS READ WHEN THE SIGNAL COMES BACK.
 *
 * The swing itself was always kept; its read was not. The player was told to "check your network and
 * try Re-analyze", and if he did not — he was hitting balls, not watching the screen — that swing never
 * got its read. Now the read marks the session `read_awaits_connection` when the phone was PROVEN
 * offline (services/videoUpload), and this sends those reads again:
 *   - when the connection store goes from offline to online (the offline banner's recovery probe is
 *     what notices: it asks hosts that are not ours), and
 *   - once at launch, for swings left waiting when the app was closed.
 * One at a time, oldest first, through the one run (runSwingAnalysis): never a second read path, and
 * never beside a live capture's run (untilNoSwingRunIsLive). A read
 * that finds the phone still offline marks the swing again and waits for the next return.
 */
import { useSwingSessionStore } from '../../../store/swingSessionStore';
import { useConnectivityStore } from '../../../store/connectivityStore';
import { runSwingAnalysis } from './uploadRun';
import { liveRun, liveRunKeys } from './engine';

/**
 * Review (10-25) — A WAITING READ NEVER COMPETES WITH THE SWING THE PLAYER JUST HIT. Every run's body read
 * shares the one frame decoder; a drained swing's body-read tail queued ahead of a live capture's and
 * could run that one out of its budget. So the drain waits until no swing or shot run is going, and sends
 * the next waiting read only once the previous one's WHOLE run (read, body read, arc) has finished.
 */
async function untilNoSwingRunIsLive(): Promise<void> {
  for (let k = liveRunKeys().find(isSwingRun); k; k = liveRunKeys().find(isSwingRun)) {
    await liveRun(k)?.done;
  }
}
const isSwingRun = (k: string) => k.startsWith('swing:') || k.startsWith('shot:');

let draining: Promise<void> | null = null;

/** The swings whose read is waiting for a connection, oldest first. */
export function sessionsAwaitingConnection(): string[] {
  return useSwingSessionStore.getState().sessionHistory
    .filter((s) => s.read_awaits_connection === true)
    .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
    .map((s) => s.id);
}

/** Send every waiting read, one at a time. Joins a drain already going. */
export function readAwaitingSwings(): Promise<void> {
  if (draining) return draining;
  draining = (async () => {
    try {
      for (const id of sessionsAwaitingConnection()) {
        await untilNoSwingRunIsLive();
        if (!useConnectivityStore.getState().isOnline) break;   // gone again: the next return resumes
        // Still waiting? (a manual Re-analyze may have read it meanwhile)
        const s = useSwingSessionStore.getState().sessionHistory.find((x) => x.id === id);
        if (!s?.read_awaits_connection) continue;
        try {
          (require('../../analysisTrace') as typeof import('../../analysisTrace'))
            .traceStep('connection back — reading the swing that waited for it', {}, { sessionId: id });
        } catch { /* a trace never blocks the read */ }
        await runSwingAnalysis(id, { deferredRead: true }).catch(() => undefined);
      }
    } finally {
      draining = null;
    }
  })();
  return draining;
}

/** Start watching. Returns the unsubscribe. Called once at boot (app/_layout). */
export function startReadWhenOnline(opts: { launchDelayMs?: number } = {}): () => void {
  let wasOnline = useConnectivityStore.getState().isOnline;
  const unsub = useConnectivityStore.subscribe((st) => {
    const back = st.isOnline && !wasOnline;
    wasOnline = st.isOnline;
    if (back) void readAwaitingSwings();
  });
  // Swings left waiting by an earlier launch: try once the library has loaded. Offline still, the read
  // proves it again and the swing keeps waiting.
  let launchTimer: ReturnType<typeof setTimeout> | null = null;
  const atLaunch = () => {
    launchTimer = null;
    if (!useSwingSessionStore.getState().hasHydrated) { launchTimer = setTimeout(atLaunch, 2_000); return; }
    if (sessionsAwaitingConnection().length > 0) void readAwaitingSwings();
  };
  launchTimer = setTimeout(atLaunch, opts.launchDelayMs ?? 8_000);
  return () => { unsub(); if (launchTimer) clearTimeout(launchTimer); };
}
