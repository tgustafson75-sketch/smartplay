/**
 * 2026-09-12 (Tim) — "the range shot map has not reported right. User knows if they just hit 250 plus
 * and where, and could tap it, and then the caddie would update the yardage data and overall logic."
 *
 * THE RANGE IS THE OPPOSITE CASE TO THE CAGE, and the rule flips with it.
 *
 * In a cage the camera sees everything, so asking the player to tap is a design failure
 * ("prove it or ask"). On a RANGE the ball leaves the measurable volume entirely — nothing on this
 * phone can see where a 250-yard drive landed — while the player watched it land beside a marker.
 * There the player IS the sensor, and asking is not a fallback; it is the only ground truth there is.
 *
 * Until now the downrange dot was fullCarryYards(club, effort): an industry table scaled by
 * handicap. Honest, labelled "est", and not his shot. carryEstimate.ts even lists the gap in its own
 * source priority — "(future) explicit user club-distance setting — none exists yet".
 *
 * The tap now feeds clubStatsStore, so it improves every club call the caddie makes rather than
 * decorating one screen. [[close-the-loop-strategy]]
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const MAP = code('components/smartmotion/ShotMapPage.tsx');
const SM = code('app/swinglab/smartmotion.tsx');

describe('the player can report what actually happened', () => {
  it('the range field is tappable, and only when a handler is supplied', () => {
    expect(MAP).toMatch(/onReportShot \? \(/);
    expect(MAP).toMatch(/onPress=\{onFieldTap\}/);
  });

  it('the tap converts to yards from the BOTTOM of the field, where the tee is', () => {
    expect(MAP).toMatch(/\(1 - locationY \/ fieldH\) \* maxRange/);
  });

  it('never reports a non-positive distance', () => {
    expect(MAP).toMatch(/Math\.max\(1, \(1 - locationY \/ fieldH\) \* maxRange\)/);
  });

  it('bails when the field has not been measured yet', () => {
    expect(MAP).toMatch(/if \(!onReportShot \|\| fieldH <= 0\) return;/);
  });
});

describe('the field can reach further than the estimate', () => {
  it('has headroom, or a player who out-hits the model cannot tap the truth', () => {
    // A 190-yard guess must still let "I hit that 250" be reachable on the map.
    expect(MAP).toMatch(/1\.35/);
    expect(MAP).toMatch(/maxRange = Math\.round\(Math\.max\(/);
  });

  it('and grows again to contain a report that exceeded even that', () => {
    expect(MAP).toMatch(/reported\?\.yards \? reported\.yards \* 1\.1 : 0/);
  });
});

describe('the report reaches the player model, not just the screen', () => {
  it('writes to the club ladder', () => {
    expect(SM).toMatch(/recordTotal\(name, yards\)/);
  });

  it('into TOTAL, not carry — the player reports where it FINISHED', () => {
    /**
     * Same reasoning as the spoken "my 3 wood goes 230" fix earlier today: calling a finishing
     * distance "carry" overstates the number they fly a hazard with, and that is the error that
     * loses a ball.
     */
    expect(SM).not.toMatch(/recordCarry\(name, yards\)/);
  });

  it('resolves the club through the store\'s own id→name map, not a second table', () => {
    expect(SM).toMatch(/clubIdToClubName\(clubRef\.current\)/);
  });

  it('does nothing when the club is unknown rather than guessing a slot', () => {
    expect(SM).toMatch(/if \(name\) \{/);
  });

  it('a stray tap cannot poison a ladder — recordTotal gates on plausibility', () => {
    expect(code('store/clubStatsStore.ts')).toMatch(/isPlausibleForClub\(club, yards, 'total'/);
  });
});

describe('a report belongs to ONE swing', () => {
  it('clears when the selected swing or the phase changes', () => {
    expect(SM).toMatch(/useEffect\(\(\) => \{ setReportedShot\(null\); \}, \[selectedSwing, phase\]\);/);
  });
});
