/**
 * 2026-09-28 (1.0.2) — ON THE FREE TIER THE CADDIE WENT MUTE INSTEAD OF SHOWING THE PAYWALL.
 *
 * mayTalkToCaddie() handed triggerPaywall an empty navigate, so off a round nothing opened, askCaddie
 * returned null, and every surface spoke "That one got away from me" to a player whose only problem
 * was the plan. Now: a turn the player started opens /paywall off-round; in a round the paywall waits
 * (the existing deferral) and the caddie says it is a SmartPlay Full feature. Proactive speech never
 * raises the paywall.
 */

const routerMock = require('expo-router') as { __calls: { method: string; args: unknown[] }[]; __reset: () => void };

import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useRoundStore } from '../../store/roundStore';
import * as featureAccess from '../../services/featureAccess';
import { mayTalkToCaddie, takeCaddiePaywallBlock, CADDIE_PAYWALL_DEFERRED_LINE } from '../../services/featureAccess';
import { askCaddie } from '../../services/caddieBrain';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const pushedPaywall = () => routerMock.__calls.filter((c) => c.method === 'push' && c.args[0] === '/paywall').length;

beforeEach(() => {
  routerMock.__reset();
  // Optional call so this file also runs (and fails for the RIGHT reason) against the pre-fix tree.
  (featureAccess as { __resetCaddieBlockForTest?: () => void }).__resetCaddieBlockForTest?.();
  usePlayerProfileStore.setState({ subscription_status: 'free' } as never);
  useRoundStore.setState({ isRoundActive: false } as never);
});

describe('a lite player asks the caddie something', () => {
  it('THE BUG: outside a round, the plans screen opens', async () => {
    expect(mayTalkToCaddie({ userInitiated: true })).toBe(false);
    await flush();
    expect(pushedPaywall()).toBe(1);
    expect(takeCaddiePaywallBlock()).toEqual({ deferred: false });
  });

  it('through askCaddie — the one brain call every mic path uses — without touching the network', async () => {
    const realFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const turn = await askCaddie({ message: 'what club from 150', language: 'en', timeoutMs: 1000 });
      await flush();
      expect(turn).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(pushedPaywall()).toBe(1);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('inside a round the paywall waits, and the caddie has a line for it — not the failure line', async () => {
    useRoundStore.setState({ isRoundActive: true } as never);
    expect(mayTalkToCaddie({ userInitiated: true })).toBe(false);
    await flush();
    expect(pushedPaywall()).toBe(0);
    expect(takeCaddiePaywallBlock()).toEqual({ deferred: true });
    expect(CADDIE_PAYWALL_DEFERRED_LINE).toMatch(/SmartPlay Full/);
    expect(CADDIE_PAYWALL_DEFERRED_LINE).toMatch(/after the round/);
    expect(CADDIE_PAYWALL_DEFERRED_LINE).not.toMatch(/got away|lost you/i);
  });

  it('a surface retrying the same blocked turn does not stack a second paywall', async () => {
    mayTalkToCaddie({ userInitiated: true });
    mayTalkToCaddie({ userInitiated: true });
    await flush();
    expect(pushedPaywall()).toBe(1);
  });
});

describe('proactive speech never raises the paywall', () => {
  it('the gate without userInitiated says no, quietly', async () => {
    expect(mayTalkToCaddie()).toBe(false);
    await flush();
    expect(pushedPaywall()).toBe(0);
    expect(takeCaddiePaywallBlock()).toBeNull();
  });

  it('an is_proactive askCaddie (the app-open opener) opens nothing', async () => {
    const turn = await askCaddie({ message: 'greet them', language: 'en', timeoutMs: 1000, overrides: { is_proactive: true } as never });
    await flush();
    expect(turn).toBeNull();
    expect(pushedPaywall()).toBe(0);
  });
});

describe('a Pro player is untouched', () => {
  it('passes the gate and raises nothing', async () => {
    usePlayerProfileStore.setState({ subscription_status: 'active' } as never);
    expect(mayTalkToCaddie({ userInitiated: true })).toBe(true);
    await flush();
    expect(pushedPaywall()).toBe(0);
  });
});

describe('every entry path consults the block instead of speaking a failure', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('the Caddie-tab mic (useCaddieTabMic), before its "lost you" line', () => {
    const src = code('hooks/useCaddieTabMic.ts');
    const at = src.indexOf('if (!turn) {');
    expect(src.indexOf('takeCaddiePaywallBlock()', at)).toBeGreaterThan(at);
    expect(src.indexOf('takeCaddiePaywallBlock()', at)).toBeLessThan(src.indexOf('lost you', at));
  });

  it('the earbud / typed / watch path (listeningSession.deliverBrainReply), before any failure line', () => {
    const src = code('services/listeningSession.ts');
    const at = src.indexOf('async function deliverBrainReply(');
    const body = src.slice(at, at + 3000);
    expect(body).toMatch(/if \(!text\) \{\s*const block = takeCaddiePaywallBlock\(\);/);
  });

  it('the Caddie-tab follow-up loop is gated before its own /api/kevin fetch', () => {
    const src = code('hooks/useVoiceCaddie.ts');
    const gate = src.indexOf('if (!mayTalkToCaddie({ userInitiated: true })) {');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('const reply = await sendToBrain(trimmed);'));
  });

  it('conversationalBrain and sceneReadService ask as the player; presenceCaddie does not', () => {
    expect(code('services/conversationalBrain.ts')).toMatch(/mayTalkToCaddie\(\{ userInitiated: true \}\)/);
    expect(code('services/sceneReadService.ts')).toMatch(/mayTalkToCaddie\(\{ userInitiated: true \}\)/);
    expect(code('services/presenceCaddie.ts')).toMatch(/if \(!mayTalkToCaddie\(\)\) return null;/);
  });
});
