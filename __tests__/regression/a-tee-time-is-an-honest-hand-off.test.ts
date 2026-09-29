/**
 * 2026-09-29 (Tim — "I still use GolfNow only for tee times"; "we don't have to verify Vet status,
 * pro shop will check the accuracy of the pricing category").
 *
 * There is no consumer tee-time booking API, so the job is an HONEST hand-off that GolfNow does not
 * do: the course's own booking page, the pro shop's number (fetched and saved since June and never
 * shown), and a one-line script of what to ask for — the player's rate category included.
 *
 * BEHAVIOURAL: the stores, the tool dispatcher and services/teeTimeLink run for real; only the OS
 * edges (Linking, Alert) are observed.
 */
import { Alert, Linking } from 'react-native';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import { useToastStore } from '../../store/toastStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { setScreenContext } from '../../services/screenContext';
import * as tee from '../../services/teeTimeLink';
import * as fs from 'fs';
import * as path from 'path';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:\w])\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const MENIFEE = {
  course_id: '18123', name: 'Menifee Lakes Country Club', website: 'https://menifeelakes.example/tee-times',
  phone: '(951) 672-3090', bookingUrl: 'https://menifeelakes.example/tee-times', lat: 33.7, lng: -117.2, nowMs: 1_000,
};

let opened: string[];
let alerts: { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[];

beforeEach(() => {
  opened = [];
  alerts = [];
  jest.spyOn(Linking, 'openURL').mockImplementation(async (u: string) => { opened.push(u); return true; });
  jest.spyOn(Alert, 'alert').mockImplementation(((title: string, message: string, buttons: never) => {
    alerts.push({ title, message, buttons });
  }) as never);
  useCaddieMemoryStore.setState({ courseBook: {} } as never);
  usePlayerProfileStore.setState({ rateCategory: 'none', homeCourses: [] } as never);
  useToastStore.setState({ message: null });
  setScreenContext(null as never);
});
afterEach(() => jest.restoreAllMocks());

describe('the rate category is a profile fact the caddie is sent', () => {
  it('defaults to none, holds a real category, and refuses one that is not', () => {
    const p = usePlayerProfileStore.getState();
    expect(p.rateCategory).toBe('none');
    p.setRateCategory('veteran_military');
    expect(usePlayerProfileStore.getState().rateCategory).toBe('veteran_military');
    p.setRateCategory('platinum' as never);
    expect(usePlayerProfileStore.getState().rateCategory).toBe('none');
  });

  it('rides the one payload builder, normalised', () => {
    usePlayerProfileStore.getState().setRateCategory('senior');
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).rateCategory).toBe('senior');
    // A stale / hostile persisted value is sent as none, never passed through.
    usePlayerProfileStore.setState({ rateCategory: 'gold' } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).rateCategory).toBe('none');
  });

  it('the pro-shop number of the course being looked at rides the payload too', () => {
    const { useRoundStore } = require('../../store/roundStore') as typeof import('../../store/roundStore');
    useRoundStore.setState({ activeCourseId: null, previewCourseId: '18123' } as never);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).proShop).toBeNull();
    useCaddieMemoryStore.getState().saveCourseBook(MENIFEE);
    expect(buildCaddieRequestBody({ message: 'x', language: 'en' }).proShop)
      .toEqual({ course: 'Menifee Lakes Country Club', phone: '(951) 672-3090' });
    useRoundStore.setState({ previewCourseId: null } as never);
  });
});

describe('the call script says only what the player asked for', () => {
  it('in the order a pro shop asks', () => {
    expect(tee.buildTeeTimeCallScript({
      date: 'Saturday', timeWindow: 'around 8am', players: 2, transport: 'walking', rateCategory: 'veteran_military',
    })).toBe('Saturday around 8am, 2 players, walking, veteran/military rate');
  });
  it('drops what was not said, and a rate of none is not a rate', () => {
    expect(tee.buildTeeTimeCallScript({ players: 1, rateCategory: 'none' })).toBe('1 player');
    expect(tee.buildTeeTimeCallScript({ players: 40, rateCategory: 'none' })).toBe('');
  });
  it('a pro-shop number becomes something the phone can dial', () => {
    expect(tee.telUrl('(951) 672-3090')).toBe('tel:9516723090');
    expect(tee.telUrl('+1 951-672-3090')).toBe('tel:+19516723090');
    expect(tee.telUrl('n/a')).toBeNull();
  });
});

describe('"book me a tee time" — the find_tee_time tool, dispatched', () => {
  it('opens the course\'s OWN booking page and offers the pro shop with the script', async () => {
    useCaddieMemoryStore.getState().saveCourseBook(MENIFEE);
    usePlayerProfileStore.getState().setRateCategory('veteran_military');
    dispatchConversationalToolActions([{
      type: 'find_tee_time', course: 'Menifee Lakes', date: 'Saturday', time_window: 'around 8am', players: 2, transport: 'walking',
    }]);
    await flush();
    expect(opened).toEqual(['https://menifeelakes.example/tee-times']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).toContain('(951) 672-3090');
    expect(alerts[0].message).toContain('Saturday around 8am, 2 players, walking, veteran/military rate');
    // Tapping the call button dials the shop.
    alerts[0].buttons.find((b) => /call/i.test(b.text))!.onPress!();
    await flush();
    expect(opened).toEqual(['https://menifeelakes.example/tee-times', 'tel:9516723090']);
  });

  it('a model that fills rate_category with "none" does not drop the rate the profile says to ask for', async () => {
    useCaddieMemoryStore.getState().saveCourseBook(MENIFEE);
    usePlayerProfileStore.getState().setRateCategory('veteran_military');
    const r = await tee.runFindTeeTime({ course: 'Menifee Lakes', rate_category: 'none' });
    expect(r?.script).toBe('veteran/military rate');
    // ...while a rate NAMED this turn wins over the profile.
    const r2 = await tee.runFindTeeTime({ course: 'Menifee Lakes', rate_category: 'senior' });
    expect(r2?.script).toBe('senior rate');
  });

  it('with no number on file there is no dead call button — the script is still shown', async () => {
    usePlayerProfileStore.getState().setRateCategory('junior');
    await tee.runFindTeeTime({ course: 'Nowhere Muni', date: 'Sunday' });
    expect(alerts).toHaveLength(0);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https:\/\/www\.google\.com\/search\?q=Nowhere%20Muni/);
    expect(useToastStore.getState().message).toBe('Ask for: Sunday, junior rate');
  });

  it('a home course supplies the id when the course book has not been written yet', () => {
    usePlayerProfileStore.setState({ homeCourses: [{ id: '777', name: 'Rancho California Golf Club' }] } as never);
    expect(tee.resolveTeeTimeCourse('Rancho California')).toEqual({ name: 'Rancho California Golf Club', courseId: '777' });
  });

  it('is suppressed during the get-to-know interview — "I book at Menifee" there is information', async () => {
    setScreenContext({ screen: 'getting to know the golfer' } as never);
    dispatchConversationalToolActions([{ type: 'find_tee_time', course: 'Menifee Lakes' }]);
    await flush();
    expect(opened).toEqual([]);
  });
});

describe('every tee-time button goes through the one helper, with the course id', () => {
  it('the Caddie tab passes the picked course id and dispatches the tool', () => {
    const src = code('app/(tabs)/caddie.tsx');
    expect(src).toMatch(/openTeeTimeSearch\(selectedPickedCourse\.name, null, selectedPickedCourse\.id\)/);
    expect(src).toMatch(/case 'find_tee_time':[\s\S]{0,200}runFindTeeTime\(action\)/);
  });

  it('the Play tab no longer builds its own Google search', () => {
    const src = code('app/(tabs)/play.tsx');
    const fn = src.slice(src.indexOf('const handleBookTeeTime'), src.indexOf('const handleCourseLayout'));
    expect(fn).toMatch(/openTeeTimeSearch\(name, loc \|\| null, selected\.id\)/);
    expect(fn).not.toMatch(/google\.com\/search/);
  });
});
