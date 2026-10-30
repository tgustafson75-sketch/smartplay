/**
 * 2026-10-28 (recheck VC-R3-2) — "KEVIN, TALK TO ME" MOVED ONLY THE TRUST LEVEL.
 *
 * Quiet from the badge, the corner swap, the Tools pill or Settings is applyPresence('quiet'): trust
 * L1, proactive off, localMode on, short replies. The voice intents set only the trust level, so after
 * "talk to me" the screen flipped to caddie-leads and Kevin said "Back with you." while localMode kept
 * every unasked line silent and Settings still read Quiet. "Go quiet" split it the other way. Both
 * voice intents now write the whole profile through the one applier.
 */
import { setTrustQuietHandler, setTrustCompanionHandler } from '../../services/intents/setTrustQuietHandler';
import { applyPresence, currentPresence, PRESENCE_PROFILES, type CaddiePresence } from '../../services/caddiePresence';
import { useSettingsStore } from '../../store/settingsStore';
import { useTrustLevelStore } from '../../store/trustLevelStore';

function flags() {
  const s = useSettingsStore.getState();
  return {
    trustLevel: useTrustLevelStore.getState().level,
    proactiveKevin: !!s.proactive_kevin_enabled,
    interactiveRound: !!s.interactiveRound,
    localMode: !!s.localMode,
    responseMode: String(s.responseMode),
  };
}

function expectProfile(level: CaddiePresence) {
  expect(currentPresence()).toBe(level);
  expect(flags()).toEqual(PRESENCE_PROFILES[level]);
}

const run = (h: typeof setTrustQuietHandler) =>
  h.execute({} as never, {} as never);

describe('the voice presence intents write the whole presence', () => {
  it('THE BUG: "talk to me" after Quiet restores Balanced — localMode off, proactive on', async () => {
    applyPresence('quiet');
    expectProfile('quiet');
    const r = await run(setTrustCompanionHandler);
    expect(r.success).toBe(true);
    expectProfile('balanced');
  });

  it('"go quiet" from Balanced is the full Quiet, not just the trust level', async () => {
    applyPresence('balanced');
    await run(setTrustQuietHandler);
    expectProfile('quiet');
  });

  it('"go quiet" from Talkative leaves nothing of Talkative behind', async () => {
    applyPresence('talkative');
    await run(setTrustQuietHandler);
    expectProfile('quiet');
  });
});
