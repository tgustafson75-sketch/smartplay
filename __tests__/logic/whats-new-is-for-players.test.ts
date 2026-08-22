/**
 * What's New is written for the PLAYER, and it is not optional.
 *
 * 2026-08-21 (Tim): "when the players open the app, anything meaningful to them that's new —
 * obviously nontechnical — the features that have been improved… make sure that is always set to
 * auto if we do something meaningful for the user. And if there's something they need to know how to
 * use, if it's been simplified, the highlighted tutorial shows them the new method. As a default
 * every time we do something like this going forward."
 *
 * The mechanism already existed and auto-surfaces on the Play tab. What decayed was the CONTENT:
 * days of user-visible work with no entries, so a tester opening the app saw nothing and had no way
 * to know the app had improved — or, worse, that the way to do something had changed.
 *
 * These tests guard the two things that make it useful rather than a changelog: the voice, and the
 * how-to. They cannot force someone to add an entry, but they can stop a bad one landing.
 */
import { WHATS_NEW } from '../../services/knowledgeBase/whatsNew';

/** Words that mean nothing to a golfer standing on a tee. */
const ENGINEER_WORDS = /\b(refactor|endpoint|lambda|payload|shim|dispatcher|store|hook|regex|typescript|api|latency|socket|cache|prompt|token|schema|guard|null|undefined|commit|OTA)\b/i;

describe('every entry speaks to a golfer, not an engineer', () => {
  it.each(WHATS_NEW.map((e, i) => [i, e] as const))('entry %i is free of engineering language', (_i, e) => {
    expect(e.note).not.toMatch(ENGINEER_WORDS);
  });

  it.each(WHATS_NEW.map((e, i) => [i, e] as const))('entry %i says what it does FOR them, not what we built', (_i, e) => {
    // Long enough to be a benefit, short enough to read on a card between shots.
    expect(e.note.trim().length).toBeGreaterThan(40);
    expect(e.note.trim().length).toBeLessThan(400);
  });

  it('a how-to, where present, tells them what to actually DO', () => {
    const withHowTo = WHATS_NEW.filter(e => e.howTo);
    // Some release will legitimately have none; when there are any, they must be instructions.
    for (const e of withHowTo) {
      expect(e.howTo!.trim().length).toBeGreaterThan(15);
      expect(e.howTo).not.toMatch(ENGINEER_WORDS);
    }
  });

  it('the changes that MOVED something carry a how-to', () => {
    // A better answer needs no instruction. A new gesture or a removed setting does — a player who
    // cannot find the new method experiences an improvement as a regression.
    const movedSomething = WHATS_NEW.filter(e =>
      /drop-?down is gone|no longer asks|double-tap|just say it out loud/i.test(e.note + (e.howTo ?? '')));
    expect(movedSomething.length).toBeGreaterThan(0);
    for (const e of movedSomething) expect(e.howTo).toBeTruthy();
  });

  it('newest first — the card shows the top of this list', () => {
    // The hero card slices from the TOP as "unseen". Appending to the end would surface nothing.
    expect(WHATS_NEW[0].when).toMatch(/Aug 2026/);
  });
});
