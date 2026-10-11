/**
 * 2026-10-10 (Tim: "We are not changing prices. We are just adjusting what's behind it to encourage more
 * play usage, feedback and improvement... relatively liberal") — what needs Pro comes from the server's
 * flag document (api/flags `feature_edition`, Vercel Edge Config), the same switchboard as the kill
 * switches — never a second remote config.
 */
import { useFlagStore } from '../../store/flagStore';
import { canAccess, effectiveEdition, FEATURE_EDITION } from '../../services/featureAccess';

beforeEach(() => useFlagStore.setState({ featureEdition: {} }));

describe('what needs Pro is the server\'s call', () => {
  it('with no server table, the built-in one stands', () => {
    expect(effectiveEdition('smartvision')).toBe(FEATURE_EDITION.smartvision);
  });

  it('the server can open a Pro feature to free players, and close it again', () => {
    useFlagStore.setState({ featureEdition: { smartvision: 'lite', voice_advanced: 'lite' } });
    expect(canAccess('smartvision', 'free')).toBe(true);
    expect(canAccess('voice_advanced', 'free')).toBe(true);
    useFlagStore.setState({ featureEdition: { smartvision: 'pro' } });
    expect(canAccess('smartvision', 'free')).toBe(false);
    expect(canAccess('smartvision', 'active')).toBe(true);
  });

  it('starting a round is free whatever the server says', () => {
    useFlagStore.setState({ featureEdition: { round_start: 'pro' } });
    expect(canAccess('round_start', 'free')).toBe(true);
  });

  it('the fetch reads feature_edition from /flags, keeps only lite/pro, and persists it', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ flags: {}, feature_edition: { smartvision: 'lite', cage_mode: 'free', x: 'pro' } }) })) as never;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().featureEdition).toEqual({ smartvision: 'lite', x: 'pro' });
    global.fetch = realFetch;
  });

  it('the server ships the liberal defaults, and only ONE remote config exists', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../api/flags.ts'), 'utf8');
    for (const k of ['voice_advanced', 'smartvision', 'smartfinder', 'cage_mode']) expect(src).toMatch(new RegExp(`\\b${k}: '(lite|pro)'`));
    expect(src).toMatch(/feature_edition: mergeFeatureEdition\(items\.feature_edition\),/);
    expect(fs.existsSync(path.join(__dirname, '../../api/app-config.ts'))).toBe(false);
  });
});
