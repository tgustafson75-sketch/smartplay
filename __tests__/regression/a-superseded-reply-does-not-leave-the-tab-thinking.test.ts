/**
 * 2026-09-29 (review) — A SUPERSEDED REPLY MUST NOT LEAVE THE CADDIE TAB ON 'thinking'.
 *
 * useCaddieTabMic.processTurn sets 'thinking', and when a newer turn has started by the time the reply
 * lands (a queued question, or a live mic) it shows the caption and returns — without ever setting
 * another state. When the newer turn was one the tab does not drive (a SmartMotion capture, VAD
 * arming, an earbud session), nothing else moved the screen either: the avatar sat 'thinking' for
 * good, VAD (which needs 'idle') stayed off, and every proactive line was dropped as "busy".
 *
 * Drives the real hook (React's hooks stubbed to plain refs — processTurn is an async function, not a
 * render) with the consumer's state machine written exactly as caddie.tsx wires it; a source pin below
 * keeps that wiring honest.
 */
import fs from 'fs';
import path from 'path';

type TabState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'arming';

function setup(opts: { duringAsk: (clock: typeof import('../../services/userTurnClock')) => void; micLive: () => boolean }) {
  const voice = {
    speak: jest.fn(async () => undefined),
    speakFromBase64: jest.fn(async () => undefined),
    speakDeviceNotice: jest.fn(async () => undefined),
    isCapturing: jest.fn(() => opts.micLive()),
    isExternalMicActive: jest.fn(() => false),
  };
  jest.resetModules();
  jest.doMock('react', () => ({
    useRef: <T,>(v: T) => ({ current: v }),
    useCallback: <T,>(fn: T) => fn,
  }));
  jest.doMock('../../services/voiceService', () => voice);
  jest.doMock('../../hooks/useVoiceCaddie', () => ({ endsAsQuestion: () => false, isCloseIntent: () => false }));
  jest.doMock('../../services/conversationState', () => ({ recordKevinTurn: () => undefined }));
  jest.doMock('../../services/funnelEvents', () => ({ noteCaddieTurn: () => undefined }));
  jest.doMock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: () => undefined }));
  jest.doMock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: () => null, CADDIE_PAYWALL_DEFERRED_LINE: '' }));
  jest.doMock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: () => null }));
  jest.doMock('../../store/conversationLogStore', () => ({ useConversationLog: { getState: () => ({ logUser: () => undefined }) } }));
  jest.doMock('../../store/issueLogStore', () => ({ useIssueLogStore: { getState: () => ({ addVoiceTurn: () => undefined }) } }));
  jest.doMock('../../store/pointsStore', () => ({ usePointsStore: { getState: () => ({ addPoints: () => undefined }) } }));
  const clock = require('../../services/userTurnClock') as typeof import('../../services/userTurnClock');
  jest.doMock('../../services/caddieBrain', () => ({
    askCaddie: async () => {
      opts.duringAsk(clock);
      return { text: 'Smooth 8-iron.', audioBase64: null, toolActions: [] };
    },
  }));
  const settings = require('../../store/settingsStore') as typeof import('../../store/settingsStore');
  settings.useSettingsStore.setState({ voiceEnabled: true } as never);
  const hook = require('../../hooks/useCaddieTabMic') as typeof import('../../hooks/useCaddieTabMic');

  // The consumer, exactly as app/(tabs)/caddie.tsx wires it.
  const tab = { state: 'idle' as TabState };
  const setVoiceState = (next: TabState | ((p: TabState) => TabState)) => {
    tab.state = typeof next === 'function' ? next(tab.state) : next;
  };
  const kevinSpoke: string[] = [];
  const mic = hook.useCaddieTabMic({
    onKevinSpoke: (t) => { kevinSpoke.push(t); },
    onVoiceStateChange: (s) => setVoiceState(s),
    onSuperseded: () => { setVoiceState((prev) => (prev === 'thinking' ? 'idle' : prev)); },
  });
  return { mic, tab, voice, kevinSpoke, setVoiceState };
}

describe('a superseded caddie-tab reply releases its own "thinking", and only that', () => {
  afterEach(() => {
    for (const m of ['react', '../../services/voiceService', '../../hooks/useVoiceCaddie', '../../services/conversationState',
      '../../services/funnelEvents', '../../services/voiceWarmup', '../../services/featureAccess', '../../services/pendingPuttAsk',
      '../../store/conversationLogStore', '../../store/issueLogStore', '../../store/pointsStore', '../../services/caddieBrain']) {
      jest.dontMock(m);
    }
  });

  it('THE BUG: a mic the tab does not drive went live mid-turn → caption only, and the tab is idle again', async () => {
    let live = false;
    const env = setup({ duringAsk: (clock) => { clock.noteUserTurn(); live = true; }, micLive: () => live });
    await env.mic.processTurn('what club from 150');
    expect(env.kevinSpoke).toEqual(['Smooth 8-iron.']); // the caption still shows
    expect(env.voice.speak).not.toHaveBeenCalled();     // nothing talks over the recording
    expect(env.tab.state).toBe('idle');                 // pre-fix: stuck on 'thinking'
  });

  it('a newer turn that moved the tab to listening keeps it — the reset is scoped to thinking', async () => {
    let live = false;
    let env!: ReturnType<typeof setup>;
    env = setup({ duringAsk: (clock) => { clock.noteUserTurn(); live = true; env.setVoiceState('listening'); }, micLive: () => live });
    await env.mic.processTurn('what club from 150');
    expect(env.tab.state).toBe('listening');
  });

  it('control: nobody interrupted → the reply is spoken and the tab ends idle', async () => {
    const env = setup({ duringAsk: () => undefined, micLive: () => false });
    await env.mic.processTurn('what club from 150');
    expect(env.voice.speak).toHaveBeenCalledTimes(1);
    expect(env.tab.state).toBe('idle');
  });

  it('caddie.tsx wires onSuperseded to reset only its own thinking', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf8');
    const call = src.slice(src.indexOf('useCaddieTabMic({'));
    expect(call.slice(0, 1500)).toMatch(/onSuperseded: \(\) => \{ setVoiceState\(\(prev\) => \(prev === 'thinking' \? 'idle' : prev\)\); \}/);
  });
});
