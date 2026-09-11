/**
 * 2026-09-10 — THE CADDIE'S PROMPT HELD A CLUB THE SHOT RESOLVER HAD STOPPED BELIEVING.
 *
 * `roundStore.club` is set by an explicit club declaration and cleared only at round start, round
 * end, and the next declaration — never by a hole change and never by time.
 *
 * services/shotClubResolver has always applied a 12-minute window to it when deciding what club a
 * SHOT was hit with. services/caddieRequestBody read the same field RAW. So "I'm hitting 7 iron" on
 * hole 3 was still being sent to the brain as the player's current club on hole 18 — the caddie
 * reasoning about a club from an hour ago while shot attribution correctly ignored it.
 *
 * Two owners of "is this club still current", and the looser one was the one talking to the caddie.
 */
import { useRoundStore } from '../../store/roundStore';
import { declaredClubIfFresh } from '../../services/shotClubResolver';

const FRESH_MS = 12 * 60 * 1000;

describe('the club the caddie thinks you have', () => {
  beforeEach(() => {
    useRoundStore.setState({ club: null, clubSetAt: null });
  });

  it('is the club you just named', () => {
    useRoundStore.setState({ club: '7I', clubSetAt: Date.now() });
    expect(declaredClubIfFresh()).toBe('7I');
  });

  it('is still the club a few minutes later — the window has to be usable', () => {
    useRoundStore.setState({ club: '7I', clubSetAt: Date.now() - 5 * 60 * 1000 });
    expect(declaredClubIfFresh()).toBe('7I');
  });

  it('is NOT a club named an hour ago', () => {
    useRoundStore.setState({ club: '7I', clubSetAt: Date.now() - 60 * 60 * 1000 });
    expect(declaredClubIfFresh()).toBeNull();
  });

  it('expires exactly at the shared window, not a second copy of it', () => {
    useRoundStore.setState({ club: '7I', clubSetAt: Date.now() - (FRESH_MS + 1000) });
    expect(declaredClubIfFresh()).toBeNull();
    useRoundStore.setState({ club: '7I', clubSetAt: Date.now() - (FRESH_MS - 1000) });
    expect(declaredClubIfFresh()).toBe('7I');
  });

  it('is null when nothing was declared', () => {
    expect(declaredClubIfFresh()).toBeNull();
  });

  it('is null when the timestamp is missing — never guess that it is current', () => {
    // A club with no clubSetAt cannot be dated, and an undateable value must not be treated as new.
    useRoundStore.setState({ club: '7I', clubSetAt: null });
    expect(declaredClubIfFresh()).toBeNull();
  });

  it('the payload builder uses the shared rule, not a raw read', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');
    expect(src).toContain('declaredClubIfFresh');
    // and must not go back to reading the field directly for this value
    expect(src).not.toMatch(/const club = safe\(\(\) => r\.club/);
  });

  it('the window is declared once — no second 12-minute constant', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const body = fs.readFileSync(path.join(__dirname, '../../services/caddieRequestBody.ts'), 'utf8');
    expect(body).not.toMatch(/12 \* 60 \* 1000/);
  });
});
