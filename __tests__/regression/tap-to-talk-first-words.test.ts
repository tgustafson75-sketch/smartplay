/**
 * 2026-08-11 (Tim) — "two things: when I tap to talk, the first message gets cut off, and then she
 * says she can't hear me. And she ends with something like 'what's on your mind today', but doesn't
 * listen."
 *
 * Both symptoms are the same lie told twice: the app claimed to be listening when it wasn't.
 *
 * 1. THE CUT-OFF FIRST WORDS. Two independent paths flipped their state to 'listening' — which
 *    lights the halo and the LISTENING… label — BEFORE the microphone was capturing anything:
 *
 *      hooks/useVoiceCaddie (the on-screen mic tap): flipped on tap, then did the VAD release
 *      delay, the serial audio-session reconfigure, and Recording.createAsync — a few hundred ms.
 *
 *      services/listeningSession (earbud / global mic): flipped, THEN awaited the spoken verbal
 *      go-ahead cue, which the code itself awaits specifically so the cue "can't be self-recorded"
 *      — meaning the mic is provably closed for that whole second while the strip says Listening.
 *
 *    Invited to speak, he spoke, the opening words went into a dead mic, and a transcript missing
 *    its first words came back as "I didn't catch that". Hence symptom two following symptom one.
 *
 * 2. SHE ASKS AND STOPS LISTENING. A caddie question — a clarifying follow_up_question, or a brain
 *    reply that ends in one — was spoken and the session went idle. He had to tap again to answer
 *    a question he'd just been asked, which is functionally not listening. [[feels-like-a-real-caddie]]
 *
 * These assert the ORDER of operations, which is the whole fix — a test that only checked the
 * states exist would pass on the broken code.
 */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('the app never claims to be listening before the mic is live', () => {
  describe('on-screen mic tap (useVoiceCaddie)', () => {
    const src = read('hooks/useVoiceCaddie.ts');

    it("arms rather than 'listening' at the tap", () => {
      expect(src).toContain("wrappedOnVoiceStateChange('arming')");
    });

    it('only claims to listen AFTER the recording object exists', () => {
      const arming = src.indexOf("wrappedOnVoiceStateChange('arming')");
      const created = src.indexOf('recordingRef.current = recording;', arming);
      const listening = src.indexOf("wrappedOnVoiceStateChange('listening')", arming);
      expect(arming).toBeGreaterThan(-1);
      expect(created).toBeGreaterThan(arming);
      // The ordering IS the fix: listening must come after the recorder is assigned.
      expect(listening).toBeGreaterThan(created);
    });

    it('still creates the recorder and warms the mic between arming and listening', () => {
      const arming = src.indexOf("wrappedOnVoiceStateChange('arming')");
      const listening = src.indexOf("wrappedOnVoiceStateChange('listening')", arming);
      const between = src.slice(arming, listening);
      expect(between).toContain('configureAudioForRecording()');
      expect(between).toContain('Audio.Recording.createAsync');
    });
  });

  describe('earbud / global mic (listeningSession)', () => {
    const src = read('services/listeningSession.ts');
    const open = src.indexOf('async function openSession()');
    const body = src.slice(open, src.indexOf('function closeSession()', open));

    it('holds the opening state through the awaited verbal cue', () => {
      const cue = body.indexOf("playVerbalCue('listen'");
      const listening = body.indexOf("setSessionStateMirror('listening')");
      expect(cue).toBeGreaterThan(-1);
      // The cue is awaited precisely so it isn't self-recorded — so the mic is closed during it,
      // and claiming 'listening' before it is the bug.
      expect(listening).toBeGreaterThan(cue);
    });

    it('claims to listen immediately before capture starts', () => {
      const listening = body.indexOf("setSessionStateMirror('listening')");
      const capture = body.indexOf('capture_start');
      expect(capture).toBeGreaterThan(listening);
    });

    it('arms the tap-again endpoint at the same moment, not at the tap', () => {
      // listeningStartedAt gates "tap again = I'm done". Arming it a second early would let the
      // open-tap's own echo end a capture that had not begun.
      const listening = body.indexOf("setSessionStateMirror('listening')");
      const armed = body.indexOf('listeningStartedAt = Date.now()');
      expect(armed).toBeGreaterThan(listening);
      expect(armed - listening).toBeLessThan(200);
    });

    it('the cancel-during-cue guard checks the state actually held during the cue', () => {
      expect(body).toContain("if (state !== 'opening') return;");
    });
  });

  it('the tap haptic still fires at the tap, not when the mic finally opens', () => {
    const src = read('services/listeningSession.ts');
    // Holding 'opening' moved the listening transition ~1s later; without this the tap felt dead.
    expect(src).toContain("if (prev === 'idle' && (next === 'opening' || next === 'listening'))");
  });
});

describe("a caddie who asks a question waits for the answer", () => {
  const src = read('services/listeningSession.ts');

  it('reopens the mic when the caddie just asked something', () => {
    expect(src).toContain('auto_reopen_after_question');
    expect(src).toContain('endsAsQuestion(finalLine)');
  });

  it('compares against what was said BEFORE the turn, so a stale question cannot re-trigger', () => {
    expect(src).toContain('finalLine !== spokenLineAtOpen');
    expect(src).toContain('spokenLineAtOpen = getLastSpokenLine()');
  });

  it('is bounded — an unanswered question loop cannot hold the mic open forever', () => {
    expect(src).toContain('const MAX_AUTO_REOPENS = 2');
    expect(src).toContain('autoReopenChain < MAX_AUTO_REOPENS');
  });

  it('a deliberate tap resets the chain, so the cap bounds one run of questions', () => {
    const toggle = src.slice(src.indexOf('export async function toggle()'));
    const idleBranch = toggle.slice(toggle.indexOf("if (state === 'idle')"));
    expect(idleBranch.slice(0, 400)).toContain('autoReopenChain = 0;');
  });

  it('re-arms the in-flight lock so an earbud echo cannot stack a second session', () => {
    const reopen = src.slice(src.indexOf('auto_reopen_after_question'));
    expect(reopen.slice(0, 500)).toContain('sessionInFlight = true;');
  });

  it('a reopen failure cannot strand the session in a non-idle state', () => {
    const reopen = src.slice(src.indexOf('auto_reopen_after_question'));
    const tail = reopen.slice(0, 700);
    expect(tail).toContain("setSessionStateMirror('idle')");
    expect(tail).toContain('sessionInFlight = false;');
  });
});

describe('both voice paths judge "that was a question" identically', () => {
  // 2026-06-23 (Tim) — "Serena asks 'how are you feeling?' but isn't listening anymore." That was a
  // naive endsWith('?'), false for any question with trailing text. Writing a second checker for the
  // earbud path would have reintroduced it there — and "what's on your mind today? Take your time."
  // is exactly that shape. [[no-half-fixes-enforce-every-surface]]
  const { endsAsQuestion } = require('../../services/voice/endsAsQuestion');

  it.each([
    ['What\'s on your mind today?', true],
    ['What\'s on your mind today? Take your time.', true],
    ['How are you feeling today? 🙂', true],
    ['"How did that feel?"', true],
    ['Driver, and aim at the left bunker.', false],
    ['', false],
    [null, false],
  ])('%s → %s', (line, expected) => {
    expect(endsAsQuestion(line)).toBe(expected);
  });

  it('is the ONE implementation — neither path defines its own', () => {
    expect(read('services/listeningSession.ts')).toContain("from './voice/endsAsQuestion'");
    expect(read('hooks/useVoiceCaddie.ts')).toContain("from '../services/voice/endsAsQuestion'");
    // A second copy is how the 06-23 bug would come back on one surface only.
    expect(read('services/listeningSession.ts')).not.toContain('function endsWithQuestion');
  });
});

describe('the arming state is honest everywhere it surfaces', () => {
  it('never renders as LISTENING in the cockpit header', () => {
    const src = read('components/caddie/cockpit/BrandHeader.tsx');
    const arming = src.indexOf("voiceState === 'arming' ? 'ONE SEC…'");
    const listening = src.indexOf("voiceState === 'listening' ? 'LISTENING…'");
    // Order matters: the arming branch must be evaluated first or it can never be reached.
    expect(arming).toBeGreaterThan(-1);
    expect(arming).toBeLessThan(listening);
  });

  it('does not tell the user to "tap when done" before recording starts', () => {
    const src = read('components/caddie/cockpit/AskCaddieButton.tsx');
    expect(src).toContain("arming:    'One sec…'");
  });

  it('counts as busy, so a second tap cannot start a competing session', () => {
    expect(read('components/caddie/cockpit/AskCaddieButton.tsx')).toContain("voiceState === 'arming' ||");
    expect(read('components/CaddieAvatar.tsx')).toContain("busy: voiceState === 'arming' ||");
  });
});
