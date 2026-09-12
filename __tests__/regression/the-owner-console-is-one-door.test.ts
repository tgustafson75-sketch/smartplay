/**
 * 2026-09-11 (Tim) — SIXTEEN ROUTE PUSHES IN A COLLAPSIBLE SECTION IS A FILING CABINET, NOT A TOOL.
 *
 * "We have multiple platforms for harnesses and issue logs and things like that. Do we need to
 *  condense this for me into one card, like that's more dashboard style, that I can go to that isn't
 *  finding what subcard I'm looking for. And then probably start to hide ones that aren't active."
 *
 * Owner Tools in settings had grown to ~410 lines: sixteen `router.push` rows plus three actions,
 * with six more debug screens that nothing linked to at all. It now holds the Field Test toggle (a
 * setting, not a tool) and ONE row into app/owner-console.tsx.
 *
 * The console is the front door to every owner surface, so it must be gated at least as tightly as
 * the tightest thing it reaches — at the ROUTE and at the RENDER, because a route is reachable by
 * voice, deep link, or typing it.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CONSOLE = code('app/owner-console.tsx');
const SETTINGS = code('app/settings.tsx');

describe('the console is gated like the surfaces it opens', () => {
  it('is in the central owner-only route gate', () => {
    expect(code('app/_layout.tsx')).toContain("'/owner-console'");
  });

  it('gates at the render too, not only at the route', () => {
    expect(CONSOLE).toContain('isOwnerEmail');
    expect(CONSOLE).toMatch(/if \(!isOwner\)/);
    expect(CONSOLE).toContain('Owner tools only.');
  });
});

describe('every tile opens something real', () => {
  /** Routes the console pushes, taken from the source rather than restated here. */
  const routes = [...CONSOLE.matchAll(/route: '([^']+)'/g)].map(m => m[1]);

  it('found the tiles (guards the scanner itself)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it('resolves each one to a screen file — no dead tiles', () => {
    const missing = routes.filter((r) => {
      if (r.startsWith('/(tabs)/')) return !fs.existsSync(path.join(ROOT, 'app', r.slice(1) + '.tsx'));
      return !fs.existsSync(path.join(ROOT, 'app', r.slice(1) + '.tsx'));
    });
    expect(missing).toEqual([]);
  });

  it('lists no route twice — a duplicate tile is a filing cabinet again', () => {
    expect(routes.length).toBe(new Set(routes).size);
  });
});

describe('what Tim asked to be removed is actually gone', () => {
  it('no location / mark-green sub-menu anywhere on the surface', () => {
    // "When I say a marker green or a location or a tee box, I'm gonna do it verbally. I'm not going
    // to a sub menu to mark fucking locations anymore." The voice path owns this now.
    expect(CONSOLE).not.toContain('/mark-green');
    expect(CONSOLE).not.toContain('/mark-tee');
    expect(SETTINGS).not.toContain("router.push('/mark-green' as never)");
  });

  it('settings no longer carries the tool list — one row, not sixteen', () => {
    const pushes = [...SETTINGS.matchAll(/router\.push\('(\/[^']+)' as never\)/g)].map(m => m[1]);
    const ownerish = pushes.filter(r =>
      /^\/(harness|gps-test|simround-auto|voice-misses|owner-|author\/|kevin-learning|native-modules-debug|subscription-debug|swing-sessions-debug|swing-analysis-debug|swinglab\/tutorials)/.test(r),
    )
      /**
       * /owner-logs is NOT an owner surface despite the name, and must keep its own row. The Issue
       * Log is the ALL-BETA-TESTER bug channel: app/_layout.tsx deliberately removed it from the
       * owner gate on 2026-07-10 because gating it bounced any non-owner tester who said "send the
       * issue log" back to the Caddie tab, so they could never file anything.
       */
      .filter(r => r !== '/owner-logs');
    // Exactly one owner destination remains in settings: the console itself.
    expect(ownerish).toEqual(['/owner-console']);
  });
});

describe('the status strip answers "does anything need me?" without opening anything', () => {
  it('reads the three live sources rather than showing static chrome', () => {
    expect(CONSOLE).toContain('useOwnerChecklistStore');
    expect(CONSOLE).toContain('useIssueLogStore');
    expect(CONSOLE).toContain('useVoiceHitRateStore');
  });

  it('says "clear"/"none" rather than a bare 0, and flags only what wants attention', () => {
    expect(CONSOLE).toMatch(/checklistOpen === 0 \? 'clear'/);
    expect(CONSOLE).toMatch(/issueCount === 0 \? 'none'/);
    expect(CONSOLE).toMatch(/warn:/);
  });

  it('shows an em-dash rather than 0% when no voice attempts have been recorded', () => {
    // total === 0 must not render as "0%", which reads as a total failure of the voice path.
    expect(CONSOLE).toMatch(/total === 0 \? null/);
  });
});
