// Layout hook — Day 4 (refreshed for Z Fold reconfigure).
//
// useWindowDimensions subscribes to RN's dim-change events so foldable
// open/close re-renders with the new viewport. Plain Dimensions.get
// snapshots once and goes stale on the first reconfigure.

import { useWindowDimensions } from 'react-native';

export const useLayout = () => {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    avatarHeight: height * 0.62,
    controlsHeight: height * 0.38,
  };
};
