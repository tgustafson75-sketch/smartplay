/**
 * 2026-08-10 — expo-image-picker stub for the LOGIC test project. Same reason as the
 * image-manipulator stub: a native module that plain node can't load, walling off the pure logic
 * that lives alongside it.
 */
module.exports = {
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
};
