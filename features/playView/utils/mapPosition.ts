/**
 * features/playView/utils/mapPosition.ts
 *
 * Simplified v1 GPS → image pixel mapping.
 *
 * Projects the player's remaining distance along the hole onto a vertical
 * axis of the play-view image.
 *
 * Returns pixel coordinates suitable for absolute positioning on the image:
 *   y = 0    → tee  (player at full hole distance)
 *   y = 350  → green (player at 0 yds)
 *   x = 200  → horizontal centre (refined later with real pixel anchors)
 */

export interface ImagePosition {
  x: number;
  y: number;
}

/**
 * @param distance   Remaining yards to the green center.
 * @param totalYards GPS-verified hole yardage from the tee.
 */
export function mapToImage(distance: number, totalYards: number): ImagePosition {
  // Clamp ratio to [0, 1] — handles GPS fixes slightly outside the hole corridor.
  const ratio = Math.min(1, Math.max(0, 1 - distance / totalYards));

  return {
    x: 200,               // horizontal centre; refine with pixel anchors per hole
    y: 400 - ratio * 350, // tee ≈ y=400, green ≈ y=50
  };
}
