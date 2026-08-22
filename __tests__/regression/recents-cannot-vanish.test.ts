/**
 * 2026-08-12 (Tim, about to leave for a nine-hole league) — "Where the hell did Wachusett go?????
 * It's not even on my list anymore. I am leaving soon to go play there."
 *
 * The Play tab rehydrated recent courses by calling getCourse(id) for EVERY id at mount, and
 * silently dropped any whose lookup failed:
 *
 *     const c = await getCourse(id);
 *     if (c) { out.push(...) }          // ← no else. Failure = the course ceases to exist.
 *
 * That effect runs at MOUNT — the busiest moment for the network, and exactly when today's warmup
 * connection-starvation bug was choking these very calls. So one blip erased a course he was an
 * hour from playing, while its id sat untouched in recentCourseIds. The data was never lost; the
 * app just stopped being able to NAME it, and drew a list without it.
 *
 * A course you played does not stop existing because a fetch timed out.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const play = read('app/(tabs)/play.tsx');
const store = read('store/roundStore.ts');

describe('a recent course survives a failed lookup', () => {
  it('the silent-drop is gone — there is an else', () => {
    const i = play.indexOf('const c = await getCourse(id);');
    expect(i).toBeGreaterThan(-1);
    const block = play.slice(i, i + 1800);
    expect(block).toContain('} else {');
    expect(block).toContain('const cached = recentCourseMeta[id];');
  });

  it('falls back to the cached name, so it stays listed AND selectable', () => {
    const i = play.indexOf('const cached = recentCourseMeta[id];');
    const block = play.slice(i, i + 400);
    expect(block).toContain('out.push({ id, club_name: cached.club_name');
  });

  it('caches the name on every successful lookup', () => {
    expect(play).toContain('rememberRecentCourseMeta(c.id, { club_name: c.club_name, location });');
  });

  it('the cache is persisted — a cold start must not need the network to draw the list', () => {
    expect(store).toContain('recentCourseMeta: Record<string, { club_name: string; location: string }>;');
    expect(store).toContain('recentCourseMeta: s.recentCourseMeta,'); // in partialize
    expect(store).toContain('recentCourseMeta: {},');                 // initial state
  });

  it('the cache cannot grow without bound', () => {
    // Only ever the handful of ids kept as recents, and no write when nothing changed.
    const i = store.indexOf('rememberRecentCourseMeta: (id, meta) =>');
    const block = store.slice(i, i + 600);
    expect(block).toContain('if (prev && prev.club_name === meta.club_name && prev.location === meta.location) return;');
  });

  it('recents honour Preferred Tee like every other surface', () => {
    // Otherwise the recents row quotes a different tee set than the course screen it opens.
    // 2026-08-21 — property, not literal: recents must honour the preferred tee. The picker gaining
    // a gender argument is not a regression in that, but pinning the exact call text made it read
    // as one.
    expect(play).toMatch(/const tee = pickTeeSet\(c\.tees,\s*preferredTee/);
    expect(play).not.toContain('const tee = c.tees[0];');
  });

  it('re-renders when the cache or tee preference changes', () => {
    expect(play).toContain('}, [recentCourseIds, recentCourseMeta, preferredTee]);');
  });
});
