// jest-expo component test setup.
//
// 2026-09-14 — this project had NEVER run a test. `transformIgnorePatterns` did not cover
// `expo-modules-core` (the `expo(nent)?` alternative matches "expo" exactly, not "expo-*"), so the
// first render attempt died in the preset before reaching any component. Widened in jest.config.js,
// and the store layer needs AsyncStorage stubbed because every zustand store persists through it.
import '@testing-library/react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
