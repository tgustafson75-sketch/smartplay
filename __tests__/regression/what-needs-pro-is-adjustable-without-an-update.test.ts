/**
 * 2026-10-10 (Tim: "We are not changing prices. We are just adjusting what's behind it to encourage more
 * play usage, feedback and improvement... relatively liberal") — the free/Pro table comes from the server
 * (api/app-config) and is adjusted weekly without an app update.
 */
import { parseFeatureEdition, useAppConfigStore } from '../../services/remoteAppConfig';
import { canAccess, effectiveEdition, FEATURE_EDITION } from '../../services/featureAccess';

beforeEach(() => useAppConfigStore.setState({ featureEdition: {}, fetchedAt: 0 }));

describe('what needs Pro is the server\'s call', () => {
  it('with no server table, the built-in one stands', () => {
    expect(effectiveEdition('smartvision')).toBe(FEATURE_EDITION.smartvision);
  });

  it('the server can open a Pro feature to free players', () => {
    useAppConfigStore.setState({ featureEdition: { smartvision: 'lite', voice_advanced: 'lite' } });
    expect(canAccess('smartvision', 'free')).toBe(true);
    expect(canAccess('voice_advanced', 'free')).toBe(true);
  });

  it('...and close it again', () => {
    useAppConfigStore.setState({ featureEdition: { smartvision: 'pro' } });
    expect(canAccess('smartvision', 'free')).toBe(false);
    expect(canAccess('smartvision', 'active')).toBe(true);
  });

  it('starting a round is free whatever the server says', () => {
    useAppConfigStore.setState({ featureEdition: { round_start: 'pro' } });
    expect(canAccess('round_start', 'free')).toBe(true);
  });

  it('only known features and the two editions are accepted', () => {
    expect(parseFeatureEdition({ featureEdition: { smartvision: 'lite', cage_mode: 'free', hacked: 'lite' } }))
      .toEqual({ smartvision: 'lite' });
    expect(parseFeatureEdition(null)).toBeNull();
    expect(parseFeatureEdition({ nope: 1 })).toBeNull();
  });

  it('the server file is valid and is what the app expects', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../api/app-config.ts'), 'utf8');
    const block = src.slice(src.indexOf('const FEATURE_EDITION = {'), src.indexOf('} as const;'));
    for (const k of Object.keys(FEATURE_EDITION)) expect(block).toMatch(new RegExp(`\\b${k}: '(lite|pro)'`));
    const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8')) as { routes: { src: string; dest: string }[] };
    expect(vercel.routes.some((r) => r.src === '/api/app-config' && r.dest === '/api/app-config.ts')).toBe(true);
  });
});
