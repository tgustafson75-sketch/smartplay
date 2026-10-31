/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-3) — A COMMAND THE BRAIN CANNOT CARRY IS NOT SENT AS AN ANSWER.
 *
 * On an answering turn ("the caddie just asked a question") the router was skipped and the utterance went to the
 * brain as prose. "I had three putts", "undo that" and "end the round" are writes the brain has no tool for, so
 * the brain could say "got it" and nothing reached the card. The bypass stays for conversational answers, and a
 * brain-blind command now reaches the router on both mic paths.
 *
 * BEHAVIOURAL for the predicate (real precheck); the two answering gates are checked for wiring.
 */
import fs from 'fs';
import path from 'path';
import { isBrainBlindCommand } from '../../services/brainBlindCommand';

const root = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a write the brain cannot make is recognised on an answering turn', () => {
  it.each(['I had three putts', 'took 2 putts on that one', 'undo that', 'scratch that', 'end the round', 'wrap up my round'])(
    '"%s" is a brain-blind command',
    (said) => {
      expect(isBrainBlindCommand(said)).toBe(true);
    },
  );

  it.each(['send it home', 'lay up or send it home', 'I think I should lay up', 'what should I hit here', 'the water is on the right'])(
    '"%s" is an answer and keeps the bypass',
    (said) => {
      expect(isBrainBlindCommand(said)).toBe(false);
    },
  );
});

describe('both mic paths let a brain-blind command past the answering bypass', () => {
  it('the caddie-tab / avatar router skip excludes it', () => {
    const src = code(read('hooks/useVoiceCaddie.ts'));
    expect(src).toMatch(/const skipIntentRouter = answeringCaddie[^;]*!isBrainBlindCommand\(transcript\)/);
  });

  it('the hands-free and typed answering gates exclude it', () => {
    const src = code(read('services/listeningSession.ts'));
    expect(src).toMatch(/isAwaitingFollowUp\(\) && !carriesYardageCorrection\(utterance\) && !isBrainBlindCommand\(utterance\)/);
    expect(src).toMatch(/isAwaitingFollowUp\(\) && !carriesYardageCorrection\(text\) && !isBrainBlindCommand\(text\)/);
  });
});
