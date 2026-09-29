/**
 * 2026-09-29 — THE SMARTMOTION HUD PIECES, RENDERED, ON A PHONE WITH LARGE TEXT.
 *
 * The narrow-phone pass capped the font scale of text that lives in a FIXED-SIZE box (the header that
 * shares its bar with four controls, the footer chips that are a third of the deck each, the acoustic
 * card title) and let long lines shrink or wrap instead of bleeding out. The screen itself cannot be
 * mounted in a test, but these components can: this renders them and reads the props React Native
 * will lay out with, so a revert of any one of them goes red here.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';
import {
  AcousticPickupCard, FooterChips, SmartMotionHeader, VerdictBadge,
} from '../../components/smartmotion/SmartMotionHud';
import { HUD_MAX_FONT_SCALE } from '../../services/swing/smartMotionLayout';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

type TextProps = React.ComponentProps<typeof Text>;
const propsOf = (text: string | RegExp): TextProps => screen.getByText(text).props as TextProps;
const styleOf = (text: string | RegExp) => StyleSheet.flatten(propsOf(text).style) ?? {};

describe('the header fits the review bar on a 344dp phone', () => {
  it('both lines shrink to fit and stop growing at the HUD cap', () => {
    render(<SmartMotionHeader mode="down_the_line" />);
    for (const line of [/SMARTMOTION/i, 'FULL SWING ANALYSIS']) {
      const p = propsOf(line);
      expect(p.numberOfLines).toBe(1);
      expect(p.adjustsFontSizeToFit).toBe(true);
      expect(p.maxFontSizeMultiplier).toBe(HUD_MAX_FONT_SCALE);
    }
  });
});

describe('the footer chips are a third of the deck each', () => {
  it('every label and value is capped at the HUD font scale', () => {
    render(<FooterChips club="7i" shot={2} distanceYds={null} onClubPress={() => undefined} />);
    for (const s of ['7i', '2']) expect(propsOf(s).maxFontSizeMultiplier).toBe(HUD_MAX_FONT_SCALE);
    const labels = screen.UNSAFE_getAllByType(Text).filter((n) => n.props.numberOfLines === 1);
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const n of labels) expect(n.props.maxFontSizeMultiplier).toBe(HUD_MAX_FONT_SCALE);
  });
});

describe('long lines give way instead of bleeding out of their card', () => {
  it('the acoustic title shrinks inside its row and is capped', () => {
    render(<AcousticPickupCard detected={false} calibrated listening={false} levelDb={null} />);
    const title = screen.UNSAFE_getAllByType(Text).find((n) => n.props.numberOfLines === 1);
    expect(title).toBeDefined();
    expect(StyleSheet.flatten(title!.props.style).flexShrink).toBe(1);
    expect(title!.props.maxFontSizeMultiplier).toBe(HUD_MAX_FONT_SCALE);
  });

  it('a long verdict wraps, centred, rather than running off the badge', () => {
    render(<VerdictBadge verdict="Solid strike — launch toward the target" tone="good" />);
    const s = styleOf('Solid strike — launch toward the target');
    expect(s.flexShrink).toBe(1);
    expect(s.textAlign).toBe('center');
  });
});
