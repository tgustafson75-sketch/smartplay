/**
 * 2026-09-28 (1.0.2) — ACCURACY + THE SMARTFINDER / SMARTVISION GAPS.
 *
 * Gates keyed on the exact strings '/smartfinder' and '/smartvision', so the voice intents' own paths
 * ('/smartfinder?autoread=1&mode=putt', …) reached a plain router.push on lite. measure-scan (a paid
 * vision call) had no gate at all, and CockpitCaddieScreen fell back to an ungated push. The paywall
 * also sold "Round intelligence — post-round recap", which is free, and two alerts told production
 * players to "Update from TestFlight".
 */
import fs from 'fs';
import path from 'path';

const routerMock = require('expo-router') as { __calls: { method: string; args: unknown[] }[]; __reset: () => void };

import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';
import { gatedFeatureForPath } from '../../services/featureAccess';
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { scanForMeasureReference } from '../../services/measureScan';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const pushes = () => routerMock.__calls.filter((c) => c.method === 'push').map((c) => c.args[0]);
const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

beforeEach(() => {
  routerMock.__reset();
  useRoundStore.setState({ isRoundActive: false } as never);
});

describe('a paid tool is recognised by its pathname', () => {
  it('query strings and trailing slashes do not hide it', () => {
    expect(gatedFeatureForPath('/smartfinder')).toBe('smartfinder');
    expect(gatedFeatureForPath('/smartfinder?autoread=1&mode=putt')).toBe('smartfinder');
    expect(gatedFeatureForPath('/smartvision?hole=3')).toBe('smartvision');
    expect(gatedFeatureForPath('/smartvision/')).toBe('smartvision');
    expect(gatedFeatureForPath('/smartfinder-help')).toBeNull();
    expect(gatedFeatureForPath('/scorecard')).toBeNull();
  });
});

describe('THE BUG: a voice navigate to /smartfinder?… on lite', () => {
  it('opens the paywall, not the paid tool', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'free' } as never);
    dispatchConversationalToolActions([{ type: 'navigate', path: '/smartfinder?autoread=1&mode=putt' }]);
    await flush();
    expect(pushes()).toEqual(['/paywall']);
  });

  it('a Pro player goes straight through, query intact', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'active' } as never);
    dispatchConversationalToolActions([{ type: 'navigate', path: '/smartfinder?autoread=1&mode=putt' }]);
    await flush();
    expect(pushes()).toEqual(['/smartfinder?autoread=1&mode=putt']);
  });

  it('an ungated route is untouched on lite', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'free' } as never);
    dispatchConversationalToolActions([{ type: 'navigate', path: '/scorecard' }]);
    await flush();
    expect(pushes()).toEqual(['/scorecard']);
  });
});

describe('measure-scan is a paid call', () => {
  it('lite: no request, the existing "keep your read" answer', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'free' } as never);
    const realFetch = global.fetch;
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    try {
      const r = await scanForMeasureReference('AAAA');
      expect(r.found).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe('every other door checks by pathname too', () => {
  it('the Caddie tab\'s own navigate handler', () => {
    const src = code('app/(tabs)/caddie.tsx');
    const at = src.indexOf("case 'navigate':");
    expect(src.slice(at, at + 500)).toMatch(/gatedFeatureForPath\(action\.path\)/);
  });
  it('the catalog remap matches the pathname', () => {
    expect(code('services/intents/openToolHandler.ts')).toMatch(/const pathname = feature\.route\.split\(/);
  });
  it('the cockpit fallbacks go through the gate', () => {
    const src = code('components/caddie/CockpitCaddieScreen.tsx');
    expect(src).toMatch(/else openGated\('smartfinder', '\/smartfinder'\);/);
    expect(src).toMatch(/else openGated\('smartvision', '\/smartvision'\);/);
    expect(src).not.toMatch(/else router\.push\('\/smart(finder|vision)'/);
  });
});

describe('the paywall tells the truth', () => {
  it('does not sell the free recap', () => {
    expect(code('app/paywall.tsx')).not.toMatch(/Round intelligence|Post-round recap/);
  });
  it('never sends a production player to TestFlight', () => {
    const en = fs.readFileSync(path.join(__dirname, '../../i18n/locales/en.json'), 'utf8');
    expect(en).not.toMatch(/TestFlight/);
    expect(code('app/paywall.tsx')).not.toMatch(/latest_version/);
  });
});
