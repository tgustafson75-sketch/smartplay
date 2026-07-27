/**
 * Persona-voice the happy-path acks (deep audit 2026-07-26). The rotating acks + "Didn't catch that."
 * used to always play in the robotic OS voice. They now live in ONE dependency-free source
 * (services/caddieAckLines) that BOTH listeningSession (speaks them) and offlineVoiceCache (pre-renders
 * the English set in the persona voice) import — so coverage is by construction, no drift possible. This
 * pins the shared source is well-formed (offlineVoiceCache itself can't be imported in the jest env — it
 * drags expo-file-system + the round-store graph — but it builds its ack lines by spreading ACK_PHRASES.en).
 */
import { ACK_PHRASES, CADDIE_NOTICE_DIDNT_CATCH } from '../../services/caddieAckLines';

describe('caddie ack lines (shared source for speech + persona-voice cache)', () => {
  it('has a non-empty English ack set of unique, non-blank phrases', () => {
    expect(ACK_PHRASES.en.length).toBeGreaterThan(0);
    for (const p of ACK_PHRASES.en) expect(p.trim().length).toBeGreaterThan(0);
    expect(new Set(ACK_PHRASES.en).size).toBe(ACK_PHRASES.en.length);
  });

  it('provides the bare "Didn\'t catch that." notice', () => {
    expect(CADDIE_NOTICE_DIDNT_CATCH).toBe("Didn't catch that.");
  });

  it('covers every localized ack bucket', () => {
    for (const lang of ['en', 'es', 'zh'] as const) {
      expect(Array.isArray(ACK_PHRASES[lang])).toBe(true);
      expect(ACK_PHRASES[lang].length).toBeGreaterThan(0);
    }
  });
});
