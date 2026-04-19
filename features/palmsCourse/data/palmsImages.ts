/**
 * features/palmsCourse/data/palmsImages.ts
 *
 * Centralises all image assets for the Palms course.
 * Consumers import from here rather than calling require() inline.
 */

import type { ImageSourcePropType } from 'react-native';

// ─── Hole play-view images ────────────────────────────────────────────────────

export const PALMS_HOLE_IMAGES: Record<number, ImageSourcePropType> = {
   1: require('../../../assets/palms/hole1.jpg'),
   2: require('../../../assets/palms/hole2.jpg'),
   3: require('../../../assets/palms/hole3.jpg'),
   4: require('../../../assets/palms/hole4.jpg'),
   5: require('../../../assets/palms/hole5.jpg'),
   6: require('../../../assets/palms/hole6.jpg'),
   7: require('../../../assets/palms/hole7.jpg'),
   8: require('../../../assets/palms/hole8.jpg'),
   9: require('../../../assets/palms/hole9.jpg'),
  10: require('../../../assets/palms/hole10.jpg'),
  11: require('../../../assets/palms/hole11.jpg'),
  12: require('../../../assets/palms/hole12.jpg'),
  13: require('../../../assets/palms/hole13.jpg'),
  14: require('../../../assets/palms/hole14.jpg'),
  15: require('../../../assets/palms/hole15.jpg'),
  16: require('../../../assets/palms/hole16.jpg'),
  17: require('../../../assets/palms/hole17.jpg'),
  18: require('../../../assets/palms/hole18.jpg'),
};

export const palmsImages = PALMS_HOLE_IMAGES;

export const PALMS_HOLE_THUMBNAILS: Record<number, ImageSourcePropType> =
  PALMS_HOLE_IMAGES;

/**
 * Returns the full play-view image for a given hole.
 */
export function getPalmsHoleImage(holeNumber: number): ImageSourcePropType {
  return PALMS_HOLE_IMAGES[holeNumber] ?? PALMS_HOLE_IMAGES[1];
}

/**
 * Returns the thumbnail for a given hole.
 */
export function getPalmsHoleThumbnail(holeNumber: number): ImageSourcePropType {
  return PALMS_HOLE_THUMBNAILS[holeNumber] ?? PALMS_HOLE_IMAGES[1];
}
