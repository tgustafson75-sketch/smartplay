import { Platform } from 'react-native';

const systemFont = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const dataValue = {
  fontFamily: systemFont,
  fontWeight: '600' as const,
  letterSpacing: -0.5,
  color: '#ffffff',
};

export const dataLabel = {
  fontFamily: systemFont,
  fontWeight: '500' as const,
  letterSpacing: 1,
  fontSize: 10,
  textTransform: 'uppercase' as const,
  color: '#6b7d72',
};

export const kevinText = {
  fontFamily: systemFont,
  fontWeight: '500' as const,
  fontSize: 17,
  lineHeight: 24,
  letterSpacing: 0,
  color: '#ffffff',
};
