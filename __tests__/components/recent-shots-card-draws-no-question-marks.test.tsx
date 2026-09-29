/**
 * 2026-09-29 (Tim — "check recent shots card on Dashboard tab. It's full of ? and I don't think it's
 * wired correctly.")
 *
 * Mounts the card's renderer (components/caddie/ShotTimeline — the Dashboard passes it its pool) over
 * rows shaped exactly as their writers build them, and asserts on what a player SEES: no "?" glyph
 * (Ionicons 'help-outline'), no "—" standing in for a club or a distance, the facts a club-less row
 * does carry, a readable club, and a count that counts the rows drawn.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../../i18n/locales/en.json';
import type { ShotResult } from '../../store/roundStore';
import ShotTimeline from '../../components/caddie/ShotTimeline';

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en', fallbackLng: 'en', resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

const T = 1_780_000_000_000;
const base = { feel: null, direction: null, shape: null, club: null, acousticContact: null } as const;
// app/(tabs)/scorecard.tsx handleQuickScore — one blank row per stroke.
const qs = (hole: number, i: number): ShotResult => ({ ...base, id: `qs-${hole}-${i}`, hole, timestamp: T, outcome: 'clean', penalty_strokes: 0 });
// store/roundStore.ts addPenalty.
const penalty: ShotResult = { ...base, id: 'p1', hole: 1, timestamp: T, outcome: 'manual_penalty', penalty_strokes: 1 };
// components/caddie/CockpitCaddieScreen.tsx quick taps.
const tapLeft: ShotResult = { ...base, id: 'c1', hole: 2, timestamp: T + 1, direction: 'left' };
const tapShort: ShotResult = { ...base, id: 'c2', hole: 2, timestamp: T + 2, outcome_text: 'short of target' };
// services/intents/logShotHandler.ts / brain log_shot.
const voice7i: ShotResult = { ...base, id: 'v1', hole: 3, timestamp: T + 3, club: '7I', distance_yards: 152, outcome: 'clean' };
const brainDriver: ShotResult = { ...base, id: 'b1', hole: 4, timestamp: T + 4, club: 'DR', direction: 'right' };

const iconNames = () => screen.UNSAFE_getAllByType(Ionicons).map(n => n.props.name as string);
const allText = (r: ReturnType<typeof render>) => JSON.stringify(r.toJSON());

describe('the Recent Shots card', () => {
  it('a quick-scored round draws nothing — not five rows of "?"', () => {
    const r = render(<ShotTimeline maxRows={5} shots={[qs(1, 0), qs(1, 1), qs(1, 2), qs(1, 3), penalty]} />);
    expect(r.toJSON()).toBeNull();
  });

  it('never draws a "?" glyph or a dash for a missing club or distance', () => {
    const r = render(<ShotTimeline maxRows={5} shots={[qs(1, 0), qs(1, 1), tapLeft, tapShort, voice7i, brainDriver]} />);
    expect(iconNames()).not.toContain('help-outline');
    expect(allText(r)).not.toMatch(/"—"|"\?"/);
  });

  it('draws the facts a club-less row carries, and says in words what is missing', () => {
    render(<ShotTimeline maxRows={5} shots={[tapLeft, tapShort]} />);
    expect(screen.getAllByText('Club not logged')).toHaveLength(2);
    expect(screen.getByText('left')).toBeTruthy();
    expect(screen.getByText('short of target')).toBeTruthy();
  });

  it('reads the club the way a golfer does, whichever vocabulary it was logged in', () => {
    render(<ShotTimeline maxRows={5} shots={[voice7i, brainDriver]} />);
    expect(screen.getByText('7-iron')).toBeTruthy();
    expect(screen.getByText(/^driver$/i)).toBeTruthy();
    expect(screen.getByText('152')).toBeTruthy();
  });

  it('a putt still reads in feet', () => {
    const putt: ShotResult = { ...base, id: 'pt', hole: 4, timestamp: T + 5, club: 'Putter', distance_yards: 8 };
    render(<ShotTimeline maxRows={5} shots={[putt]} />);
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('ft')).toBeTruthy();
  });

  it('the count counts the rows it can draw, and the label says which round', () => {
    render(<ShotTimeline maxRows={2} shots={[qs(1, 0), qs(1, 1), tapLeft, voice7i, brainDriver]} label="LAST ROUND · SEP 20" />);
    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('LAST ROUND · SEP 20')).toBeTruthy();
  });
});
