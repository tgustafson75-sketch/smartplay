/**
 * 2026-09-13 (Tim, reviewing the dashboard) — RECENT SHOTS DREW A HEADING AND NOTHING UNDER IT.
 *
 * Two owners of "your recent shots", disagreeing, and the disagreement rendered as a blank section.
 *
 *   - The Dashboard's GATE knew the right answer: the active round's shots when a round is live, else
 *     the last round you finished. With rounds logged it is non-empty, so it correctly decided the
 *     section was NOT empty and skipped `dashboard.text.no_shots_logged_yet_log`.
 *   - `ShotTimeline` then read `useRoundStore(s => s.shots)` — the ACTIVE round — for itself, found
 *     nothing off the course, and returned null on `rows.length === 0`.
 *
 * So with "No round in progress" the heading rendered, the empty state was suppressed as wrong, and
 * the component drew nothing. The screen promised a thing it had already decided not to draw.
 *
 * The fix is not a third source. The gate builds the POOL and passes it; the component caps and
 * reverses it. One place decides WHICH shots, one decides how they look, and the live-round default
 * stays for the Caddie tab and the shot log where "the round you are playing" is what the player
 * means. [[two-owners-is-the-root-cause]]
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const dash = code('app/(tabs)/dashboard.tsx');
const timeline = code('components/caddie/ShotTimeline.tsx');

describe('the section that decides it has shots is the section that draws them', () => {
  it('ONE expression answers both "is it empty" and "what goes in it"', () => {
    /**
     * The property, not the spelling: whatever the empty-state gate tests must be the same thing
     * handed to the renderer. A second source for either half is how this broke.
     */
    const gate = dash.match(/\{(\w+)\.length === 0 \?\s*\(\s*<Text[\s\S]{0,200}no_shots_logged_yet_log/);
    expect(gate).not.toBeNull();
    const pool = gate![1];
    expect(dash).toMatch(new RegExp(`<ShotTimeline maxRows=\\{5\\} shots=\\{${pool}\\} */?>`));
  });

  it('the pool falls back to the last completed round, so it is not the live round twice', () => {
    expect(dash).toMatch(/const recentShotPool = useMemo\(\(\) => \{[\s\S]{0,300}realRounds\[realRounds\.length - 1\]/);
  });

  it('the dashboard no longer pre-reverses — the renderer owns the order', () => {
    // It used to `.slice(-5).reverse()` and hand a 5-long reversed array to a component that slices
    // and reverses again. Whichever way that resolved, two owners of the ordering is one too many.
    expect(dash).not.toMatch(/const recentShots = useMemo[\s\S]{0,200}\.reverse\(\)/);
  });
});

describe('ShotTimeline draws what it is given, and the live round when it is given nothing', () => {
  it('the source is a prop with the live round as its default', () => {
    expect(timeline).toMatch(/shots\?: readonly ShotResult\[\];/);
    expect(timeline).toMatch(/const shots = shotsProp \?\? liveShots;/);
    expect(timeline).toMatch(/const liveShots = useRoundStore\(s => s\.shots\);/);
  });

  it('the rows are derived from that one binding, not from the store again', () => {
    // A second `useRoundStore(s => s.shots)` inside the row derivation would restore the bug while
    // leaving the prop in place, which is exactly the shape a careless revert takes.
    const rowsBlock = timeline.match(/const rows = useMemo\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/)![0];
    expect(rowsBlock).toMatch(/holeOnly \? shots\.filter/);
    expect(rowsBlock).not.toMatch(/useRoundStore/);
  });

  it('the callers that mean the LIVE round still get it without passing anything', () => {
    // app/shot-log.tsx is the whole-round view; the Caddie tab is in-round. Neither should have to
    // restate "the round I am playing".
    expect(code('app/shot-log.tsx')).toMatch(/<ShotTimeline maxRows=\{100\}(?![^>]*shots=)/);
  });
});
