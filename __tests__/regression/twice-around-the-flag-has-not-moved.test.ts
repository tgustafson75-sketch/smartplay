/**
 * 2026-10-13 (course audit #8) — twice around, hole 12 is hole 3's green: a pin said on 3 must hold on 12.
 */
import { pinForHole } from '../../services/pinPosition';
import { useRoundStore } from '../../store/roundStore';

const back = { depth: 'back', side: 'center' } as never;
const front = { depth: 'front', side: 'center' } as never;

describe('twice around, the flag has not moved', () => {
  it('a pin said on hole 3 applies on hole 12 when the nine is played twice', () => {
    useRoundStore.setState({ twiceAround: true } as never);
    const r = pinForHole({ pinByHole: { 3: back }, pinDeclared: true, pinPosition: front }, 12);
    expect(r).toEqual({ pin: back, scope: 'hole' });
  });
  it('a pin said on hole 12 itself wins', () => {
    useRoundStore.setState({ twiceAround: true } as never);
    expect(pinForHole({ pinByHole: { 3: back, 12: front }, pinDeclared: false, pinPosition: front }, 12)?.pin).toBe(front);
  });
  it('a real 18: hole 12 is its own green, the round pin applies', () => {
    useRoundStore.setState({ twiceAround: false } as never);
    expect(pinForHole({ pinByHole: { 3: back }, pinDeclared: true, pinPosition: front }, 12)).toEqual({ pin: front, scope: 'round' });
  });
});
