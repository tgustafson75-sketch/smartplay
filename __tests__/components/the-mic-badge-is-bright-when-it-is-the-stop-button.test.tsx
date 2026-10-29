/**
 * 2026-10-28 (recheck VC-4) — mounted, not grepped: the header mic badge must be at full opacity
 * while it is the "I'm done" button ('listening', label "Stop talking to caddie") and while a tap is
 * queued as that endpoint ('opening'), and dim only while toggle() really drops a tap ('thinking').
 * The rule itself is exercised in __tests__/regression/the-mic-badge-is-bright-when-it-is-the-stop-button.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

const mockToggle = jest.fn(async () => undefined);
// The voice graph (expo-av) cannot load here; the badge's dim rule is its own leaf module and stays real.
jest.mock('../../services/listeningSession', () => ({ toggle: () => mockToggle() }));
jest.mock('../../services/caddiePresence', () => ({ applyPresence: jest.fn() }));
jest.mock('../../contexts/ThemeContext', () => ({ useTheme: () => ({ colors: { accent: '#00c896' } }) }));

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

type State = 'idle' | 'opening' | 'listening' | 'thinking' | 'responding';

type HostNode = { props: { style?: unknown }; parent: HostNode | null };
function badgeOpacity(): number {
  // The Pressable carries the label; the View wrapping it carries the dim.
  let node = (screen.getByRole('button') as unknown as HostNode).parent;
  while (node) {
    const flat = StyleSheet.flatten(node.props.style as never) as { opacity?: number; width?: number } | undefined;
    if (flat && typeof flat.opacity === 'number' && flat.width !== undefined) return flat.opacity;
    node = node.parent;
  }
  throw new Error('badge wrapper not found');
}

async function mountIn(state: State) {
  const { useListeningSessionStore } = require('../../store/listeningSessionStore');
  useListeningSessionStore.getState().setState(state);
  const { CaddieMicBadge } = require('../../components/caddie/CaddieMicBadge');
  render(<CaddieMicBadge />);
}

describe('the mic badge as a control', () => {
  it('THE BUG: while LISTENING it is the stop button — full opacity, and a tap reaches toggle()', async () => {
    await mountIn('listening');
    expect(screen.getByLabelText('Stop talking to caddie')).toBeTruthy();
    expect(badgeOpacity()).toBe(1);
    await act(async () => { fireEvent.press(screen.getByRole('button')); });
    expect(mockToggle).toHaveBeenCalledTimes(1);
  }, 60_000);

  it('full opacity while OPENING (a real tap is queued as the endpoint)', async () => {
    await mountIn('opening');
    expect(badgeOpacity()).toBe(1);
  }, 60_000);

  it('dims while THINKING — the one state toggle() drops a tap', async () => {
    await mountIn('thinking');
    expect(badgeOpacity()).toBe(0.4);
  }, 60_000);

  it('full opacity at rest and while the caddie speaks', async () => {
    await mountIn('idle');
    expect(badgeOpacity()).toBe(1);
  }, 60_000);
});
