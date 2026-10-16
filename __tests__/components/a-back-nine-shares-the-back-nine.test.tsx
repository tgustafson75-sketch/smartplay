/**
 * 2026-10-15 (review) — sharing a BACK-nine round's scorecard printed holes 1-9: a row of dashes and
 * an OUT total of "—", with the nine he actually played missing. The share now draws the nine played.
 */
import React from 'react';
import { Share } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/scorecard',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async () => undefined),
  configureAudioForSpeech: jest.fn(async () => undefined),
}));
jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false },
  });
});

type Node = { props: Record<string, unknown>; parent: Node | null };

it('a completed back-nine round shares holes 10-18', async () => {
  const { useRoundStore } = require('../../store/roundStore');
  const scores: Record<number, number> = {};
  const holePars: Record<number, number> = {};
  for (let h = 10; h <= 18; h++) { scores[h] = 5; holePars[h] = 4; }
  useRoundStore.setState({
    isRoundActive: false,
    roundHistory: [{
      id: 'back9', roundNumber: 1, courseName: 'Back Nine GC', courseId: null, startedAt: 1, endedAt: 2,
      holesPlayed: 9, totalScore: 45, scoreVsPar: 9, isCompetition: false, nineHoleMode: true, mode: 'free_play',
      scores, putts: {}, shots: [], holePars,
    }],
  } as never);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  const Scorecard = require('../../app/(tabs)/scorecard').default;
  render(<SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}><Scorecard /></SafeAreaProvider>);
  let n = screen.UNSAFE_getAllByProps({ name: 'share-social-outline' })[0] as unknown as Node | null;
  while (n && typeof n.props.onPress !== 'function') n = n.parent;
  await act(async () => { await (n!.props.onPress as () => Promise<void>)(); });
  const message = (share.mock.calls[0][0] as { message: string }).message;
  expect(message).toMatch(/HOLE\s+10\s+11/);
  expect(message).toMatch(/\bIN\b/);
  expect(message).not.toMatch(/HOLE\s+1\s+2\s+3/);
});
