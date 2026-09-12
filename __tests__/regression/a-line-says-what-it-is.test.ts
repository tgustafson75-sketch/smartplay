/**
 * 2026-09-11 — YOU SHOULD NOT HAVE TO DECODE A LEGEND TO READ A GRAPH.
 *
 * Tim: "Make sure the lines on the graph have a clear label on each one, because it really still
 * isn't labeled in the way that you can read it. Part of this is an answer to having trialled Arccos
 * — they have a bunch of good graphs that I can't figure out how things intertwine. I want ONE."
 *
 * There WAS a legend: a coloured dot and a small label at the top. It asks the reader to hold a
 * colour in their head, look down, and find the matching line — on a two-line chart four inches
 * wide, on a phone, in sunlight. And the overlay is normalised into the primary's space so its
 * SHAPE is comparable and its VALUES were nowhere on the chart at all. Two shapes, neither readable.
 *
 * A line now says what it is where it ends, with its latest value in its own unit. That is what
 * makes one chart better than Arccos's several: you can read both against each other without a
 * lookup, which is the entire reason to put them on one chart.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const chart = code('components/charts/TrendChart.tsx');
const dash = code('app/(tabs)/dashboard.tsx');

describe('each line is labelled on itself', () => {
  it('the chart can draw text at all — it could not before', () => {
    expect(chart).toMatch(/Text as SvgText/);
    expect(chart).toMatch(/<SvgText/);
  });

  it('the tag carries the metric NAME and its current VALUE', () => {
    expect(chart).toMatch(/\$\{name\.toUpperCase\(\)\} \$\{fmt\(value\)\}/);
  });

  it('and its own UNIT, so two different units can share one chart', () => {
    expect(chart).toMatch(/\$\{unit \? ' ' \+ unit : ''\}/);
    expect(chart).toMatch(/endUnit\?: string/);
    expect(chart).toMatch(/unit\?: string/);
  });

  it('in the line\'s own colour, so the tie is visual not remembered', () => {
    expect(chart).toMatch(/fill=\{t\.color\}/);
    // 2026-09-11 — the primary tag reads the last value SEEN (`present`), not the last SLOT, so a
    // trailing week with no round cannot tag the line with a null. Still the primary's own series.
    expect(chart).toMatch(/push\('primary', endLabel, present\[present\.length - 1\], endUnit, last, trendColor\)/);
    expect(chart).toMatch(/push\('overlay', overlay\.label, oVal, overlay\.unit, pt, overlay\.color\)/);
  });

  it('the overlay tag reads the RAW overlay value, not the normalised one', () => {
    // The overlay is normalised into the primary's space to make the shapes comparable. Labelling it
    // with that normalised number would print a meaningless figure.
    // 2026-09-11 — still taken from overlaySeries (the RAW values), now skipping a trailing gap.
    // What it must never do is read a y coordinate out of overlayPts, which is the normalised space.
    expect(chart).toMatch(/const oPresent = overlaySeries\.filter\(\(v\): v is number => v != null\)/);
    expect(chart).toMatch(/const oVal = oPresent\[oPresent\.length - 1\]/);
    expect(chart).not.toMatch(/const oVal = overlayPts/);
  });
});

describe('and the tags stay readable', () => {
  it('cannot be clipped off the right edge', () => {
    expect(chart).toMatch(/Math\.min\(pt\.x \+ 6, width - w - 2\)/);
  });

  it('cannot be pushed off the top or bottom', () => {
    expect(chart).toMatch(/Math\.max\(PAD_TOP \+ 9, Math\.min\(pt\.y, height - 4\)\)/);
  });

  it('the two tags separate when the lines finish on top of each other', () => {
    expect(chart).toMatch(/const clash = out\.length > 0 && Math\.abs\(oLast\.y - out\[0\]\.y\) < 14/);
  });

  it('sits on a chip, because a line can run underneath it', () => {
    expect(chart).toMatch(/<Rect/);
    expect(chart).toMatch(/fillOpacity=\{0\.82\}/);
  });

  it('rounds a big number and keeps a decimal on a small one', () => {
    expect(chart).toMatch(/Math\.abs\(v\) >= 100 \|\| v % 1 === 0 \? String\(Math\.round\(v\)\) : v\.toFixed\(1\)/);
  });
});

describe('the dashboard feeds it real names, not invented ones', () => {
  it('takes the identity from the label that already existed', () => {
    expect(dash).toMatch(/endLabel=\{activeProgress\.scoreLabel\.split\(' '\)\[0\]\}/);
    expect(dash).toMatch(/label: activeProgress\.effortLabel\.split\(' '\)\[0\]/);
  });

  it('and the units that already existed', () => {
    expect(dash).toMatch(/endUnit=\{activeProgress\.scoreDeltaUnit\}/);
    expect(dash).toMatch(/unit: activeProgress\.deltaUnit \|\| undefined/);
  });

  it('the legend is still there — the tags add to it, they do not replace it', () => {
    // A reader who prefers the legend keeps it; the tags are for the one who does not.
    expect(chart).toMatch(/legendDot/);
    expect(dash).toMatch(/legendDotColor="#a3e635"/);
  });
});
