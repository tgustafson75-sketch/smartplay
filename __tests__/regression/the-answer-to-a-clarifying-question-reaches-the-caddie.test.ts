/**
 * 2026-10-27 (Brain review B12) — THE ANSWER TO A CLARIFYING QUESTION REACHES THE CADDIE.
 *
 * On the avatar/tab mic (hooks/useVoiceCaddie), when the router asked a clarifying question
 * ("Want me to open that? Just say it again") and the player's answer was not a command, the turn fell
 * through to the brain with brainTranscript = the ORIGINAL words. The answer was never recorded as a
 * turn and never sent, so Kevin answered the question the player had already corrected:
 *   "watch my swing" → "Want me to open that?" → "no, I mean how did my last one look"
 *   → the brain was asked only "watch my swing".
 *
 * BEHAVIOURAL: the real answerToClarification against the real conversation buffer — the answer is
 * the player's latest turn, and the caddie is asked both halves. WIRING: the hook cannot be mounted
 * here (3,000 lines, ~50 native deps), so the one structural check is that the hook's clarification
 * branch feeds the helper's result into the text handed to processTranscriptOverride.
 */
import * as fs from 'fs';
import * as path from 'path';
import { answerToClarification } from '../../services/voice/clarifiedTurn';
import { getRecentTurns, clearConversation, recordUserTurn, recordKevinTurn } from '../../services/conversationState';

beforeEach(() => clearConversation('test'));

describe('the clarification is part of the turn', () => {
  it('the caddie is asked the original words AND the answer', () => {
    expect(answerToClarification('watch my swing', '  no, I mean how did my last one look ')).toBe(
      'watch my swing — no, I mean how did my last one look',
    );
  });

  it('the answer is recorded as the player\'s latest turn, after the clarifying question', () => {
    recordUserTurn('watch my swing');
    recordKevinTurn('Want me to open that? Just say it again.');
    answerToClarification('watch my swing', 'no, I mean how did my last one look');
    const turns = getRecentTurns();
    const last = turns[turns.length - 1];
    expect([last?.role, last?.text]).toEqual(['user', 'no, I mean how did my last one look']);
  });

  it('nothing said → null, and nothing recorded', () => {
    expect(answerToClarification('watch my swing', '   ')).toBeNull();
    expect(answerToClarification('watch my swing', null)).toBeNull();
    expect(getRecentTurns()).toHaveLength(0);
  });
});

describe('the hook hands the clarified text to the brain', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the clarification branch sets the brain text from answerToClarification', () => {
    const at = src.indexOf('captureUtterance(8000');
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, at + 600);
    const m = branch.match(/const\s+(\w+)\s*=\s*answerToClarification\(\s*transcript\s*,\s*clarification\s*\)/);
    expect(m).not.toBeNull();
    const assigned = branch.match(new RegExp(`(\\w+)\\s*=\\s*${m![1]}\\s*;`));
    expect(assigned).not.toBeNull();
    // …and that variable is what the brain is asked.
    expect(src).toMatch(new RegExp(`const\\s+brainTranscript\\s*=\\s*shapeForBrain\\(\\s*${assigned![1]}\\s*\\)`));
    expect(src).toMatch(/processTranscriptOverride\(\s*brainTranscript\s*\)/);
  });
});
