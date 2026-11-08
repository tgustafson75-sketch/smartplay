import { createFrameCoalescer } from '../../services/frameCoalescer';

function fakeFrames() {
  const cbs = new Map<number, () => void>();
  let next = 1;
  return {
    scheduler: {
      request: (cb: () => void) => { const h = next++; cbs.set(h, cb); return h; },
      cancel: (h: number) => { cbs.delete(h); },
    },
    pending: () => cbs.size,
    runFrame: () => { const all = [...cbs.values()]; cbs.clear(); all.forEach((cb) => cb()); },
  };
}

type Ui = { pos: number; dur: number; playing: boolean };

describe('frameCoalescer (SMARTPLAY-CADDIE-MOBILE-8)', () => {
  it('a burst of status ticks commits ONCE, with the latest values, and never inside the tick', () => {
    const frames = fakeFrames();
    const applied: Partial<Ui>[] = [];
    const c = createFrameCoalescer<Ui>((p) => applied.push(p), frames.scheduler);
    for (let i = 0; i < 200; i++) c.queue({ pos: i / 10 });
    c.queue({ playing: true });
    c.queue({ dur: 3.2 });
    expect(applied).toHaveLength(0);          // nothing reaches React synchronously
    expect(frames.pending()).toBe(1);         // one frame, not 202
    frames.runFrame();
    expect(applied).toEqual([{ pos: 19.9, playing: true, dur: 3.2 }]);
  });

  it('a tick queued from inside the flush lands on the NEXT frame (no nesting)', () => {
    const frames = fakeFrames();
    const applied: Partial<Ui>[] = [];
    const c = createFrameCoalescer<Ui>((p) => { applied.push(p); if (applied.length < 100) c.queue({ pos: applied.length }); }, frames.scheduler);
    c.queue({ pos: 0 });
    frames.runFrame();
    expect(applied).toHaveLength(1);
    expect(frames.pending()).toBe(1);
  });

  it('cancel drops the pending patch (unmount)', () => {
    const frames = fakeFrames();
    const applied: Partial<Ui>[] = [];
    const c = createFrameCoalescer<Ui>((p) => applied.push(p), frames.scheduler);
    c.queue({ pos: 1 });
    c.cancel();
    frames.runFrame();
    expect(applied).toHaveLength(0);
  });
});
