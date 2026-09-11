/**
 * 2026-09-10 — A CLUB COULD GO INTO THE BAG AND NEVER COME OUT.
 *
 * `clubBagStore.removeClub` and `clearBag` existed and were called by nothing, anywhere, in any
 * call style — while THREE paths added to the bag (the guided camera scan in SmartMotion twice,
 * and app/bag-scan). Camera recognition is good, not perfect, and the bag feeds the fit profile,
 * the practice picker and the caddie's club recommendation. The only remedy was reinstalling.
 *
 * These lock the removal path end to end. The last two are the ones that matter most: a handler is
 * useless if the router never registers it, and worse than useless if the CLASSIFIER was never told
 * the intent exists — that is the 2026-08-19 set_club_distance defect exactly, where a handler and
 * a regex sat wired for eleven days while the cloud classifier had no such intent to emit.
 */
import fs from 'fs';
import path from 'path';
import { bagRemoveHandler } from '../../services/intents/bagRemoveHandler';

const ROOT = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

jest.mock('../../services/analytics', () => ({ track: jest.fn() }));

const ctx = {} as never;
const mk = (club_phrase: string, raw_text = club_phrase) =>
  ({ intent_type: 'remove_club', parameters: { club_phrase }, raw_text }) as never;

describe('the bag must have an exit', () => {
  beforeEach(() => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.setState({ clubs: {} });
  });

  it('removes a club that is in the bag', async () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().registerClub('7W', { source: 'camera' });
    expect(useClubBagStore.getState().clubs['7W']).toBeTruthy();

    const res = await bagRemoveHandler.execute(mk('7 wood', 'take the 7 wood out of my bag'), ctx);
    expect(res.success).toBe(true);
    expect(useClubBagStore.getState().clubs['7W']).toBeUndefined();
  });

  it('leaves every other club alone', async () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().registerClub('7W', { source: 'camera' });
    useClubBagStore.getState().registerClub('7I', { source: 'camera' });
    await bagRemoveHandler.execute(mk('7 wood'), ctx);
    expect(useClubBagStore.getState().clubs['7I']).toBeTruthy();
  });

  it('says so honestly when the club was never in the bag', async () => {
    // Reporting "removed" for a club that was not there teaches the player the command works when
    // it has done nothing — the same lie as a toggle confirming a change it never made.
    const res = await bagRemoveHandler.execute(mk('3 hybrid'), ctx);
    expect(res.success).toBe(false);
    expect(res.voice_response).toMatch(/no 3H|to take out/i);
  });

  it('asks which club rather than guessing on an unparseable phrase', async () => {
    const res = await bagRemoveHandler.execute(mk('that thing'), ctx);
    expect(res.success).toBe(false);
    expect(res.follow_up_needed).toBe(true);
  });

  it('understands spoken number words, not just digits', async () => {
    const { useClubBagStore } = require('../../store/clubBagStore');
    useClubBagStore.getState().registerClub('3H', { source: 'camera' });
    const res = await bagRemoveHandler.execute(mk('three hybrid'), ctx);
    expect(res.success).toBe(true);
    expect(useClubBagStore.getState().clubs['3H']).toBeUndefined();
  });

  it('uses the ONE spoken-club parser, not a second phrase table', () => {
    // A private phrase→club map here is the split that produced "7 wood called 5 wood".
    const src = read('services/intents/bagRemoveHandler.ts');
    expect(src).toContain('parseSpokenClub');
    expect(src).not.toMatch(/const\s+\w*(CLUB_MAP|ALIAS)\w*\s*[:=]/);
  });

  it('is registered in the router', () => {
    const idx = read('services/intents/index.ts');
    expect(idx).toContain("import { bagRemoveHandler }");
    expect(idx).toContain('voiceCommandRouter.registerHandler(bagRemoveHandler)');
  });

  it('the CLASSIFIER knows the intent exists — enum AND prompt', () => {
    // The 2026-08-19 set_club_distance defect: handler wired, classifier never told, so every
    // phrasing the local regex missed fell to conversational and the caddie agreed pleasantly.
    const api = read('api/voice-intent.ts');
    expect(api).toMatch(/'remove_club',/);
    expect(api).toMatch(/remove_club — User wants a club TAKEN OUT/);
    // and the prompt must draw the boundary against the neighbouring intents
    expect(api).toMatch(/remove_club[\s\S]{0,1200}set_club_distance \(#15c\)/);
  });
});
