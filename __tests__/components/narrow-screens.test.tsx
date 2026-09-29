/**
 * 2026-09-29 — narrow screens: a Galaxy Z Fold CLOSED (~344dp) and iPhones (375/390/430dp).
 *
 * The owner tests on the OPEN Fold, where every row fits; these are the load-bearing fixes from the
 * narrow audit, each mounted at 344dp wide under the iOS preset (jest-expo renders as iOS):
 *
 *  1. Paywall — the Subscribe CTA was the LAST child of the ScrollView, below the fold on a small
 *     phone. It must sit OUTSIDE the scroll, in a footer, with the ScrollView flexed so it cannot
 *     push that footer off-screen.
 *  2. Scorecard — the putts (label + 5 chips) and penalties (label + 4 chips) rows are plain rows,
 *     not the horizontal score-chip scroll; at 344dp they ran off the card. They must wrap.
 *  3. iOS monospace — 'monospace' is an Android family; iOS silently fell back to the proportional
 *     system font. Readouts must resolve to Menlo on iOS, and no raw 'monospace' literal may remain.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { StyleSheet, Platform, ScrollView, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';

const NARROW = { width: 344, height: 882, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => NARROW,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/scorecard',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => undefined,
}));

jest.mock('../../services/billing/purchases', () => ({
  getPackages: jest.fn(async () => []),
  selectPackageForPlan: jest.fn(() => null),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn(),
  getTrialOffers: jest.fn(async () => ({ monthly: null, annual: null })),
}));
jest.mock('../../services/voiceService', () => ({
  speak: jest.fn(async () => undefined),
  configureAudioForSpeech: jest.fn(async () => undefined),
}));
jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

const METRICS = {
  frame: { x: 0, y: 0, width: NARROW.width, height: NARROW.height },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderNarrow = (el: React.ReactElement) =>
  render(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);

type AnyStyle = TextStyle & ViewStyle;
const flat = (style: unknown): AnyStyle | undefined =>
  StyleSheet.flatten(style as StyleProp<AnyStyle>) as AnyStyle | undefined;

type HostNode = { parent: HostNode | null; type: unknown; props: { style?: unknown } };

/** The nearest host View above a node — the row a label and its chips actually lay out in. */
function hostViewAbove(node: HostNode): HostNode {
  let n = node.parent;
  while (n && n.type !== 'View') n = n.parent;
  if (!n) throw new Error('no host View above node');
  return n;
}

/** Walk up from a host node; true when any ancestor is a ScrollView host. */
function insideScrollView(node: { parent: unknown; type: unknown } | null): boolean {
  let n = node?.parent as { parent: unknown; type: unknown } | null;
  while (n) {
    if (n.type === 'RCTScrollView') return true;
    n = n.parent as { parent: unknown; type: unknown } | null;
  }
  return false;
}

describe('narrow screens (344dp)', () => {
  it('premise: the screens under test see a 344dp window', () => {
    const { useWindowDimensions } = require('react-native');
    expect(useWindowDimensions().width).toBe(344);
    expect(Platform.OS).toBe('ios');
  });

  describe('paywall — the purchase button is reachable without scrolling', () => {
    beforeEach(() => {
      const { usePlayerProfileStore } = require('../../store/playerProfileStore');
      usePlayerProfileStore.setState({ subscription_status: 'free' });
      // No spoken price line: its timers would outlive the test.
      const { useSettingsStore } = require('../../store/settingsStore');
      useSettingsStore.setState({ voiceEnabled: false });
    });
    // The store's trial-offer lookup resolves after mount; let it land inside act.
    const settle = () => act(async () => { await Promise.resolve(); });

    it('Subscribe, Restore and the legal links sit outside the ScrollView', async () => {
      const PaywallScreen = require('../../app/paywall').default;
      renderNarrow(<PaywallScreen />);
      await settle();

      const cta = screen.getByText('Subscribe');
      expect(insideScrollView(cta as never)).toBe(false);
      expect(insideScrollView(screen.getByText(en.paywall.paywall_screen.restore_purchase) as never)).toBe(false);
      expect(insideScrollView(screen.getByText(en.paywall.paywall_screen.terms_of_service) as never)).toBe(false);
      // The plan picker still scrolls — only the controls that complete the purchase are pinned.
      expect(insideScrollView(screen.getByText(en.paywall.paywall_screen.smartplay_caddie_pro) as never)).toBe(true);
    });

    it('the ScrollView is flexed, so a tall scroll cannot push the footer off-screen', async () => {
      const PaywallScreen = require('../../app/paywall').default;
      const { UNSAFE_getByType } = renderNarrow(<PaywallScreen />);
      await settle();
      const sv = UNSAFE_getByType(ScrollView);
      expect(flat(sv.props.style)?.flex).toBe(1);
    });
  });

  describe('scorecard — putts and penalties controls wrap instead of running off the card', () => {
    beforeEach(() => {
      const { useRoundStore } = require('../../store/roundStore');
      // Empty courseHoles: the scorecard synthesizes scoreable rows for the round's hole range.
      useRoundStore.setState({
        isRoundActive: true,
        currentHole: 1,
        scores: {},
        putts: {},
        courseHoles: [],
      } as never);
    });

    it('the row holding each label and its chips has flexWrap: wrap', () => {
      const Scorecard = require('../../app/(tabs)/scorecard').default;
      renderNarrow(<Scorecard />);
      // Hole 1 is current and unscored, so its inline chip panel auto-opens.
      for (const label of [en.scorecard.putts_label, en.scorecard.penalties_label]) {
        const row = hostViewAbove(screen.getByText(label) as unknown as HostNode);
        expect(flat(row.props.style)?.flexDirection).toBe('row');
        expect(flat(row.props.style)?.flexWrap).toBe('wrap');
      }
      // Tapping a putt chip still works from the wrapped row.
      fireEvent.press(screen.getByLabelText('2 putts on hole 1'));
    });
  });

  describe('iOS monospace', () => {
    it('the hole badge distance readout renders in Menlo on iOS', () => {
      const { HoleBrandBadge } = require('../../components/caddie/HoleBrandBadge');
      render(<HoleBrandBadge hole={7} distanceYds={152} distanceCaption="MID" />);
      const readouts = screen.UNSAFE_root.findAll(
        (n: { type: unknown; props: { style?: unknown } }) =>
          n.type === 'Text' && flat(n.props.style)?.fontFamily != null,
      );
      expect(readouts.length).toBeGreaterThan(0);
      for (const r of readouts) {
        expect(flat(r.props.style)?.fontFamily).toBe('Menlo');
      }
    });

    it('no source file sets fontFamily to a raw platform family — every one goes through MONO_FONT', () => {
      const root = path.join(__dirname, '..', '..');
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.tsx?$/.test(e.name)) {
            // Strip comments so prose explaining the bug cannot trip (or satisfy) the guard.
            const src = fs.readFileSync(p, 'utf8')
              .replace(/\/\*[\s\S]*?\*\//g, '')
              .replace(/(^|[^:])\/\/.*$/gm, '$1');
            if (/fontFamily\s*:[^,}\n]*['"](monospace|Menlo|Courier[^'"]*)['"]/.test(src)) {
              offenders.push(path.relative(root, p));
            }
          }
        }
      };
      for (const d of ['app', 'components']) walk(path.join(root, d));
      expect(offenders).toEqual([]);
    });
  });
});
