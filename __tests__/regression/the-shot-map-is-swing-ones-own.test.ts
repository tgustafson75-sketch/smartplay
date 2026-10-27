/**
 * 2026-10-27 (SmartMotion review audit R1) — THE SHOT MAP IS SWING 1'S, AND THE CADDIE CAN BE ASKED ABOUT IT.
 *
 * The defect: Save / New Set wrote the session's one shot-map snapshot from whichever swing was on screen
 * (the live commit was guarded to swing 1, the save was not), and the library drew that snapshot on every
 * swing of the set — so swings 1 and 2 showed swing 3's tempo and launch. And none of it was askable: the
 * tempo, start line and carry on screen never reached the caddie payload.
 *
 * Driven through the real owners: services/swing/smartMotionShotMap (both writers and the library's reader),
 * services/swing/swingOnScreen + services/caddieRequestBody (the payload), and the shipped api/kevin handler
 * (stubbed only at the model boundary) for where the line lands.
 */
import handler from '../../api/kevin';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { buildCaddieRequestBody, CADDIE_REQUEST_KEYS } from '../../services/caddieRequestBody';
import { shotMapToPersist, shotMapForShot, type ShotMapSource } from '../../services/swing/smartMotionShotMap';
import { swingOnScreenFromShotMap } from '../../services/swing/swingOnScreen';

const seen: { system: string; user: string } = { system: '', user: '' };
jest.mock('../../api/_aiProvider', () => {
  const actual = jest.requireActual('../../api/_aiProvider');
  return {
    ...actual,
    completeText: jest.fn(async () => ({ text: 'ok' })),
    runAgenticLoop: jest.fn(async (_provider: string, _tier: string, system: string, user: string) => {
      seen.system = system;
      seen.user = user;
      return { text: 'Two point nine to one on that one.', provider: 'anthropic', rounds: 1, usage: null };
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

const swing3: ShotMapSource = {
  estCarry: 151, effortPct: null, ballTrace: { side: 'right', divergenceDeg: 6 },
  practiceCanvasFeet: 14, cameraBehindFeet: 7, isPractice: true, angle: 'down_the_line', club: '7I',
  tempo: { ratio: 2.1, backswingMs: 840, downswingMs: 400, sequencingScore: 70 },
  hasBiomech: true, bodyItems: [{ key: 'sway', label: 'Sway', tone: 'warn' }],
};

describe('the session shot map is written from swing 1 only', () => {
  it('THE REPORT: saving with swing 3 on screen writes nothing over swing 1\'s snapshot', () => {
    expect(shotMapToPersist(swing3, 2)).toBeNull();
    expect(shotMapToPersist(swing3, 1)).toBeNull();
  });

  it('swing 1 on screen writes its snapshot (rig geometry only in practice)', () => {
    const m = shotMapToPersist(swing3, 0)!;
    expect(m.tempo).toEqual({ ratio: 2.1, backswingMs: 840, downswingMs: 400, sequencingScore: 70 });
    expect(m.trace).toEqual({ side: 'right', divergenceDeg: 6 });
    expect(m.canvasFeet).toBe(14);
    expect(shotMapToPersist({ ...swing3, isPractice: false }, 0)!.canvasFeet).toBeNull();
  });

  it('nothing read writes nothing', () => {
    expect(shotMapToPersist({ ...swing3, estCarry: null, ballTrace: null, tempo: null, hasBiomech: false, practiceCanvasFeet: null }, 0)).toBeNull();
  });
});

describe('the library shows the snapshot on swing 1 only', () => {
  const saved = shotMapToPersist(swing3, 0);
  it('swings 2 and 3 do not show swing 1\'s tempo and launch as their own', () => {
    expect(shotMapForShot(saved, 1, 3)).toBeNull();
    expect(shotMapForShot(saved, 2, 3)).toBeNull();
    expect(shotMapForShot(saved, 0, 3)).toBe(saved);
    expect(shotMapForShot(null, 0, 3)).toBeNull();
  });
});

describe('the caddie can be asked about the swing on screen', () => {
  afterEach(() => useCaptureEngineStore.getState().setSwingOnScreen(null));
  const body = () => buildCaddieRequestBody({ message: 'how was my tempo on that one?', language: 'en' });
  const saved = shotMapToPersist(swing3, 0);

  it('swing 1 in the library: its measured tempo, its start line, and the carry called an estimate', () => {
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(saved, 0, 3));
    const line = body().swing_on_screen as string;
    expect(line).toContain('Swing 1 of 3 is on their screen');
    expect(line).toContain('measured tempo 2.1:1 backswing to downswing (0.84 s back, 0.40 s down)');
    expect(line).toContain('the ball started 6° right of the aim line');
    expect(line).toContain('Carry about 151 yards is an ESTIMATE');
  });

  it('swing 2 in the library: says its numbers were not saved, never quotes swing 1\'s', () => {
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(saved, 1, 3));
    const line = body().swing_on_screen as string;
    expect(line).toContain('Swing 2 of 3 is on their screen');
    expect(line).toContain('were not saved');
    expect(line).not.toContain('2.1:1');
  });

  it('nothing on screen sends nothing; the key is a declared payload key', () => {
    expect(body().swing_on_screen).toBeNull();
    expect(CADDIE_REQUEST_KEYS).toContain('swing_on_screen');
  });

  it('through the real handler: the line reaches the model in the MESSAGE, never the cached system prompt', async () => {
    useCaptureEngineStore.getState().setSwingOnScreen(swingOnScreenFromShotMap(saved, 0, 3));
    const line = body().swing_on_screen as string;
    const status = await callKevin({ message: 'how was my tempo on that one?', swing_on_screen: line });
    expect(status).toBe(200);
    expect(seen.user).toContain(line);
    expect(seen.system).not.toContain('measured tempo 2.1:1');
    expect(seen.system).not.toContain('is on their screen');
  });
});
