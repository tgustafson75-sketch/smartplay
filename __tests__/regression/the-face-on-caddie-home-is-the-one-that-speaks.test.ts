/**
 * 2026-10-28 (recheck VC-1) — KEVIN'S PORTRAIT ANSWERED IN SERENA'S VOICE.
 *
 * Settings shows a per-pillar caddie row to everyone, and setCaddieForPillar changes only that
 * pillar. Caddie home registers the 'caddie' surface, which maps to the 'round' pillar, so with the
 * Round row on Serena and Active Caddie on Kevin the brain wrote as Serena (caddieRequestBody →
 * getActiveCaddie) and the voice spoke as Serena (voiceService.activeVoice). Every CaddieAvatar on
 * the tab drew persona={caddiePersonality} — Kevin — with gender from the voiceGender mirror, and the
 * swap box said "Bring Kevin forward". Review G2 finding 7 aligned voice and brain; the face stayed
 * behind, and one-owner-of-caddie-gender / persona-request-resolution test only voice and brain.
 */
import fs from 'fs';
import path from 'path';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { roundCaddieIdentity, getActiveCaddie } from '../../services/caddieResolver';
import { setActiveSurface, clearActiveSurface } from '../../services/activeSurfaceRegistry';

const caddieTab = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/caddie.tsx'), 'utf-8');

describe('the face on Caddie home is the caddie that speaks', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      caddiePersonality: 'kevin',
      voiceGender: 'male',
      caddieAssignments: { round: 'kevin', practice: 'kevin', drills: 'kevin', play: 'kevin' },
    });
    usePlayerProfileStore.setState({ customCaddieName: null, customCaddieBasePersona: 'kevin' });
  });

  it('THE BUG: Round on Serena, Active Caddie on Kevin — the face is Serena, matching voice and brain', () => {
    useSettingsStore.setState({
      caddieAssignments: { round: 'serena', practice: 'kevin', drills: 'kevin', play: 'kevin' },
    });
    setActiveSurface('caddie');
    try {
      // The brain and the voice resolve the active caddie on this surface…
      expect(getActiveCaddie()).toBe('serena');
      // …and the face, gender and name the tab draws are the same caddie.
      expect(roundCaddieIdentity()).toEqual({ persona: 'serena', face: 'serena', gender: 'female', name: 'Serena' });
    } finally {
      clearActiveSurface('caddie');
    }
  });

  it('a custom caddie on the Round row is drawn with its own name and its base persona\'s gender', () => {
    useSettingsStore.setState({
      caddieAssignments: { round: 'custom', practice: 'kevin', drills: 'kevin', play: 'kevin' },
    });
    usePlayerProfileStore.setState({ customCaddieName: 'Ace', customCaddieBasePersona: 'serena' });
    // No portrait yet: it wears its base persona's face (the voice it inherits), not Kevin's.
    expect(roundCaddieIdentity()).toEqual({ persona: 'custom', face: 'serena', gender: 'female', name: 'Ace' });
  });

  it('every CaddieAvatar on the tab draws the round-pillar caddie, never the global pick', () => {
    const avatars = caddieTab.match(/<CaddieAvatar[\s\S]*?\/>/g) ?? [];
    expect(avatars.length).toBeGreaterThanOrEqual(3);
    for (const a of avatars) {
      expect(a).toContain('persona={homeCaddie.face}');
      expect(a).toContain('gender={homeCaddie.gender}');
    }
    expect(caddieTab).toContain('const homeCaddie = roundCaddieIdentity();');
    expect(caddieTab).not.toMatch(/persona=\{caddiePersonality\}/);
    expect(caddieTab).not.toMatch(/gender=\{voiceGender === 'female'/);
  });

  it('the swap label, the custom portrait and the opener log name the same caddie', () => {
    expect(caddieTab).toContain('`Bring ${homeCaddie.name} forward`');
    expect(caddieTab).toContain("const activeCustomPortrait = homeCaddie.persona === 'custom'");
    expect(caddieTab).toContain('persona: roundCaddieIdentity().persona, gap:');
    // the tab re-renders when the Round row changes
    expect(caddieTab).toContain('useSettingsStore(s => s.caddieAssignments?.round);');
  });

  it('changing a pillar re-warms the cached cues, so the new Round caddie\'s cue is in its voice', () => {
    const vs = require('../../services/voiceService') as { prewarmOfflineVoiceClips: () => Promise<void> };
    const spy = jest.spyOn(vs, 'prewarmOfflineVoiceClips').mockImplementation(async () => undefined);
    useSettingsStore.getState().setCaddieForPillar('round', 'serena');
    expect(spy).toHaveBeenCalledTimes(1);
    useSettingsStore.getState().setCaddieForPillar('round', 'serena'); // no change, no warm
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
