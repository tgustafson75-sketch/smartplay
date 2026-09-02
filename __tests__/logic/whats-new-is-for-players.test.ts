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
    //
    // 2026-09-01 — this asserted the literal string 'Aug 2026', so it failed the moment a September
    // entry was added CORRECTLY, at the top. A test that has to be edited every month to keep
    // passing is a test that will eventually be edited without being read.
    // [[a-guard-can-enforce-a-stale-premise]]
    //
    // The property is the ORDERING, so assert the ordering: parse every `when` and prove the list
    // never gets newer as it goes down.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const stamp = (when: string): number => {
      const m = /([A-Z][a-z]{2})\w*\s+(\d{4})/.exec(when);
      expect(m).not.toBeNull();          // every entry must carry a readable month + year
      const monthIdx = MONTHS.indexOf(m![1]);
      expect(monthIdx).toBeGreaterThanOrEqual(0);
      return Number(m![2]) * 12 + monthIdx;
    };
    const stamps = WHATS_NEW.map((e) => stamp(e.when));
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i]).toBeLessThanOrEqual(stamps[i - 1]);
    }
    // ...and the top entry is genuinely the newest, which is the thing the card depends on.
    expect(stamps[0]).toBe(Math.max(...stamps));
  });
});
