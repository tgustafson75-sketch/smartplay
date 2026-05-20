/**
 * Phase 417 — Multi-modal sensing source registry.
 *
 * Glasses, watch, phone camera, phone mic, GPS, Health Connect motion —
 * every sensing modality registers here with its capabilities and
 * availability. Consumers (caddie intelligence, shot detection, audio
 * routing) ask the registry which sources are present and capable; the
 * specific implementation behind each source can swap (Ray-Ban Meta
 * glasses today, future Apple AR glasses tomorrow) without consumers
 * changing.
 *
 * This is the seam Phase 417 (Meta glasses), Phase 413 (Health Connect
 * motion), and future Phase 418 (watch IMU) all plug into. Adding a
 * new modality is a single `register()` call.
 */

export type ModalityKind =
  | 'phone_camera'
  | 'phone_mic'
  | 'phone_speaker'
  | 'gps'
  | 'health_motion'
  | 'glasses_camera'
  | 'glasses_mic'
  | 'glasses_speaker'
  | 'watch_imu'
  | 'launch_monitor';

export interface SensingSource {
  id: string;
  kind: ModalityKind;
  display_name: string;
  /** True when the device + permission + connection are all present. */
  available: boolean;
  /** Per-modality capability flags (e.g. fps, resolution, sample_rate). */
  capabilities?: Record<string, unknown>;
  /** Last status update timestamp. */
  updated_at: number;
}

const sources = new Map<string, SensingSource>();
const listeners = new Set<(snapshot: SensingSource[]) => void>();

function emit(): void {
  const snap = Array.from(sources.values());
  listeners.forEach(l => { try { l(snap); } catch { /* ignore */ } });
}

export function registerSource(source: Omit<SensingSource, 'updated_at'>): void {
  sources.set(source.id, { ...source, updated_at: Date.now() });
  emit();
}

export function updateSource(id: string, patch: Partial<Omit<SensingSource, 'id' | 'updated_at'>>): void {
  const cur = sources.get(id);
  if (!cur) return;
  sources.set(id, { ...cur, ...patch, updated_at: Date.now() });
  emit();
}

export function unregisterSource(id: string): void {
  if (sources.delete(id)) emit();
}

export function getSources(): SensingSource[] {
  return Array.from(sources.values());
}

export function getSourcesByKind(kind: ModalityKind): SensingSource[] {
  return Array.from(sources.values()).filter(s => s.kind === kind);
}

export function getAvailableByKind(kind: ModalityKind): SensingSource[] {
  return Array.from(sources.values()).filter(s => s.kind === kind && s.available);
}

export function subscribeSources(cb: (snapshot: SensingSource[]) => void): () => void {
  listeners.add(cb);
  cb(Array.from(sources.values()));
  return () => { listeners.delete(cb); };
}

/**
 * Audio routing helper — returns the best speaker source available.
 * Priority: glasses_speaker > phone_speaker. Used by voiceService when
 * deciding where to play TTS output.
 */
export function preferredSpeaker(): SensingSource | null {
  const glasses = getAvailableByKind('glasses_speaker')[0];
  if (glasses) return glasses;
  const phone = getAvailableByKind('phone_speaker')[0];
  return phone ?? null;
}

/**
 * Mic input source preference — glasses 5-mic array beats phone mic
 * for outdoor capture (wind, distance to mouth).
 */
export function preferredMic(): SensingSource | null {
  const glasses = getAvailableByKind('glasses_mic')[0];
  if (glasses) return glasses;
  return getAvailableByKind('phone_mic')[0] ?? null;
}

/**
 * Camera priority for swing/POV capture. Caller can request 'pov'
 * (player's view → glasses) or 'tripod' (face-on/down-the-line →
 * phone). When neither is available returns null.
 */
export function preferredCamera(angle: 'pov' | 'tripod'): SensingSource | null {
  if (angle === 'pov') {
    const glasses = getAvailableByKind('glasses_camera')[0];
    if (glasses) return glasses;
    // Fall back to phone if POV-only isn't possible.
    return getAvailableByKind('phone_camera')[0] ?? null;
  }
  return getAvailableByKind('phone_camera')[0] ?? null;
}
