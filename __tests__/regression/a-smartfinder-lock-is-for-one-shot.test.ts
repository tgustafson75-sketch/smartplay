/**
 * 2026-10-27 (Brain review F3) — A SMARTFINDER LOCK IS A NUMBER FOR ONE SHOT, NOT FOR THE REST OF THE DAY.
 *
 * The lock was written to smartFinderStore and cleared only when the screen's local `locked` went
 * false. Leaving SmartFinder locked kept it in memory until the app restarted, and the payload builder
 * sent any lock with no age or hole check — so api/kevin told the model "use this exact yardage as
 * your working number". Lock 152 on hole 4, walk off, ask "what do I have?" on hole 7: "you've got 152".
 *
 * BEHAVIOURAL: the real stores → the real payload builder → the real api/kevin handler (model stubbed
 * at the provider boundary) → whether the lock reaches the prompt.
 */
import fs from 'fs';
import path from 'path';
import handler from '../../api/kevin';
import { useRoundStore } from '../../store/roundStore';
import { useSmartFinderStore } from '../../store/smartFinderStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import type { RangefinderLock } from '../../types/smartfinder';

const seen: { system: string; user: string } = { system: '', user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'ok', provider: 'anthropic', rounds: 1, usage: null };
    }),
  };
});
jest.mock('openai', () => jest.fn().mockImplementation(() => ({
  audio: { speech: { create: jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })) } },
  chat: { completions: { create: jest.fn(async () => ({ choices: [{ message: { content: '' } }] })) } },
})));
jest.mock('../../api/_inferLimit', () => ({ allowInference: () => true }));
jest.mock('../../api/_cors', () => ({ applyCors: () => false }));

function callKevin(body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader: () => res,
      status(code: number) { status = code; return res; },
      json() { resolve(status); return res; },
      end() { resolve(status); return res; },
    };
    void handler({ method: 'POST', headers: {}, query: {}, body } as never, res as never);
  });
}

const lock = (hole: number, agoMs: number): RangefinderLock => ({
  id: 'lock_t',
  locked_at: Date.now() - agoMs,
  user_position: { lat: 33.7, lng: -116.9, accuracy: 4 },
  target_position: { lat: 33.701, lng: -116.9, estimated: true },
  distance_yards: 152,
  distance_meters: 139,
  compass_heading: 10,
  tap_y_normalized: 0.52,
  hole,
} as RangefinderLock);

function onHole(currentHole: number) {
  useRoundStore.setState({
    isRoundActive: true,
    activeCourse: 'Test Links',
    activeCourseId: 'local:test-links',
    currentHole,
    courseHoles: [6, 7, 8].map((h) => ({ hole: h, par: 4, distance: 380 })),
    scores: {},
  } as never);
}

async function promptFor(): Promise<string> {
  seen.system = ''; seen.user = '';
  await callKevin({ ...buildCaddieRequestBody({ message: 'what do I have?', language: 'en' }), skip_tts: true });
  return seen.system + '\n' + seen.user;
}

afterEach(() => useSmartFinderStore.getState().clearLock());

describe('a SmartFinder lock reaches the caddie only for the shot it was taken for', () => {
  it('a lock taken just now on this hole IS the working number (the wire still works)', async () => {
    onHole(7);
    useSmartFinderStore.getState().setLock(lock(7, 30_000));
    const p = await promptFor();
    expect(p).toContain('SMARTFINDER LOCK');
    expect(p).toContain('locked distance of 152 yards');
  });

  it('a lock left behind on hole 4 does not ride along to hole 7', async () => {
    onHole(7);
    useSmartFinderStore.getState().setLock(lock(4, 2 * 60_000));
    const p = await promptFor();
    expect(p).not.toContain('SMARTFINDER LOCK');
    expect(p).not.toContain('locked distance of 152');
  });

  it('a lock on this hole from long ago is not the working number either', async () => {
    onHole(7);
    useSmartFinderStore.getState().setLock(lock(7, 45 * 60_000));
    const p = await promptFor();
    expect(p).not.toContain('locked distance of 152');
  });

  /**
   * The screen half. TargetCameraOverlay is a private component of a 3,400-line screen that needs the
   * camera, GPS and sensors to mount, so this one reads the source: an unmount cleanup that clears the
   * shared lock, and a lock stamped with the hole and the time it was TAKEN (not the GPS fix's time,
   * which can be minutes old). The builder tests above are the behavioural gate.
   */
  it('the screen clears the lock when it goes away and stamps hole + take time', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../app/smartfinder.tsx'), 'utf-8');
    expect(src).toMatch(/useEffect\(\(\) => \(\) => \{\s*\(require\('\.\.\/store\/smartFinderStore'\)[^\n]*\.clearLock\(\);\s*\}, \[\]\);/);
    const setLockCall = src.slice(src.indexOf('store.setLock({'), src.indexOf('store.setLock({') + 1200);
    expect(setLockCall).toMatch(/\bhole: currentHole,/);
    expect(setLockCall).toMatch(/locked_at: Date\.now\(\),/);
  });
});
