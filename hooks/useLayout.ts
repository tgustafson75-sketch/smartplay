// Layout hook — built in Day 4

import { Dimensions } from 'react-native';

export const useLayout = () => {
  const { width, height } = Dimensions.get('window');
  return {
    width,
    height,
    avatarHeight: height * 0.62,
    controlsHeight: height * 0.38,
  };
};
