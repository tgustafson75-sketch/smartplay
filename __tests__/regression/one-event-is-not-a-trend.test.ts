/**
 * 2026-09-11 — A FLAT LINE WITH A BLIP IS NOT A TREND, AND THE GRAPH HAD NO TIMELINE.
 *
 * Tim: "You can show a line that's flat-lined with no activity, and then a blip, once you do like
 * one stretch or one pre-round or one whatever." And: "the graph should have a timeline."
 *
 * Both right, and the first is an honesty problem rather than a cosmetic one. Five zero weeks and a
 * single value drawn as a CONTINUOUS LINE is a claim about a trend, and there is no trend — there is
 * one event. A reader sees a shape and reads a direction into it, which is the fabricated signal
 * this app refuses everywhere else.
 *
 * And the chart drew six weekly buckets with nothing on it saying they were weeks, or which end was
 * now. No x-axis at all.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const chart = code('components/charts/TrendChart.tsx');
const dash = code('app/(tabs)/dashboard.tsx');

describe('one event is drawn as an event, not as a trend', () => {
  it('counts the periods that ACTUALLY had activity', () => {
    // Zeroes are not data points about practice; they are weeks he did not practise.
    // 2026-09-11 — widened to (number|null)[] when the chart learned to keep a gap as a slot. It
    // must still reject BOTH a zero counted as activity and a null counted as activity.
    expect(chart).toMatch(/const activeCount = \(xs: \(number \| null\)\[\]\) =>/);
    expect(chart).toMatch(/xs\.filter\(\(v\) => v != null && Number\.isFinite\(v\) && v !== 0\)\.length/);
  });

  it('needs at least TWO active periods before it draws a line', () => {
    expect(chart).toMatch(/const overlaySparse = overlayPts\.length > 0 && activeCount\(overlaySeries\) < 2/);
  });

  it('and draws the real points instead when it is sparse', () => {
    expect(chart).toMatch(/const overlayDots = overlaySparse/);
    expect(chart).toMatch(/overlayDots\.map\(/);
  });

  it('the line is suppressed in that case, not drawn underneath', () => {
    // Drawing both would put the misleading shape back on the chart.
    expect(chart).toMatch(/\{overlayPath && !overlaySparse \?/);
  });

  it('only the ACTIVE points get dots — a zero week is not an event', () => {
    // 2026-09-11 — now indexed against the SLOTS rather than the compacted points, because with a
    // gap present the compacted index no longer identifies a week. The zero test must survive.
    expect(chart).toMatch(/overlaySlots\s*\n?\s*\.map\(\(p, i\) => \(p && overlaySeries\[i\] != null && overlaySeries\[i\] !== 0 \? p : null\)\)/);
    // and it must NOT go back to indexing the compacted array
    expect(chart).not.toMatch(/overlayPts\.filter\(\(_, i\) => /);
  });
});

describe('and the graph says what period it covers', () => {
  it('the chart can render a timeline', () => {
    expect(chart).toMatch(/xLabels\?: \[string, string\]/);
    expect(chart).toMatch(/xLabels\[0\]/);
    expect(chart).toMatch(/xLabels\[1\]/);
  });

  it('with room made for it, so it does not overlap the plot', () => {
    expect(chart).toMatch(/const PAD_BOT = xLabels \? 13 : 4/);
  });

  it('the newest end is right-anchored so it cannot run off the edge', () => {
    expect(chart).toMatch(/textAnchor="end"/);
  });

  it('the dashboard derives it from the series it is actually plotting', () => {
    // Hardcoding "6 weeks" would drift the moment the bucket count changed.
    expect(dash).toMatch(/activeProgress\.score\.length - 1/);
    expect(dash).toMatch(/dashboard\.text\.weeks_ago/);
    expect(dash).toMatch(/dashboard\.text\.this_week/);
  });

  it('and it is translated, with a real plural', () => {
    const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));
    expect(en.dashboard.text.weeks_ago_one).toMatch(/\{\{count\}\} wk ago/);
    expect(en.dashboard.text.weeks_ago_other).toMatch(/\{\{count\}\} wks ago/);
    expect(en.dashboard.text.this_week).toBeTruthy();
  });
});
