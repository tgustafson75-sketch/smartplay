/**
 * 2026-09-29 (Tim: "Should bottom data bar be two rows? Scoring is very hard with a small screen and
 * we could put a couple more relevant data points. Would make the primary L1 and L2 windows not as
 * tall but I think that is actually ok. SmartVision looks huge when its the primary.")
 *
 * In a round the strip grows a scoring row — SCORE and PUTTS steppers for the current hole, written
 * through the round's own logScore / logPutts seam — and the first row gains PAR. The caddie tab's
 * layout budget lifts everything above the strip by exactly that row, so the windows above get shorter
 * instead of sitting on it.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CaddieDataStrip, { STRIP_SCORING_ROW_HEIGHT, stepHoleScore, stepHolePutts } from '../../components/CaddieDataStrip';
import { caddieLayoutBudget } from '../../services/caddieLayoutBudget';

const base = {
  yardage: 150, playsLike: 154, playsLikeDelta: 4,
  hole: { current: 7, total: 18, first: 1 },
  targetDirection: 'Center', stroke: 2, visible: true, onPress: () => undefined,
};

describe('the step rules', () => {
  it('score: blank + is par, blank − is one under, then one at a time, bounded', () => {
    expect(stepHoleScore(null, 1, 4)).toBe(4);
    expect(stepHoleScore(null, -1, 5)).toBe(4);
    expect(stepHoleScore(4, 1, 4)).toBe(5);
    expect(stepHoleScore(1, -1, 3)).toBe(1);
    expect(stepHoleScore(15, 1, 4)).toBe(15);
    expect(stepHoleScore(null, 1, null)).toBe(4);
  });
  it('putts: blank + is two, blank − is one, never below 0 or above the score', () => {
    expect(stepHolePutts(null, 1, 5)).toBe(2);
    expect(stepHolePutts(null, -1, 5)).toBe(1);
    expect(stepHolePutts(0, -1, 5)).toBe(0);
    expect(stepHolePutts(3, 1, 3)).toBe(3);
  });
});

describe('THE ASK: score the hole from the bar', () => {
  it('in a round: PAR in the top row, SCORE and PUTTS steppers that write the next value', () => {
    const onScore = jest.fn();
    const onPutts = jest.fn();
    const r = render(
      <CaddieDataStrip {...base} par={4} holeScore={null} holePutts={null} onScoreStep={onScore} onPuttsStep={onPutts} />,
    );
    expect(r.getByText('PAR')).toBeTruthy();
    fireEvent.press(r.getByTestId('strip-score-plus'));
    expect(onScore).toHaveBeenLastCalledWith(4);
    fireEvent.press(r.getByTestId('strip-putts-plus'));
    expect(onPutts).toHaveBeenLastCalledWith(2);
  });

  it('an entered score steps from what is recorded', () => {
    const onScore = jest.fn();
    const r = render(<CaddieDataStrip {...base} par={4} holeScore={5} holePutts={2} onScoreStep={onScore} onPuttsStep={jest.fn()} />);
    expect(r.getByText('5')).toBeTruthy();
    fireEvent.press(r.getByTestId('strip-score-minus'));
    expect(onScore).toHaveBeenLastCalledWith(4);
  });

  it('a stepper tap does not also open the shot sheet', () => {
    const onPress = jest.fn();
    const r = render(<CaddieDataStrip {...base} onPress={onPress} par={4} onScoreStep={jest.fn()} onPuttsStep={jest.fn()} />);
    fireEvent.press(r.getByTestId('strip-score-plus'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('without the scoring handlers the strip is the one-row bar it was', () => {
    const r = render(<CaddieDataStrip {...base} />);
    expect(r.queryByTestId('strip-score-plus')).toBeNull();
    expect(r.queryByText('PAR')).toBeNull();
    expect(r.getByText('STROKE')).toBeTruthy();
  });
});

describe('nothing above the strip sits on the new row', () => {
  it('the corner box, round controls and bubble clearance rise by exactly the scoring row', () => {
    const chrome = { W: 344, H: 882, insetTop: 24, insetBottom: 16, barReserve: 90, tabBarHeight: 48 };
    const one = caddieLayoutBudget(chrome);
    const two = caddieLayoutBudget({ ...chrome, stripExtraHeight: STRIP_SCORING_ROW_HEIGHT });
    expect(two.cornerBottom - one.cornerBottom).toBe(STRIP_SCORING_ROW_HEIGHT);
    expect(two.controlsBottom - one.controlsBottom).toBe(STRIP_SCORING_ROW_HEIGHT);
    expect(two.bubbleClearance - one.bubbleClearance).toBe(STRIP_SCORING_ROW_HEIGHT);
    expect(two.ctaBottom).toBe(one.ctaBottom); // Start Round is not a round-time control
  });

  it('the corner box clears the two-row strip (strip bottom 10 + 84 + the row)', () => {
    const b = caddieLayoutBudget({ W: 390, H: 844, insetTop: 47, insetBottom: 34, barReserve: 90, tabBarHeight: 48, stripExtraHeight: STRIP_SCORING_ROW_HEIGHT });
    expect(b.cornerBottom).toBeGreaterThanOrEqual(10 + 84 + STRIP_SCORING_ROW_HEIGHT);
  });

  it('the Caddie tab passes the row height while a round is active, and wires both steppers', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    expect(src).toMatch(/stripExtraHeight: stripHasScoringRow \? STRIP_SCORING_ROW_HEIGHT : 0/);
    expect(src).toMatch(/onScoreStep=\{\(next\) => \{\s*logScore\(currentHole, next\);/);
    expect(src).toMatch(/onPuttsStep=\{\(next\) => logPutts\(currentHole, next\)\}/);
  });
});
