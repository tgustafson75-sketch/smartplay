/**
 * 2026-08-10 — expo-video-thumbnails stub for the LOGIC test project. Same wall as the other native
 * Expo modules: unloadable under plain node, which walled off services/swing/clubPath — where the
 * zoom-crop maths lives — from any test.
 */
module.exports = { getThumbnailAsync: async () => ({ uri: 'file:///stub.jpg', width: 1920, height: 1080 }) };
