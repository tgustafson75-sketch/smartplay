/**
 * 2026-09-29 (review) — THE PERSONA-SWITCH INTRO NEVER PLAYS OVER THE PLAYER.
 *
 * setCaddiePersonality waits 500ms, then asks the brain (via proactiveLineRegistry, up to 3.5s) for
 * the new caddie's intro, and on a miss falls back to the canned PERSONA_HANDOFF_INTROS line. All of
 * it is spoken userInitiated:true — so no central gate stops it — and nothing was checked after the
 * await. Switch persona, start talking, and the intro landed on the live recording.
 *
 * Drives the real store with the composer and the voice module mocked.
 */

type VoiceMock = {
  speak: jest.Mock; playLocalFile: jest.Mock; flashCaption: jest.Mock;
  isCapturing: jest.Mock; isExternalMicActive: jest.Mock; stopSpeaking: jest.Mock;
  prewarmOfflineVoiceClips: jest.Mock;
};

function setup(composer: (clock: typeof import('../../services/userTurnClock')) => Promise<string | null>) {
  const voice: VoiceMock = {
    speak: jest.fn(async () => undefined),
    playLocalFile: jest.fn(async () => undefined),
    flashCaption: jest.fn(),
    isCapturing: jest.fn(() => false),
    isExternalMicActive: jest.fn(() => false),
    stopSpeaking: jest.fn(async () => undefined),
    prewarmOfflineVoiceClips: jest.fn(async () => undefined),
  };
  // resetModules, not isolateModules: the store requires the voice module LAZILY inside its timer,
  // after an isolateModules callback would have returned, so it must resolve in the main registry.
  jest.resetModules();
  jest.doMock('../../services/voiceService', () => voice);
  jest.doMock('../../services/offlineVoiceCache', () => ({
    PERSONA_HANDOFF_INTROS: { kevin: 'Kevin on the bag.', serena: 'Hi, Serena here. Let\'s read this together.' },
    resolveCachedOfflineClipUri: () => null,
  }));
  jest.doMock('../../services/voiceErrorLog', () => ({ logVoiceSilentFail: () => undefined }));
  jest.doMock('../../services/openerGuard', () => ({ claimOpenerSlot: () => undefined }));
  jest.doMock('../../services/fillerLibrary', () => ({ clearLibrary: async () => undefined }));
  jest.doMock('../../services/briefingGenerator', () => ({ clearBriefingCache: () => undefined }));
  jest.doMock('../../services/courseContentService', () => ({ clearCourseContentCache: async () => undefined }));
  const clock = require('../../services/userTurnClock') as typeof import('../../services/userTurnClock');
  const reg = require('../../services/proactiveLineRegistry') as typeof import('../../services/proactiveLineRegistry');
  reg.setProactiveLineComposer(() => composer(clock));
  const store = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
  return { store, clock, voice };
}

const said = (v: VoiceMock) => v.speak.mock.calls.length + v.playLocalFile.mock.calls.length + v.flashCaption.mock.calls.length;

describe('the persona-switch intro yields to a player who has started talking', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    for (const m of ['voiceService', 'offlineVoiceCache', 'voiceErrorLog', 'openerGuard', 'fillerLibrary', 'briefingGenerator', 'courseContentService']) {
      jest.dontMock(`../../services/${m}`);
    }
  });

  const switchTo = async (env: ReturnType<typeof setup>) => {
    env.store.useSettingsStore.setState({ caddiePersonality: 'kevin' } as never);
    env.store.useSettingsStore.getState().setCaddiePersonality('serena');
    await jest.advanceTimersByTimeAsync(600);
  };

  it('THE BUG: the brain misses AFTER the player started a turn → silence, not the canned line', async () => {
    const env = setup(async (clock) => { clock.noteUserTurn(); return null; });
    await switchTo(env);
    expect(said(env.voice)).toBe(0);
  });

  it('the brain answers after the player started a turn → silence', async () => {
    const env = setup(async (clock) => { clock.noteUserTurn(); return 'Serena, taking the bag.'; });
    await switchTo(env);
    expect(said(env.voice)).toBe(0);
  });

  it('a turn started during the 500ms settle, before the brain is even asked → silence', async () => {
    const env = setup(async () => null);
    env.store.useSettingsStore.setState({ caddiePersonality: 'kevin' } as never);
    env.store.useSettingsStore.getState().setCaddiePersonality('serena');
    env.clock.noteUserTurn();
    await jest.advanceTimersByTimeAsync(600);
    expect(said(env.voice)).toBe(0);
  });

  it('a mic that is live when the line comes back (VAD arming, SmartMotion) → silence', async () => {
    const env = setup(async () => null);
    env.voice.isCapturing.mockReturnValue(true);
    await switchTo(env);
    expect(said(env.voice)).toBe(0);
  });

  it('nobody is talking → the composed line is spoken', async () => {
    const env = setup(async () => 'Serena, taking the bag.');
    await switchTo(env);
    expect(env.voice.speak).toHaveBeenCalledTimes(1);
    expect(env.voice.speak.mock.calls[0][0]).toBe('Serena, taking the bag.');
  });

  it('nobody is talking and the brain misses → the canned line still plays (never silent)', async () => {
    const env = setup(async () => null);
    await switchTo(env);
    expect(env.voice.speak).toHaveBeenCalledTimes(1);
    expect(env.voice.speak.mock.calls[0][0]).toBe('Hi, Serena here. Let\'s read this together.');
  });
});
