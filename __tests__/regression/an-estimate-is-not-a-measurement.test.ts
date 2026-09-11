/**
 * 2026-09-10 (Tim, Hemet) — THE CADDIE WAS TOLD TO STATE AN ESTIMATE FLATLY.
 *
 * `yardageInsight.source === 'gps_live'` is TWO different claims:
 *   - a real distance from the player to a KNOWN green, and
 *   - `estimatedFromTee` — the hole's card length minus the straight-line distance walked from the
 *     tee, used when the hole has no green coordinate at all, which is every hole of every
 *     golfcourseapi course until geometry builds.
 *
 * api/kevin rendered both as "Measured live off GPS — you can state it flatly", and its only hedge
 * fires on confidence 'low' while an estimate carries 'med'. So the estimate was the single case
 * that received full confidence and no caveat — for eighteen holes.
 *
 * The resolver has always carried `is_fallback` and a `reason` that says so in plain words. Neither
 * reached the renderer: it read only `source` and `confidence`.
 */
import fs from 'fs';
import path from 'path';
import { buildYardageInsight } from '../../services/yardageResolver';

const kevinSrc = fs.readFileSync(path.join(__dirname, '../../api/kevin.ts'), 'utf8');

describe('an estimate is not a measurement', () => {
  it('the insight blob carries the fallback flag, not just prose', () => {
    const yi = buildYardageInsight();
    expect(yi).toHaveProperty('is_fallback');
    expect(typeof yi.is_fallback).toBe('boolean');
  });

  it('the insight still carries its reason string', () => {
    // The flag says THAT it is an estimate; the reason says why, and the caddie now speaks it.
    expect(buildYardageInsight()).toHaveProperty('reason');
  });

  it('the prompt splits gps_live on the fallback flag', () => {
    expect(kevinSrc).toMatch(/yi\.source === 'gps_live' && estimated/);
    expect(kevinSrc).toMatch(/const estimated = yi\.is_fallback === true/);
  });

  /** The estimate branch alone — cut at the next arm of the ternary, or a 700-char window will
   *  run into the plain gps_live arm, which says "state it flatly" for a real measurement. */
  const estimateBranch = (() => {
    const at = kevinSrc.indexOf("yi.source === 'gps_live' && estimated");
    if (at < 0) return '';
    const rest = kevinSrc.slice(at);
    const next = rest.indexOf("\n    : yi.source === 'gps_live' ?");
    return next > 0 ? rest.slice(0, next) : rest.slice(0, 700);
  })();

  it('the branch window actually isolates the estimate arm', () => {
    // A window that matched nothing would make every assertion below vacuously pass.
    expect(estimateBranch.length).toBeGreaterThan(100);
    expect(estimateBranch).toContain('estimated');
  });

  it('an estimate is never described as measured', () => {
    expect(estimateBranch).toMatch(/ESTIMATE, not a measurement/);
    expect(estimateBranch).not.toMatch(/state it flatly/);
  });

  it('the measured branch still states it flatly — the fix must not hedge a real number', () => {
    // Over-hedging is its own defect: a blank or a mumble is not more honest than a good number.
    expect(kevinSrc).toMatch(/yi\.source === 'gps_live' \? ' Measured live off GPS — you can state it flatly\.'/);
  });

  it('the estimate branch is ordered BEFORE the plain gps_live branch', () => {
    // A ternary chain checks in order; if plain gps_live came first the estimate could never match.
    const estimateAt = kevinSrc.indexOf("yi.source === 'gps_live' && estimated");
    const plainAt = kevinSrc.indexOf("yi.source === 'gps_live' ? ' Measured live off GPS");
    expect(estimateAt).toBeGreaterThan(-1);
    expect(plainAt).toBeGreaterThan(-1);
    expect(estimateAt).toBeLessThan(plainAt);
  });

  it('never interpolates a null yardage into text the caddie reads as fact', () => {
    // currentYardage defaults to null, and the resolver genuinely returns value:null on a hole with
    // neither green geometry nor a usable card — so this template could render "null yards" two
    // sentences before the provenance line said "NO RELIABLE NUMBER right now".
    expect(kevinSrc).toMatch(/const haveNumber = typeof currentYardage === 'number'/);
    expect(kevinSrc).toMatch(/DISTANCE REMAINING RIGHT NOW: not established/);
    /**
     * 2026-09-11 — asserts the PROPERTY, not the ternary it happened to be written as.
     *
     * This pinned the exact expression `haveNumber ? \`DISTANCE...${currentYardage}\``. When the block
     * grew a second guarded branch (the card-after-a-shot fix) the shape changed, the property did
     * not, and the guard failed on correct code — a guard enforcing a stale premise.
     *
     * What it must still reject: ANY interpolation of currentYardage that is not behind haveNumber.
     * So every occurrence is checked for itself. [[a-guard-can-assert-the-broken-shape]]
     */
    const at = kevinSrc.indexOf('const haveNumber = typeof currentYardage');
    const block = kevinSrc.slice(at, at + 6000).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const spots = [...block.matchAll(/\$\{currentYardage\}/g)].map((m) => m.index ?? 0);
    expect(spots.length).toBeGreaterThan(0);
    for (const i of spots) {
      // the guard must appear between the declaration and this interpolation
      expect(block.slice(0, i)).toMatch(/haveNumber/);
    }
  });

  it('still gives a club rather than going dark on an estimate', () => {
    // Tim's standing rule: honesty is confidence + range, never a blank.
    expect(estimateBranch).toMatch(/Give the club you would give/);
  });
});
