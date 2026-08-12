/**
 * 2026-08-12 (Tim) — "this app is meant to replace 18Birdies, Golfshot, Arccos, TopTracer, even
 * Topgolf, and swing-trace apps… but with a caddie brain that grows and knows the game and helps
 * your mental game. The sports psychologist, the mental coach, the swing coach, the caddie —
 * everything now back to the center where we started."
 *
 * Audited SmartMotion against that standard rather than "does it run", and the swing coach had no
 * line to the mental side.
 *
 * The relationship store carries hero moments and a `firstPureShot` milestone — the caddie noticing
 * "that one was yours". Every CONSUMER was already built: the pre-round brief counts them ("N great
 * moments on record"), the dashboard surfaces them, and the clip garbage-collector deliberately
 * protects their video from cleanup. And nothing anywhere called addHeroMoment. A whole mental-game
 * surface with three consumers and no producer — while the one place in the app that can actually
 * SEE a pure strike said nothing to it.
 *
 * SmartMotion now records one, on evidence only.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const sm = read('app/swinglab/smartmotion.tsx');
const rel = read('store/relationshipStore.ts');

describe('the swing coach reaches the mental side', () => {
  it('SmartMotion records a hero moment — the producer that never existed', () => {
    expect(sm).toContain('addHeroMoment({');
  });

  it('only on EVIDENCE — a clean contact read and no fault learned', () => {
    // A hero moment handed out for a mediocre swing is the caddie flattering you, which is the
    // opposite of a coach worth trusting.
    expect(sm).toContain("if (!learnedFault && a.contact_read === 'clean') {");
  });

  it('sits alongside the fault record, so one swing feeds both sides of the brain', () => {
    const fault = sm.indexOf('recordSwingFault({ fault: learnedFault');
    const hero = sm.indexOf('addHeroMoment({');
    expect(fault).toBeGreaterThan(-1);
    expect(hero).toBeGreaterThan(fault);
    // Same try block — a failure in either must not break the analysis pass.
    expect(sm.slice(fault, hero + 800)).toContain('} catch { /* non-fatal */ }');
  });

  it('carries the clip, which the garbage collector already protects', () => {
    expect(sm).toContain('clipUri: clipUri ?? null,');
    expect(read('services/clipStorageGc.ts')).toContain('useRelationshipStore.getState().heroMoments');
  });

  it('is honest that a range swing has no hole or course', () => {
    // Inventing a hole number would put a range swing on a scorecard.
    expect(sm).toContain('hole: 0, // range/cage swing — not tied to a hole');
    expect(sm).toContain("courseName: '',");
  });
});

describe('the milestone the producer unlocks', () => {
  it('firstPureShot is stamped by the same action', () => {
    expect(rel).toContain('firstPureShot: s.firstPureShot ?? Date.now(),');
  });

  it('and it can only ever be set once', () => {
    // `?? Date.now()` — the FIRST pure strike, not the most recent.
    const idx = rel.indexOf('firstPureShot: s.firstPureShot ?? Date.now(),');
    expect(idx).toBeGreaterThan(-1);
    expect(rel).not.toContain('firstPureShot: Date.now(),');
  });

  it('the consumers were already waiting — brief and dashboard', () => {
    expect(read('api/preround.ts')).toContain('great moments on record');
    expect(read('app/(tabs)/dashboard.tsx')).toContain('heroMoments');
  });

  it('hero moments stay bounded — each carries a clip uri', () => {
    expect(rel).toContain('.slice(-100)');
  });
});
