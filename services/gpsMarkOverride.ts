/**
 * 2026-07-09 — Shared "mark the tee / pin HERE from my GPS" override write.
 *
 * ROOT-CAUSE FIX: the local voice path (openToolHandler.tryVoiceDirectMark) persisted a real
 * per-course/per-hole GPS override, but the BRAIN tool path (conversationalToolDispatch
 * mark_tee/mark_green) only pinged the SmartVision screen — which is unmounted during a normal
 * hands-free round. So "mark the pin" in conversation confirmed "marked" and saved NOTHING.
 * Both paths now call THIS single function, so the mark always persists (whether or not
 * SmartVision is open) and the confirmation is never a lie.
 */

export async function writeGpsMarkOverride(kind: 'tee' | 'green'): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRoundStore } = require('../store/roundStore') as typeof import('../store/roundStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const gps = require('./gpsManager') as typeof import('./gpsManager');

    const round = useRoundStore.getState();
    if (!round.isRoundActive || round.activeCourseId == null) return false;

    const fix = gps.getLastFix();
    if (!fix || fix.lat == null || fix.lng == null) return false;
    // Same GPS quality gate the local path uses: don't trust a bad/stale fix for an override.
    if (fix.accuracy_m != null && fix.accuracy_m > 20) return false;
    if (Date.now() - fix.timestamp > 15_000) return false;

    const hole = round.currentHole;
    if (kind === 'tee') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('./courseTeeOverrides') as typeof import('./courseTeeOverrides');
      await m.setTeeOverride(round.activeCourseId, hole, { lat: fix.lat, lng: fix.lng });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('./courseGreenOverrides') as typeof import('./courseGreenOverrides');
      await m.setGreenOverride(round.activeCourseId, hole, { lat: fix.lat, lng: fix.lng });
    }
    return true;
  } catch (e) {
    console.log('[gpsMarkOverride] persist failed:', e);
    return false;
  }
}
