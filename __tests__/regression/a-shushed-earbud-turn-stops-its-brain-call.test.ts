/**
 * 2026-10-16 (earbud review gap) — closing the session aborted turnAbort, but conversationalBrainTurn
 * took no signal, so the conversational and route_to_brain calls ran to completion after a shush and
 * were billed; their answer was only dropped or captioned. The signal now reaches askCaddie.
 */
const mockAsk = jest.fn(async (_o: { signal?: AbortSignal }) => null);
jest.mock('../../services/caddieBrain', () => ({ askCaddie: (o: { signal?: AbortSignal }) => mockAsk(o) }));
jest.mock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true }));

import * as fs from 'fs';
import * as path from 'path';
import { conversationalBrainTurn } from '../../services/conversationalBrain';

describe('the earbud brain call is cancellable', () => {
  it('THE BUG: conversationalBrainTurn hands its signal to askCaddie', async () => {
    const ctrl = new AbortController();
    await conversationalBrainTurn('what club here', { signal: ctrl.signal });
    expect(mockAsk.mock.calls[0][0].signal).toBe(ctrl.signal);
  });

  it('every earbud brain call passes the turn signal', () => {
    const ls = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
    // 2026-10-28 (Brain review B10) — the earbud's brain calls go through brainTurnWithPreStep (the
    // shared help / song / sing / plain-speak step), which must hand its opts — the signal — on.
    const calls = ls.match(/(?:conversationalBrainTurn|brainTurnWithPreStep)\(utterance, \{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c).toMatch(/signal: brainSignal/);
    const wrapper = ls.slice(ls.indexOf('async function brainTurnWithPreStep('));
    expect(wrapper.slice(0, wrapper.indexOf('\n}\n'))).toMatch(/conversationalBrainTurn\(shapeForBrain\(utterance\), opts\)/);
  });
});
