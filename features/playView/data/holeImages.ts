/**
 * features/playView/data/holeImages.ts
 *
 * Hole photograph asset map for all 18 holes.
 * Place images at assets/holes/hole{n}.jpg before bundling.
 *
 * Until real images are available the require() calls will resolve to
 * a bundler placeholder — the app will not crash.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const holeImages: Record<number, any> = {
   1: require('../../../assets/holes/hole1.jpg'),
   2: require('../../../assets/holes/hole2.jpg'),
   3: require('../../../assets/holes/hole3.jpg'),
   4: require('../../../assets/holes/hole4.jpg'),
   5: require('../../../assets/holes/hole5.jpg'),
   6: require('../../../assets/holes/hole6.jpg'),
   7: require('../../../assets/holes/hole7.jpg'),
   8: require('../../../assets/holes/hole8.jpg'),
   9: require('../../../assets/holes/hole9.jpg'),
  10: require('../../../assets/holes/hole10.jpg'),
  11: require('../../../assets/holes/hole11.jpg'),
  12: require('../../../assets/holes/hole12.jpg'),
  13: require('../../../assets/holes/hole13.jpg'),
  14: require('../../../assets/holes/hole14.jpg'),
  15: require('../../../assets/holes/hole15.jpg'),
  16: require('../../../assets/holes/hole16.jpg'),
  17: require('../../../assets/holes/hole17.jpg'),
  18: require('../../../assets/holes/hole18.jpg'),
};
