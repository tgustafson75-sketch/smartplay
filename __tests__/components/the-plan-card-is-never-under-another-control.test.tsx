/**
 * 2026-09-29 (Tim's Hemet screenshots: the PLAN card half-hidden — the corner portrait/map box sat on
 * its left, the SmartFinder crosshair on its first line, and even expanded the goal line and the club
 * sequence were cut to one line). The card now leaves the crosshair's footprint on the right, is
 * lifted above the corner box by the screen (bottomOffset = budget.bubbleClearance), and when opened
 * shows everything.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import HolePlanChip from '../../components/HolePlanChip';

const PLAN = {
  playingFor: 'bogey',
  targetScore: 5,
  steps: [
    { shot: 1, club: 'Driver', why: 'the most you can take here', leavesYards: 257 },
    { shot: 2, club: '5H', why: 'instead of the 37 the 2H leaves', leavesYards: 87 },
    { shot: 3, club: 'GW', why: 'your number, not an in-between one', leavesYards: 0 },
  ],
} as never;
const BUDGET = '8 shots in hand for 10 holes — bogey them all and you still come in at 90 or better';

describe('the plan card', () => {
  it('sits where it is told and ends before the crosshair', () => {
    const r = render(<HolePlanChip plan={PLAN} budgetLine={BUDGET} bottomOffset={200} rightInset={68} />);
    const wrap = r.UNSAFE_getAllByType(View)[0];
    const style = Object.assign({}, ...[wrap.props.style].flat(3).filter(Boolean));
    expect(style.bottom).toBe(200);
    expect(style.right).toBe(68);
  });

  it('collapsed: one line each; opened: the goal line and the sequence wrap instead of being cut', () => {
    const r = render(<HolePlanChip plan={PLAN} budgetLine={BUDGET} />);
    const lines = () => r.UNSAFE_getAllByType(Text).filter((t) => t.props.numberOfLines != null).map((t) => t.props.numberOfLines);
    expect(lines()).toEqual([1, 1]);
    fireEvent.press(r.getByRole('button'));
    expect(lines().every((n: number) => n >= 3)).toBe(true);
    expect(r.getByText(/1\. Driver — the most you can take here/)).toBeTruthy();
  });

  it('reports its height so the SmartVision map can keep its live marker clear', () => {
    const onH = jest.fn();
    const r = render(<HolePlanChip plan={PLAN} budgetLine={BUDGET} onHeightChange={onH} />);
    const wrap = r.UNSAFE_getAllByType(View)[0];
    fireEvent(wrap, 'layout', { nativeEvent: { layout: { height: 61.6, width: 300, x: 0, y: 0 } } });
    expect(onH).toHaveBeenCalledWith(62);
  });

  it('THE BUG: a card that goes away reports no height, so the map above drops back down', () => {
    const onH = jest.fn();
    const r = render(<HolePlanChip plan={PLAN} budgetLine={BUDGET} onHeightChange={onH} />);
    const wrap = r.UNSAFE_getAllByType(View)[0];
    fireEvent(wrap, 'layout', { nativeEvent: { layout: { height: 62, width: 300, x: 0, y: 0 } } });
    r.rerender(<HolePlanChip plan={PLAN} budgetLine={BUDGET} onHeightChange={onH} visible={false} />);
    expect(onH).toHaveBeenLastCalledWith(0);
  });
});
