/**
 * 2026-07-29 (Tim — "when I say or type 'end round' it crashes; to end a round you HAVE to choose save
 * or discard"). ONE shared end-round flow.
 *
 * Before: three different end-round entry points diverged.
 *   - Tools menu → Alert "Save & end / Discard" → feelings → recap.  (correct, crash-free)
 *   - Caddie-tab button → endRound() → feelings → recap.             (auto-saves, no choice)
 *   - Voice/text end_round handler → endRound() + navigate_replace straight to /recap/<id>.
 *     This last path auto-saved WITHOUT the save/discard choice and jumped to the recap via
 *     router.replace the instant the round ended — and that divergent immediate path is what crashed
 *     for Tim. Every on-screen path funnels through the save/discard Alert + the feelings → recap push;
 *     only voice/text skipped it.
 *
 * Now: promptEndRound() is the single implementation — the SAME save/discard confirmation the Tools
 * menu uses — callable from a service (voice/text handler) OR a component (Tools menu). It never
 * auto-ends and never uses navigate_replace; Save routes through /recap/feelings (which then pushes to
 * the recap) exactly like the button. Root-cause fix + de-duplication, not a band-aid.
 */
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useRoundStore } from '../../store/roundStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useToastStore } from '../../store/toastStore';
import { buildRoundEndSummary } from '../roundEndSummary';
import { getApiBaseUrl } from '../apiBase';

export type EndRoundPromptResult = 'no_active_round' | 'prompted';

/**
 * Present the Save-or-Discard end-round choice (identical on every surface). Returns synchronously:
 * 'no_active_round' when there's nothing to end (caller can speak "no active round"), or 'prompted'
 * once the choice UI is shown. The actual end/discard happens in the Alert button handlers.
 */
export function promptEndRound(): EndRoundPromptResult {
  const round = useRoundStore.getState();
  if (!round.isRoundActive) return 'no_active_round';

  Alert.alert(
    'End round?',
    'Save the scorecard to your history, or discard everything?',
    [
      { text: 'Keep playing', style: 'cancel' },
      {
        text: 'Save & end',
        onPress: async () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          // Snapshot BEFORE endRound() resets scores/courseHoles/activeCourse.
          const preRound = useRoundStore.getState();
          const snapshotScores = { ...preRound.scores };
          const snapshotCourseHoles = [...preRound.courseHoles];
          const cName = preRound.activeCourse ?? 'the course';
          const total = preRound.getTotalScore();
          const vspar = preRound.getScoreVsPar();
          const played = preRound.getHolesPlayed();

          const roundId = preRound.endRound();
          // Round-completion points are awarded ONCE inside endRound() (sim/holes-gated) — no
          // caller-side award here (that was the historical double-credit bug).

          const summary = buildRoundEndSummary({
            total, vspar, played,
            scores: snapshotScores,
            courseHoles: snapshotCourseHoles,
            activeCourse: cName,
          });
          const { voiceEnabled, voiceGender, language } = useSettingsStore.getState();
          if (voiceEnabled) {
            try {
              const { configureAudioForSpeech, speakChunked } = await import('../voiceService');
              await configureAudioForSpeech();
              await speakChunked(summary, voiceGender, language, getApiBaseUrl());
            } catch (e) {
              console.log('[endRoundFlow] round-summary speak failed (non-fatal):', e);
            }
          }
          try { useToastStore.getState().show('Round saved'); } catch { /* non-fatal */ }
          // Route through the SAME post-round flow as the on-screen buttons: feelings capture first,
          // which then pushes to /recap/<id>. NEVER navigate_replace straight to the recap.
          if (roundId) {
            try { router.push(`/recap/feelings?roundId=${roundId}` as never); }
            catch (e) { console.log('[endRoundFlow] recap nav failed', e); }
          }
        },
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Discard this round?',
            'All shots, scores, and plans from this round will be deleted. This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Discard everything',
                style: 'destructive',
                onPress: () => {
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
                  useRoundStore.getState().discardRound();
                  try { useToastStore.getState().show('Round discarded'); } catch { /* non-fatal */ }
                },
              },
            ],
          );
        },
      },
    ],
  );
  return 'prompted';
}
