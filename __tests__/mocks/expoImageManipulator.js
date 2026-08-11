/**
 * 2026-08-10 — expo-image-manipulator stub for the LOGIC test project.
 *
 * Same shape of problem as the image-asset mapper: a native Expo module can't load under plain
 * node, so every module importing it was unreachable from the logic suite — including
 * services/courseImport, where the scorecard merge lives. Stubbing the module is what lets the
 * PURE parts of those files (merge rules, validation) be tested without a device.
 *
 * Only the surface courseImport touches is stubbed; anything calling manipulateAsync in a test
 * should assert on its own logic, not on image processing.
 */
module.exports = {
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  manipulateAsync: async () => ({ uri: 'file:///stub.jpg', width: 2000, height: 1500, base64: '' }),
};
