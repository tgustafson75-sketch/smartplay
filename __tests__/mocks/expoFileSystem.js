/**
 * 2026-08-10 — expo-file-system stub for the LOGIC test project. Last of the native-module walls
 * keeping services/swing/clubPath (and its zoom-crop maths) out of reach of any test.
 */
module.exports = {
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  deleteAsync: async () => undefined,
  copyAsync: async () => undefined,
  downloadAsync: async () => ({ status: 200 }),
  readAsStringAsync: async () => '',
  getInfoAsync: async () => ({ exists: false }),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
};
