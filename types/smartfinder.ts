export interface RangefinderLock {
  id: string;
  locked_at: number;
  user_position: { lat: number; lng: number; accuracy: number };
  target_position: { lat: number; lng: number; estimated: true };
  distance_yards: number;
  distance_meters: number;
  compass_heading: number;
  tap_y_normalized: number;
  /**
   * 2026-10-27 (Brain review F3) — the hole the lock was taken on. A lock is a number for ONE shot;
   * the payload builder sends it only while the player is still on this hole.
   */
  hole?: number | null;
}
