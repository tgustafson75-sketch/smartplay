/**
 * 2026-10-28 (Brain recheck R6) — THE SAVED RESPONSE LENGTH REACHES EVERY ROUTE.
 *
 * buildCaddieRequestBody fell back to `extras.responseMode ?? 'neutral'`. Only the avatar follow-up
 * (followUpBrainTurn) passed the setting in, so a player on Settings > Short — or the Quiet presence
 * preset, which sets responseMode 'short' — who typed, used the watch, the earbud, the Caddie-tab
 * mic, a putt or scene read got 'neutral' ("Maximum 2 sentences") instead of "Maximum 15 words".
 * Same question, different length depending on how he asked.
 */
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { useSettingsStore } from '../../store/settingsStore';

describe('the saved response length reaches the caddie on every route', () => {
  const original = useSettingsStore.getState().responseMode;
  afterEach(() => { useSettingsStore.getState().setResponseMode(original); });

  it.each(['short', 'detailed'] as const)('a caller that passes nothing still sends the saved %s', (mode) => {
    useSettingsStore.getState().setResponseMode(mode);
    const body = buildCaddieRequestBody({ message: 'what club here?', language: 'en' });
    expect(body.responseMode).toBe(mode);
  });

  it('an explicit caller value still wins over the store', () => {
    useSettingsStore.getState().setResponseMode('short');
    const body = buildCaddieRequestBody({ message: 'what club here?', language: 'en', responseMode: 'detailed' });
    expect(body.responseMode).toBe('detailed');
  });

  it('a player who never touched it is still neutral', () => {
    useSettingsStore.getState().setResponseMode('neutral');
    const body = buildCaddieRequestBody({ message: 'what club here?', language: 'en' });
    expect(body.responseMode).toBe('neutral');
  });
});
