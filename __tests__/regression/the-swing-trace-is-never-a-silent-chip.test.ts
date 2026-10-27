/**
 * 2026-10-27 (Phase SB4x — review of the CLUB_ARC_VERSION 2 change, "overlay" findings 2 and 4).
 *
 * 1. SWING TRACE ON AN OLD SWING WAS SILENT. The version bump hides every older arc, so on an old swing the
 *    lit Swing Trace chip drew nothing for the whole body read + tracker run, and nothing at all when the
 *    tracker answered honestly empty — on both review screens. Now the screen says what it is doing
 *    ("Tracing the clubhead…") and, when nothing could be seen, says so with Re-analyze
 *    (overlayVisibility.swingTraceNote).
 * 2. GRAB FRAME CLAIMED AN OVERLAY IT DID NOT BAKE. The toast keyed on the raw toggles; the still bakes only
 *    the layers on screen (and may fail to bake at all). The toast now says what the photo holds
 *    (grabFrameStill).
 */
import { swingTraceNote } from '../../services/swing/overlayVisibility';
import { grabFrameStill } from '../../services/swing/grabFrameStill';

describe('the Swing Trace chip always has an answer on screen', () => {
  it('THE REPORT: trace on, no arc yet, the run out — "tracing"', () => {
    expect(swingTraceNote({ wanted: true, drawn: false, hasArc: false, hasBody: true, pending: true })).toBe('tracing');
  });

  it('THE REPORT: trace on, the run settled with no arc — the clubhead could not be seen (with Re-analyze)', () => {
    expect(swingTraceNote({ wanted: true, drawn: false, hasArc: false, hasBody: true, pending: false })).toBe('no_clubhead');
  });

  it('an arc that cannot be drawn for want of a body read says so', () => {
    expect(swingTraceNote({ wanted: true, drawn: false, hasArc: true, hasBody: false, pending: false })).toBe('no_body');
  });

  it('no body read: the reason is the body (the arc is found from it), never "no clubhead"', () => {
    expect(swingTraceNote({ wanted: true, drawn: false, hasArc: false, hasBody: false, pending: false })).toBe('no_body');
  });

  it('drawn, or not asked for: no note', () => {
    expect(swingTraceNote({ wanted: true, drawn: true, hasArc: true, hasBody: false, pending: true })).toBeNull();
    expect(swingTraceNote({ wanted: false, drawn: false, hasArc: false, hasBody: true, pending: true })).toBeNull();
  });
});

describe('Grab Frame says what the photo holds', () => {
  const thumb = jest.fn(async () => 'file:///thumb.jpg');
  beforeEach(() => thumb.mockClear());

  it('THE REPORT: Trace on with no drawable arc and Body off — the plain frame, and the toast says so', async () => {
    const capture = jest.fn(async () => 'file:///baked.png');
    const r = await grabFrameStill({ hasPose: true, layers: { skeleton: false, trace: false }, capture, thumbnail: thumb });
    expect(capture).not.toHaveBeenCalled();
    expect(r).toEqual({ uri: 'file:///thumb.jpg', baked: false });
  });

  it('a bake that fails falls back to the plain frame, not an overlay claim', async () => {
    const r = await grabFrameStill({ hasPose: true, layers: { skeleton: true, trace: false }, capture: async () => null, thumbnail: thumb });
    expect(r).toEqual({ uri: 'file:///thumb.jpg', baked: false });
  });

  it('a baked overlay is the overlay, with exactly the layers on screen', async () => {
    const capture = jest.fn(async () => 'file:///baked.png');
    const r = await grabFrameStill({ hasPose: true, layers: { skeleton: false, trace: true }, capture, thumbnail: thumb });
    expect(capture).toHaveBeenCalledWith({ showSkeleton: false, showTrace: true });
    expect(r).toEqual({ uri: 'file:///baked.png', baked: true });
    expect(thumb).not.toHaveBeenCalled();
  });

  it('no body read: never an overlay', async () => {
    const capture = jest.fn(async () => 'file:///baked.png');
    const r = await grabFrameStill({ hasPose: false, layers: { skeleton: true, trace: true }, capture, thumbnail: thumb });
    expect(capture).not.toHaveBeenCalled();
    expect(r.baked).toBe(false);
  });
});

describe('both review screens render the trace note and Grab Frame\'s honest toast', () => {
  // Source check, secondary to the behaviour above (neither screen has a render harness).
  const read = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', '..', p), 'utf8') as string;
  const en = require('../../i18n/locales/en.json') as { swinglab_swing: { swing_detail: Record<string, string> } };
  it('the strings exist', () => {
    expect(en.swinglab_swing.swing_detail.tracing_clubhead).toBe('Tracing the clubhead…');
    expect(en.swinglab_swing.swing_detail.no_clubhead_seen).toMatch(/clubhead could not be seen/);
  });
  it('library and SmartMotion each compute the note from their own drawn arc and render it', () => {
    const lib = read('app/swinglab/swing/[swing_id].tsx');
    expect(lib).toMatch(/swingTraceNote\(\{\s*wanted: showTrace, drawn: hasPose && layers\.trace,/);
    expect(lib).toMatch(/t\('swinglab_swing\.swing_detail\.tracing_clubhead'\)/);
    expect(lib).toMatch(/t\('swinglab_swing\.swing_detail\.no_clubhead_seen'\)/);
    const sm = read('app/swinglab/smartmotion.tsx');
    expect(sm).toMatch(/swingTraceNote\(\{\s*wanted: showTrace && shotConfirmed, drawn: reviewLayers\.trace,/);
    expect(sm).toMatch(/t\('swinglab_swing\.swing_detail\.tracing_clubhead'\)/);
    expect(sm).toMatch(/t\('swinglab_swing\.swing_detail\.no_clubhead_seen'\)/);
  });
  it('the library toast keys on what was baked', () => {
    const lib = read('app/swinglab/swing/[swing_id].tsx');
    expect(lib).toMatch(/show\(still\.baked \? 'Frame \+ overlay saved to your Photos' : 'Frame saved to your Photos'\)/);
    expect(lib).not.toMatch(/overlayOn && outUri/);
  });
});
