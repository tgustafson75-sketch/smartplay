/**
 * Phase BX — Cage pipeline telemetry helper.
 *
 * Single source of truth for the [path3:cage] log format. Every stage
 * transition in the cage pipeline calls cageLog(stage, status, metadata)
 * so logcat | grep "path3:cage" returns a complete trace.
 *
 * Format:
 *   [path3:cage:STAGE] timestamp=ISO status=ok|fail|partial metadata={...}
 *
 * STAGE: kebab-case identifier of the pipeline stage (e.g. 'session-start',
 *        'swing-detected', 'library-bridge', 'phase-k-invoke').
 *
 * Stage names live in docs/cage-telemetry-map.md as the reference catalog.
 */

export type CageStageStatus = 'ok' | 'fail' | 'partial';

export function cageLog(
  stage: string,
  status: CageStageStatus = 'ok',
  metadata: Record<string, unknown> = {},
): void {
  const ts = new Date().toISOString();
  let metaStr: string;
  try {
    metaStr = JSON.stringify(metadata);
  } catch {
    metaStr = '{"_meta_error":"unserializable"}';
  }
  console.log(`[path3:cage:${stage}] timestamp=${ts} status=${status} metadata=${metaStr}`);
}
