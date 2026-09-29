/**
 * 2026-09-29 (Tim — "I still use GolfNow only for tee times").
 *
 * Two screen halves, mounted rather than grepped:
 *   - the pro-shop number the course book has held since June is SHOWN beside the tee-time buttons,
 *     dials when tapped, carries the call script — and renders nothing when there is no number;
 *   - the rate category is a real control in Profile, and its copy says the course verifies it.
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/profile',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

const { useCaddieMemoryStore } = require('../../store/caddieMemoryStore');
const { usePlayerProfileStore } = require('../../store/playerProfileStore');

beforeEach(() => {
  useCaddieMemoryStore.setState({ courseBook: {} });
  usePlayerProfileStore.setState({ rateCategory: 'none' });
});

describe('Call pro shop', () => {
  it('shows the number, dials it, and says what to ask for', async () => {
    const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    useCaddieMemoryStore.getState().saveCourseBook({ course_id: '18123', name: 'Menifee Lakes', phone: '(951) 672-3090', nowMs: 1 });
    usePlayerProfileStore.setState({ rateCategory: 'veteran_military' });
    const { ProShopCallRow } = require('../../components/course/ProShopCallRow');
    render(<ProShopCallRow courseId="18123" request={{ transport: 'walking' }} />);
    expect(screen.getByText('Call pro shop')).toBeTruthy();
    expect(screen.getByText('(951) 672-3090')).toBeTruthy();
    expect(screen.getByText('Ask for: walking, veteran/military rate')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Call pro shop')); });
    expect(spy).toHaveBeenCalledWith('tel:9516723090');
    spy.mockRestore();
  });

  it('appears the moment the Places lookup lands, and not before', () => {
    const { ProShopCallRow } = require('../../components/course/ProShopCallRow');
    render(<ProShopCallRow courseId="999" />);
    expect(screen.queryByText('Call pro shop')).toBeNull();
    act(() => { useCaddieMemoryStore.getState().saveCourseBook({ course_id: '999', name: 'X', phone: '760-555-0100', nowMs: 1 }); });
    expect(screen.getByText('Call pro shop')).toBeTruthy();
  });
});

describe('the rate category in Profile', () => {
  it('is a control, it writes the profile, and its copy says the course checks it', () => {
    const { ProfileForm } = require('../../components/profile/ProfileForm');
    render(<ProfileForm />);
    expect(screen.getByText(/course checks eligibility/i)).toBeTruthy();
    fireEvent.press(screen.getByText('Veteran / military'));
    expect(usePlayerProfileStore.getState().rateCategory).toBe('veteran_military');
    fireEvent.press(screen.getByText('Standard'));
    expect(usePlayerProfileStore.getState().rateCategory).toBe('none');
  });
});
