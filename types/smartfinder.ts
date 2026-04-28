export interface RangefinderLock {
  id: string;
  locked_at: number;
  user_position: { lat: number; lng: number; accuracy: number };
  target_position: { lat: number; lng: number; estimated: true };
  distance_yards: number;
  distance_meters: number;
  compass_heading: number;
  tap_y_normalized: number;
}
