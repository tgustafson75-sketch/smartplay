// Local Expo module: on-device Google ML Kit pose detection.
//
// The native module registers under the name "MlkitPose" and is consumed
// via requireOptionalNativeModule('MlkitPose') in
// services/pose/onDevicePose.ts — NOT imported from here. This entry file
// exists only to satisfy the Expo local-module convention (package.json
// `main`). Keeping consumption in onDevicePose.ts means the rest of the app
// has exactly one pose-backend seam.
export {};
