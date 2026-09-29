/**
 * 2026-09-28 (1.0.2) — FOUR FUNNEL EVENTS, FIRST-PARTY ONLY, ON BY DEFAULT FOR NEW INSTALLS.
 *
 * first_open, first_round, second_round and first_caddie_turn go through the existing usage pipe
 * (usageTelemetry → /api/usage), each once per install, carrying only the fields declared in
 * services/funnelEvents — the list the App Store / Play privacy answers are written from. The batch
 * carries a random per-install anonId and NO email (it used to attach the player's email as userId,
 * under a Settings row promising "never your name").
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const sent: { url: string; body: { events: { event: string; props?: Record<string, unknown>; ts: number }[]; anonId?: string; userId?: string } }[] = [];
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { noteFirstOpen, noteRoundStarted, noteCaddieTurn, __resetFunnelForTest } from '../../services/funnelEvents';
import { flushUsage, teardownUsageTelemetry } from '../../services/usageTelemetry';

const realFetch = global.fetch;
beforeEach(async () => {
  sent.length = 0;
  await AsyncStorage.clear();
  __resetFunnelForTest();
  teardownUsageTelemetry();
  useSettingsStore.setState({ hasHydrated: true, analyticsOptIn: true } as never);
  usePlayerProfileStore.setState({ email: 'tim@example.com' } as never);
  global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => { global.fetch = realFetch; teardownUsageTelemetry(); });

const events = () => sent.flatMap((s) => s.body.events);
async function fireAndFlush(fn: () => void) { fn(); await flush(); await flushUsage(); await flush(); }

describe('each funnel event fires once per install, with only its declared fields', () => {
  it('first_open: platform only', async () => {
    await fireAndFlush(() => { noteFirstOpen(); noteFirstOpen(); });
    expect(events().filter((e) => e.event === 'first_open')).toHaveLength(1);
    expect(Object.keys(events()[0].props ?? {})).toEqual(['platform']);
  });

  it('first_round then second_round, and a third round sends nothing new', async () => {
    await fireAndFlush(() => noteRoundStarted({ holes: 18, mode: 'free_play' }));
    await fireAndFlush(() => noteRoundStarted({ holes: 9, mode: 'break_90' }));
    await fireAndFlush(() => noteRoundStarted({ holes: 18, mode: 'free_play' }));
    const names = events().map((e) => e.event);
    expect(names).toEqual(['first_round', 'second_round']);
    expect(events()[0].props).toEqual({ holes: 18, mode: 'free_play' });
    expect(Object.keys(events()[1].props ?? {})).toEqual(['days_since_first_round']);
  });

  it('first_caddie_turn fires on whichever input path comes first, once', async () => {
    await fireAndFlush(() => { noteCaddieTurn('earbud'); noteCaddieTurn('mic'); noteCaddieTurn('typed'); });
    const turns = events().filter((e) => e.event === 'first_caddie_turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].props).toEqual({ path: 'earbud', in_round: false });
  });

  it('survives a relaunch — the fired set is persisted', async () => {
    await fireAndFlush(() => noteFirstOpen());
    __resetFunnelForTest(); // a new process, same storage
    await fireAndFlush(() => noteFirstOpen());
    expect(events().filter((e) => e.event === 'first_open')).toHaveLength(1);
  });
});

describe('the batch carries no personal identifier', () => {
  it('a random anonId, never the email', async () => {
    await fireAndFlush(() => noteFirstOpen());
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s.url).toMatch(/\/api\/usage$/);
      expect(s.body).not.toHaveProperty('userId');
      expect(JSON.stringify(s.body)).not.toContain('tim@example.com');
      expect(Object.keys(s.body).sort()).toEqual(['anonId', 'events']);
      for (const e of s.body.events) expect(Object.keys(e).sort()).toEqual(['event', 'props', 'ts']);
    }
  });
});

describe('the toggle', () => {
  it('off: nothing is sent', async () => {
    useSettingsStore.setState({ analyticsOptIn: false } as never);
    await fireAndFlush(() => { noteFirstOpen(); noteCaddieTurn('mic'); });
    expect(sent).toHaveLength(0);
  });

  it('ON by default for a new install', () => {
    const fresh = jest.requireActual('../../store/settingsStore') as typeof import('../../store/settingsStore');
    expect(fresh.useSettingsStore.getInitialState().analyticsOptIn).toBe(true);
  });

  it('an existing install keeps its choice — the value is persisted, and v16 seeded FALSE for older ones', () => {
    const opts = (useSettingsStore as unknown as { persist: { getOptions: () => { migrate: (p: unknown, v: number) => Record<string, unknown>; partialize: (s: unknown) => Record<string, unknown> } } }).persist.getOptions();
    expect(opts.migrate({}, 15).analyticsOptIn).toBe(false);
    expect(Object.keys(opts.partialize(useSettingsStore.getState()))).toContain('analyticsOptIn');
  });
});

describe('every moment is wired to its event (a built event nobody calls is the defect class here)', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('first_open where first_opened_at is stamped', () => {
    expect(code('app/_layout.tsx')).toMatch(/first_opened_at: Date\.now\(\) \}\);\s*try \{ \(require\('\.\.\/services\/funnelEvents'\)[^\n]*\.noteFirstOpen\(\)/);
  });
  it('rounds at round start, real rounds only', () => {
    expect(code('store/roundStore.ts')).toMatch(/if \(options\.simulated !== true\) \{\s*\(require\('\.\.\/services\/funnelEvents'\)[\s\S]{0,120}?\.noteRoundStarted\(/);
  });
  it('first_caddie_turn on every input path: tap/VAD, earbud, typed (two doors)', () => {
    expect(code('hooks/useVoiceCaddie.ts')).toMatch(/noteCaddieTurn\(source === 'vad' \? 'vad' : 'mic'\)/);
    const ls = code('services/listeningSession.ts');
    expect(ls).toMatch(/noteCaddieTurn\('earbud'\)/);
    expect(ls).toMatch(/noteCaddieTurn\('typed'\)/);
    expect(code('hooks/useCaddieTabMic.ts')).toMatch(/noteCaddieTurn\('typed'\)/);
  });
  it('no third-party analytics SDK', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    const deps = Object.keys(pkg.dependencies).join(' ');
    expect(deps).not.toMatch(/firebase|amplitude|mixpanel|segment|posthog|appsflyer|adjust|branch|fbsdk/i);
  });
});
