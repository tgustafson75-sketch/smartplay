/**
 * 2026-09-06 (Tim) — Layer 0, remote kill switches.
 *
 * Two properties matter more than anything else this feature does, and both are the kind that look
 * fine in review and only fail in the field:
 *
 *   1. A FAILED FETCH MUST NEVER DARK A FEATURE. The whole point is being able to turn something off
 *      remotely; the whole risk is turning everything off accidentally, for everyone, because an
 *      endpoint 500'd or a player walked into a dead zone. Every failure path has to answer "keep
 *      what you had", and the only honest way to know that is to run the failures.
 *
 *   2. THE TWO ENDS CANNOT DRIFT. releaseSurface.ts's header already documents this exact trap for
 *      the shelving mechanism: hide the card but leave appCatalog and openToolHandler wired, and the
 *      caddie "still offers a shelved screen and navigates straight to it — the exact
 *      connected-but-not-used trap, inverted." A kill switch has the same consumers. Gating the •••
 *      menu without gating the caddie's own routing would reproduce it exactly, and nothing about
 *      the menu code would look wrong.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('the store fails open, on every failure a network can produce', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.resetModules();
  });

  /** Fresh module registry each time so the store starts from its bundled defaults. */
  const freshStore = () => {
    let mod: typeof import('../../store/flagStore');
    jest.isolateModules(() => {
      mod = require('../../store/flagStore');
    });
    return mod!;
  };

  it('starts every feature ON before any network call happens', () => {
    const { useFlagStore, DEFAULT_FLAGS } = freshStore();
    expect(useFlagStore.getState().flags).toEqual(DEFAULT_FLAGS);
    expect(Object.values(DEFAULT_FLAGS).every(Boolean)).toBe(true);
  });

  const FAILURES: [string, () => Promise<unknown>][] = [
    ['a rejected fetch (offline / DNS / airplane mode)', () => Promise.reject(new Error('Network request failed'))],
    ['a timeout', () => Promise.reject(Object.assign(new Error('Aborted'), { name: 'TimeoutError' }))],
    ['a 500', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ['a 404', () => Promise.resolve({ ok: false, status: 404, json: async () => ({}) })],
    ['HTML instead of JSON', () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
    ['a JSON array instead of an object', () => Promise.resolve({ ok: true, status: 200, json: async () => [] })],
    ['literal null', () => Promise.resolve({ ok: true, status: 200, json: async () => null })],
    ['an all-false document under the WRONG key', () => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ feature_flags: { smartvision: false, smartfinder: false } }),
    })],
    ['flags present but not booleans', () => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ flags: { smartvision: 'false', smartfinder: 0, swinglab: null } }),
    })],
  ];

  it.each(FAILURES)('%s leaves every feature ON', async (_label, impl) => {
    const { useFlagStore, DEFAULT_FLAGS } = freshStore();
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().flags).toEqual(DEFAULT_FLAGS);
  });

  it('a truncated response cannot resurrect a feature that was killed', async () => {
    const { useFlagStore } = freshStore();
    // Server kills SmartVision.
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ flags: { smartvision: false } }),
    })) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().flags.smartvision).toBe(false);

    // Next response omits it entirely. It must stay OFF — merging against DEFAULTS instead of
    // against CURRENT state would silently turn it back on, which is the failure mode that makes a
    // kill switch untrustworthy in the exact moment you need it.
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ flags: { smartfinder: true } }),
    })) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().flags.smartvision).toBe(false);
  });

  it('actually applies a real kill, in both directions', async () => {
    const { useFlagStore } = freshStore();
    const doc = (v: boolean) => ({ ok: true, status: 200, json: async () => ({ flags: { smartvision: v } }) });

    global.fetch = jest.fn(() => Promise.resolve(doc(false))) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().flags.smartvision).toBe(false);

    global.fetch = jest.fn(() => Promise.resolve(doc(true))) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().flags.smartvision).toBe(true);
  });

  it('honours the 60s floor, and force bypasses it', async () => {
    const { useFlagStore } = freshStore();
    const spy = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ flags: {} }) }));
    global.fetch = spy as unknown as typeof fetch;

    await useFlagStore.getState().refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(1);
    await useFlagStore.getState().refresh();          // inside the window → no call
    expect(spy).toHaveBeenCalledTimes(1);
    await useFlagStore.getState().refresh({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('drops a non-string course id rather than coercing it into a disabled course', async () => {
    const { useFlagStore } = freshStore();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ course_geometry: { disabled_course_ids: ['local:palms', 42, null, ''] } }),
    })) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    expect(useFlagStore.getState().disabledCourseIds).toEqual(['local:palms']);
  });

  it('matches a killed route even with a query string on it', async () => {
    const { useFlagStore, isRouteKilled } = freshStore();
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ flags: { smartfinder: false } }),
    })) as unknown as typeof fetch;
    await useFlagStore.getState().refresh({ force: true });
    // The ••• menu opens Smart Play as '/smartfinder?autoread=1'; the caddie can too.
    expect(isRouteKilled('/smartfinder?autoread=1')).toBe(true);
    expect(isRouteKilled('/smartfinder')).toBe(true);
    expect(isRouteKilled('/(tabs)/scorecard')).toBe(false);
  });
});

describe('both ends of every switch are wired, not just the menu', () => {
  const flagStore = read('store/flagStore.ts');

  /** Route → the screen file expected to gate itself. */
  const SCREEN_FOR_ROUTE: Record<string, string> = {
    '/smartvision': 'app/smartvision.tsx',
    '/smartfinder': 'app/smartfinder.tsx',
    '/(tabs)/swinglab': 'app/(tabs)/swinglab.tsx',
    '/lie-analysis': 'app/lie-analysis.tsx',
    '/swinglab/upload': 'app/swinglab/upload.tsx',
    '/swinglab/smartmotion': 'app/swinglab/smartmotion.tsx',
  };

  const killableRoutes = (() => {
    const block = flagStore.slice(flagStore.indexOf('const ROUTE_TO_FLAG'), flagStore.indexOf('};', flagStore.indexOf('const ROUTE_TO_FLAG')));
    return [...block.matchAll(/'([^']+)':\s*'([a-z_]+)'/g)].map(m => ({ route: m[1], flag: m[2] }));
  })();

  it('parses the route map (guards the parser itself)', () => {
    expect(killableRoutes.length).toBe(Object.keys(SCREEN_FOR_ROUTE).length);
  });

  it.each(killableRoutes.map(r => [r.route, r.flag]))(
    '%s has a screen that gates itself on %s',
    (route, flag) => {
      const file = SCREEN_FOR_ROUTE[route];
      expect(file).toBeTruthy();
      const src = read(file);
      expect(src).toContain('useFlagGate');
      expect(src).toContain(`'${flag}'`);
    },
  );

  /**
   * BEHAVIOURAL, not textual. The first version of this assertion only checked that the strings
   * `isRouteKilled` / `actionIsKilled` appeared in the file, and a break-test proved that was too
   * weak: wrapping the gate in `if (false && …)` left every string in place and the test stayed
   * green. A static check catches DELETION of a gate but not DISABLING of one, and this is the
   * highest-risk gate in the feature — it is the one releaseSurface.ts warns about by name. So run it.
   */
  it('the caddie cannot navigate to a killed route behind the menu\'s back', async () => {
    const { openToolHandler } = require('../../services/intents/openToolHandler') as typeof import('../../services/intents/openToolHandler');
    const { useFlagStore } = require('../../store/flagStore') as typeof import('../../store/flagStore');
    const before = useFlagStore.getState().flags;

    const ask = (tool: string, raw: string) => openToolHandler.execute(
      { intent_type: 'open_tool', parameters: { tool_name: tool }, confidence: 'high', follow_up_question: null, raw_text: raw },
      {} as never,
    );

    try {
      // Live: the tool opens (some path other than the brain hand-off).
      useFlagStore.setState({ flags: { ...before, smartvision: true } });
      const live = await ask('smartvision', 'open smartvision');
      expect(live.side_effects?.some(s => s.startsWith('route_to_brain:kill_switch'))).toBeFalsy();

      // Killed: it must NOT navigate, and must not fall into the "Which tool — SmartVision, …?"
      // clarifying prompt, which would name the killed feature straight back at the player.
      useFlagStore.setState({ flags: { ...before, smartvision: false } });
      const killed = await ask('smartvision', 'open smartvision');
      expect(killed.tool_action).toBeFalsy();
      expect(killed.route_to_brain).toBe(true);
      expect(killed.voice_response ?? '').not.toMatch(/SmartVision/i);
    } finally {
      useFlagStore.setState({ flags: before });
    }
  });

  it('the tool router can be killed without silencing the caddie', () => {
    const router = read('services/voiceCommandRouter.ts');
    expect(router).toContain("isFlagEnabled('kevin_tool_routing')");
    // It must fall to the brain, not return an error or nothing.
    expect(router).toContain('route_to_brain: true');
  });

  it('the mic has one chokepoint and it is gated', () => {
    expect(read('services/listeningSession.ts')).toContain("isFlagEnabled('voice_caddie')");
    expect(read('components/caddie/CaddieBottomBar.tsx')).toContain("useFlag('voice_caddie')");
  });

  it('per-course geometry is gated on BOTH the build and the cached read', () => {
    const geo = read('services/courseGeometryService.ts');
    // Gating only fetchCourseGeometry would leave an already-cached course serving built geometry
    // until the cache aged out — the switch would appear not to work.
    expect(geo.match(/isCourseGeometryDisabled/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the round-critical spine is not killable', () => {
  const flagStore = read('store/flagStore.ts');

  it('declares no flag for GPS, scoring, the bag, the course book or history', () => {
    const block = flagStore.slice(flagStore.indexOf('export type FlagKey'), flagStore.indexOf('export type Flags'));
    for (const forbidden of ['gps', 'yardage', 'scorecard', 'round', 'bag', 'course_book', 'history']) {
      expect(block).not.toContain(forbidden);
    }
  });

  it('never gates the scorecard, play or caddie tabs', () => {
    const tabs = read('app/(tabs)/_layout.tsx');
    // Only SwingLab is killable; the other four tabs must carry no href gate.
    expect(tabs.match(/href: \w+ \? undefined : null/g)?.length).toBe(1);
  });
});
