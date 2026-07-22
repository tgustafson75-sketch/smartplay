// SmartPlay Caddie test runner.
// Two projects so pure-logic tests (stores, api helpers, utils) run fast in plain
// node, while component tests get the full jest-expo React Native transform.
module.exports = {
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
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
      },
    },
    {
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/components/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
      transformIgnorePatterns: [
        'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|zustand)/)',
      ],
    },
  ],
};
