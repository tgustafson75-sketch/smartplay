/**
 * 2026-10-24 — SmartBay AI hosted in SwingLab. The URL Caddie opens and the messages the page posts
 * back are the whole contract with smartbay-ai (host=caddie mode); these pin both halves, and that the
 * hub's lesson card and the voice routes reach the hosted screen.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import * as fs from 'fs';
import * as path from 'path';
import { smartBayUrl, parseBayHostMessage, base64url, isHostedOrigin, SMARTBAY_ORIGIN, loadBayWhere, saveBayWhere } from '../../services/smartBayHost';

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

describe('smartBayUrl', () => {
  it('opens the bay in Caddie host mode with the range/bay switch set', () => {
    expect(smartBayUrl('range')).toBe(`${SMARTBAY_ORIGIN}/bay?host=caddie&where=range`);
    expect(smartBayUrl('bay')).toBe(`${SMARTBAY_ORIGIN}/bay?host=caddie&where=bay`);
  });
  it('carries the player file in the fragment, UTF-8 safe and URL safe', () => {
    const player = { format: 'smartplay/player', player: { firstName: 'José', handedness: 'left' } };
    const url = smartBayUrl('range', player);
    const frag = url.split('#player=')[1];
    expect(frag).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.parse(fromB64url(frag))).toEqual(player);
    expect(url.split('#')[0]).not.toContain('José');
  });
  it('base64url matches Node for multi-byte text', () => {
    const t = '“Tank” — ¿qué?';
    expect(base64url(t)).toBe(Buffer.from(t, 'utf8').toString('base64url'));
  });
});

describe('parseBayHostMessage', () => {
  it('accepts the three messages', () => {
    expect(parseBayHostMessage('{"type":"smartbay:ready"}')).toEqual({ type: 'smartbay:ready' });
    expect(parseBayHostMessage('{"type":"smartbay:where","where":"bay"}')).toEqual({ type: 'smartbay:where', where: 'bay' });
    expect(parseBayHostMessage('{"type":"smartbay:lesson","lesson":{"format":"smartplay/bay-lesson"}}')).toEqual({ type: 'smartbay:lesson', lesson: { format: 'smartplay/bay-lesson' } });
  });
  it('drops anything else', () => {
    for (const raw of ['', 'nope', '[]', 'null', '{"type":"smartbay:where","where":"moon"}', '{"type":"smartbay:lesson"}', '{"type":"other"}']) {
      expect(parseBayHostMessage(raw)).toBeNull();
    }
  });
});

describe('isHostedOrigin', () => {
  it('keeps our site in the app and sends look-alikes out', () => {
    expect(isHostedOrigin(`${SMARTBAY_ORIGIN}/r#abc`, SMARTBAY_ORIGIN)).toBe(true);
    expect(isHostedOrigin(SMARTBAY_ORIGIN, SMARTBAY_ORIGIN)).toBe(true);
    expect(isHostedOrigin(`${SMARTBAY_ORIGIN}.evil.com/`, SMARTBAY_ORIGIN)).toBe(false);
    expect(isHostedOrigin('https://apps.apple.com/app/id6772344465', SMARTBAY_ORIGIN)).toBe(false);
  });
});

describe('range/bay choice', () => {
  it('starts at the range and remembers the bay', async () => {
    expect(await loadBayWhere()).toBe('range');
    await saveBayWhere('bay');
    expect(await loadBayWhere()).toBe('bay');
  });
});

describe('reachable', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('the SwingLab lesson hero is SmartBay AI, and SmartPlay Golf is on the hub', () => {
    const hub = read('app/(tabs)/swinglab.tsx');
    const play = hub.slice(hub.indexOf('const PLAY_SECTION'), hub.indexOf('const PREPARE_SECTION'));
    const firstRoute = play.match(/route: '([^']+)'/)?.[1];
    expect(firstRoute).toBe('/swinglab/smartbay');
    expect(play).toContain("route: '/swinglab/golf'");
    expect(play).not.toMatch(/coach-lesson/);
    expect(fs.existsSync(path.join(__dirname, '../../app/swinglab', 'coach-lesson.tsx'))).toBe(false);
  });
  it('voice and the caddie catalog open the hosted screens', () => {
    const tools = read('services/intents/openToolHandler.ts');
    for (const [name, route, label] of [['smartbay', '/swinglab/smartbay', 'SmartBay AI'], ['coach_caddie', '/swinglab/smartbay', 'SmartBay AI'], ['smartplay_golf', '/swinglab/golf', 'SmartPlay Golf']]) {
      expect(tools).toContain(`  ${name}: { type: 'navigate', path: '${route}' },`);
      expect(tools).toContain(`  ${name}: '${label}',`);
    }
    const { lookupFeature } = require('../../services/knowledgeBase/appCatalog');
    expect(lookupFeature('give me a lesson')?.route).toBe('/swinglab/smartbay');
    expect(lookupFeature('smartplay golf')?.route).toBe('/swinglab/golf');
  });
  it('leaving the screen tells the page first, so a lesson in progress is saved', () => {
    expect(read('app/swinglab/smartbay.tsx')).toContain('leaveEvent="smartbay:leave"');
    const host = read('components/HostedWebApp.tsx');
    expect(host).toMatch(/addListener\('beforeRemove'/);
    expect(host).toMatch(/e\.preventDefault\(\);[\s\S]{0,200}injectJavaScript\(`window\.dispatchEvent\(new Event\(/);
    expect(host).toMatch(/navigation\.dispatch\(e\.data\.action\)/);
  });
  it('the screens exist', () => {
    expect(fs.existsSync(path.join(__dirname, '../../app/swinglab/smartbay.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '../../app/swinglab/golf.tsx'))).toBe(true);
  });
});
