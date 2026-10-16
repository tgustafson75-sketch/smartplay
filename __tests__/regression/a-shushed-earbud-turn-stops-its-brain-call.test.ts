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
    const calls = ls.match(/conversationalBrainTurn\(utterance, \{[^}]*\}\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c).toMatch(/signal: brainSignal/);
  });
});
