/**
 * 2026-10-28 (Brain review r2) — "EXPLAIN THAT SIMPLY" MUST NOT MAKE KEVIN BRIEF FOR GOOD.
 *
 * shapeForBrain prepends the [EXPLAIN SIMPLY] instruction to a beginner's question, and that
 * instruction says "Keep it brief (a couple of sentences)". askCaddie handed the SHAPED message to the
 * style learner, which heard "keep it brief" and stepped the learned style down — saved, so every
 * later turn went out as responseMode 'short', and Settings quoted the instruction as what he said.
 * The same text went into the shared history as the player's turn. One "what does plays like mean?"
 * made him terser; each one after made him terser still.
 *
 * The reshape is for the model only. Every route now hands the player's own words over as `heard`.
 *
 * BEHAVIOURAL: the real askCaddie / conversationalBrain / useCaddieTabMic against a mocked fetch.
 */
import fs from 'fs';
import path from 'path';

const RAW = 'what does plays like mean?';

describe('the reshape reaches the model, and nothing else', () => {
  const realFetch = global.fetch;
  let sent: { message?: string }[];

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../services/featureAccess', () => ({ mayTalkToCaddie: () => true, takeCaddiePaywallBlock: () => null }));
    sent = [];
    global.fetch = jest.fn(async (_u: unknown, init?: { body?: string }) => {
      sent.push(JSON.parse(init?.body ?? '{}'));
      return { ok: true, status: 200, json: async () => ({ text: 'It is the distance the shot really plays.', audioBase64: null }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => { global.fetch = realFetch; jest.dontMock('../../services/featureAccess'); });

  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

  it('the shaped message really does carry "keep it brief" (the premise)', () => {
    const { shapeForBrain } = require('../../services/voice/preBrainTurn') as typeof import('../../services/voice/preBrainTurn');
    const { detectStyleSignal } = require('../../services/caddieStyle') as typeof import('../../services/caddieStyle');
    expect(detectStyleSignal(shapeForBrain(RAW))).toBe('briefer');
    expect(detectStyleSignal(RAW)).toBeNull();
  });

  it('THE BUG: askCaddie with a reshaped message leaves the learned style alone and files his words', async () => {
    const { shapeForBrain } = require('../../services/voice/preBrainTurn') as typeof import('../../services/voice/preBrainTurn');
    const style = require('../../services/caddieStyle') as typeof import('../../services/caddieStyle');
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    await style.saveLearnedStyle(null);
    hist.setConversationHistory([]);

    const turn = await askCaddie({ message: shapeForBrain(RAW), heard: RAW, language: 'en', timeoutMs: 5_000 });
    await flush();

    expect(turn?.text).toBeTruthy();
    expect(sent[0].message).toMatch(/^\[EXPLAIN SIMPLY\]/);     // the model still gets the instruction
    expect(await style.loadLearnedStyle()).toBeNull();          // pre-fix: { style: 'brief', heard: '[EXPLAIN SIMPLY] …' }
    expect(hist.getConversationHistory()[0].content).toBe(RAW); // pre-fix: the instruction, as his words
    expect(sent[0]).not.toHaveProperty('heard');                // never its own payload key
  });

  it('"heard" defaults to the message, so a plain turn still teaches the style', async () => {
    const style = require('../../services/caddieStyle') as typeof import('../../services/caddieStyle');
    const { askCaddie } = require('../../services/caddieBrain') as typeof import('../../services/caddieBrain');
    await style.saveLearnedStyle(null);
    await askCaddie({ message: "you're talking too much", language: 'en', timeoutMs: 5_000 });
    await flush();
    expect((await style.loadLearnedStyle())?.style).toBe('brief');
  });

  it('earbud / typed / watch: conversationalBrainTurn passes his words through to the seam', async () => {
    const { shapeForBrain } = require('../../services/voice/preBrainTurn') as typeof import('../../services/voice/preBrainTurn');
    const style = require('../../services/caddieStyle') as typeof import('../../services/caddieStyle');
    const hist = require('../../services/voice/conversationHistory') as typeof import('../../services/voice/conversationHistory');
    const brain = require('../../services/conversationalBrain') as typeof import('../../services/conversationalBrain');
    await style.saveLearnedStyle(null);
    hist.setConversationHistory([]);
    await brain.conversationalBrainTurn(shapeForBrain(RAW), { timeoutMs: 5_000, heard: RAW });
    await flush();
    expect(await style.loadLearnedStyle()).toBeNull();
    expect(hist.getConversationHistory()[0].content).toBe(RAW);
  });

  it('the shared pre-brain wrapper on those routes hands the raw utterance over', () => {
    const ls = fs.readFileSync(path.resolve(__dirname, '../../services/listeningSession.ts'), 'utf-8');
    const wrapper = ls.slice(ls.indexOf('async function brainTurnWithPreStep('));
    expect(wrapper.slice(0, wrapper.indexOf('\n}\n'))).toMatch(/heard: utterance/);
  });
});

describe('the avatar mic: the caddie-tab turn keeps his words for everything but the brain', () => {
  const MODS = ['react', '../../services/voiceService', '../../hooks/useVoiceCaddie', '../../services/conversationState',
    '../../services/funnelEvents', '../../services/voiceWarmup', '../../services/featureAccess', '../../services/pendingPuttAsk',
    '../../store/conversationLogStore', '../../store/issueLogStore', '../../store/pointsStore', '../../services/caddieBrain'];
  afterEach(() => { for (const m of MODS) jest.dontMock(m); });

  it('THE BUG: processTurn(raw, shaped) asks the brain the shaped message and logs the raw words', async () => {
    jest.resetModules();
    const logged: string[] = [];
    const issue: string[] = [];
    const asked: { message: string; heard?: string }[] = [];
    jest.doMock('react', () => ({ useRef: <T,>(v: T) => ({ current: v }), useCallback: <T,>(fn: T) => fn }));
    jest.doMock('../../services/voiceService', () => ({
      speak: jest.fn(async () => undefined), speakFromBase64: jest.fn(async () => undefined), speakDeviceNotice: jest.fn(async () => undefined),
      isCapturing: () => false, isExternalMicActive: () => false, getStopGeneration: () => 0,
    }));
    jest.doMock('../../hooks/useVoiceCaddie', () => ({ endsAsQuestion: () => false, isCloseIntent: () => false }));
    jest.doMock('../../services/conversationState', () => ({ recordKevinTurn: () => undefined }));
    jest.doMock('../../services/funnelEvents', () => ({ noteCaddieTurn: () => undefined }));
    jest.doMock('../../services/voiceWarmup', () => ({ abortVoiceWarmup: () => undefined }));
    jest.doMock('../../services/featureAccess', () => ({ takeCaddiePaywallBlock: () => null, CADDIE_PAYWALL_DEFERRED_LINE: '' }));
    jest.doMock('../../services/pendingPuttAsk', () => ({ tryAnswerOpenQuestion: () => null }));
    jest.doMock('../../store/conversationLogStore', () => ({ useConversationLog: { getState: () => ({ logUser: (t: string) => { logged.push(t); } }) } }));
    jest.doMock('../../store/issueLogStore', () => ({ useIssueLogStore: { getState: () => ({ addVoiceTurn: (t: string) => { issue.push(t); } }) } }));
    jest.doMock('../../store/pointsStore', () => ({ usePointsStore: { getState: () => ({ addPoints: () => undefined }) } }));
    jest.doMock('../../services/caddieBrain', () => ({
      askCaddie: async (o: { message: string; heard?: string }) => { asked.push(o); return { text: 'Plays-like is the real distance.', audioBase64: null, toolActions: [] }; },
    }));
    const { shapeForBrain } = require('../../services/voice/preBrainTurn') as typeof import('../../services/voice/preBrainTurn');
    const hook = require('../../hooks/useCaddieTabMic') as typeof import('../../hooks/useCaddieTabMic');
    const mic = hook.useCaddieTabMic({});

    await mic.processTurn(RAW, shapeForBrain(RAW));

    expect(asked[0].message).toMatch(/^\[EXPLAIN SIMPLY\]/);
    expect(asked[0].heard).toBe(RAW);
    expect(logged).toEqual([RAW]);
    expect(issue).toEqual([RAW]);
  });

  it('useVoiceCaddie hands processTranscriptOverride BOTH the words and the shaped message', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../hooks/useVoiceCaddie.ts'), 'utf-8');
    expect(src).toMatch(/await processTranscriptOverride\(brainBase, brainTranscript\)/);
  });
});
