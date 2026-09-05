// SmartPlay Caddie test runner.
// Two projects so pure-logic tests (stores, api helpers, utils) run fast in plain
// node, while component tests get the full jest-expo React Native transform.
module.exports = {
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
      // 2026-09-05 — the logic project had NO setup file, so Node's real fetch was live and
      // tests posted to production (thirteen fake ROUND TRACE emails + paid inference calls).
      // See __tests__/setupNoNetwork.ts.
      setupFilesAfterEnv: ['<rootDir>/__tests__/setupNoNetwork.ts'],
      testMatch: [
        '<rootDir>/__tests__/logic/**/*.test.ts',
        '<rootDir>/__tests__/regression/**/*.test.ts',
      ],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false, esModuleInterop: true } }],
      },
      moduleNameMapper: {
        '^@react-native-async-storage/async-storage$':
          '<rootDir>/__tests__/mocks/asyncStorage.ts',
        // 2026-08-10 — bundled image assets resolve to numeric ids under React Native; plain node
        // tried to PARSE the JPEG/PNG bytes, so any module transitively importing course imagery
        // ("Invalid or unexpected token") was unreachable from the logic suite. See the mock's
        // header: that shadow is where two of today's shipped bugs were hiding.
        '\\.(jpg|jpeg|png|gif|webp|svg|mp3|mp4|wav|m4a)$':
          '<rootDir>/__tests__/mocks/imageAsset.js',
        // 2026-08-10 — native Expo module; unloadable under plain node, so it walled off
        // services/courseImport (where the scorecard merge lives) from the logic suite.
        '^expo-image-manipulator$': '<rootDir>/__tests__/mocks/expoImageManipulator.js',
        '^expo-image-picker$': '<rootDir>/__tests__/mocks/expoImagePicker.js',
        '^expo-video-thumbnails$': '<rootDir>/__tests__/mocks/expoVideoThumbnails.js',
        '^expo-file-system(/legacy)?$': '<rootDir>/__tests__/mocks/expoFileSystem.js',
        '^@sentry/react-native$': '<rootDir>/__tests__/mocks/sentry.js',
        '^react-native$': '<rootDir>/__tests__/mocks/reactNative.js',
        // Scoped, not catch-all: a blanket '^expo-.*' mapper stubbed modules that existing tests
        // relied on for real behavior and hung quick-round-disambiguation. Only the modules pure
        // services actually pull in transitively are stubbed.
        '^expo-location$': '<rootDir>/__tests__/mocks/expoGeneric.js',
        // 2026-08-19 — expo-router ships JSX and cannot load under the plain ts-jest transform, so
        // every module importing `router` at top level was untestable — including
        // services/voice/conversationalToolDispatch, the single switch every voice tool runs through
        // on every mic path. That is how recommend_club could be dropped at three seams unnoticed.
        '^expo-router$': '<rootDir>/__tests__/mocks/expoRouter.js',
      },
    },
    {
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/components/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setupNoNetwork.ts', '<rootDir>/__tests__/setup.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|zustand)/)',
      ],
    },
  ],
};
