import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { kevinText as kevinTextStyle } from '../../styles/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCageStore } from '../../store/cageStore';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useWatchStore } from '../../store/watchStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePointsStore } from '../../store/pointsStore';
import { analyzeSession } from '../../services/patternEngine';
import { speak, speakChunked, warmVoice, configureAudioForSpeech } from '../../services/voiceService';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import PrimaryIssueCard from '../../components/swinglab/PrimaryIssueCard';
import DrillCard from '../../components/swinglab/DrillCard';
import { getDialog } from '../../services/dialogEngine';
import { analyzeSwing, type SwingAnalysis } from '../../services/poseDetection';
import { classifySession } from '../../services/swingIssueClassifier';
import { recommendDrill } from '../../services/drillRecommendation';
import { processSwingAnalysis } from '../../services/relationshipEngine';
import { useTrustLevelStore } from '../../store/trustLevelStore';
import type { PrimaryIssue, DrillRecommendation } from '../../store/cageStore';
import { activateMediaSession, deactivateMediaSession } from '../../services/mediaKeyBridge';
import { cageLog } from '../../services/cageTelemetry';
import { getApiBaseUrl } from '../../services/apiBase';

export default function CageSummary() {
  const router = useRouter();
  const trustLevel = useTrustLevelStore(s => s.level);
  const [analyzing, setAnalyzing] = useState(false);
  const [primaryIssue, setPrimaryIssue] = useState<PrimaryIssue | null>(null);
  const [drillRec, setDrillRec] = useState<DrillRecommendation | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<'pending' | 'no_frames' | 'no_data' | 'done' | 'error'>('pending');

  const { sessionHistory } = useCageStore();
  const { addPoints } = usePointsStore();
  const { voiceGender, voiceEnabled, language } = useSettingsStore();
  const { incrementSessions } = useRelationshipStore();
  const {
    isConnected: watchConnected,
    getSessionSummary,
    clearSession: clearWatchSession,
  } = useWatchStore();
  const watchSummary = getSessionSummary();

  const apiUrl = getApiBaseUrl();

  const session =
    sessionHistory.length > 0 ? sessionHistory[sessionHistory.length - 1] : null;

  const shots = session?.shots ?? [];
  const pattern = analyzeSession(shots, session?.club ?? '');

  // Phase K.5 refinement — speak the primary issue analysis when it lands,
  // using verbosity-keyed templates per trust level. L1 stays silent (terse
  // text card only); L2/L3 auto-play TTS at increasing engagement.
  useEffect(() => {
    if (!primaryIssue || !voiceEnabled || trustLevel === 1) return;
    // 2026-06-04 — L4 'engaged' template removed; L2/L3 both use standard.
    const verbosityKey = 'primary_issue_summary_standard';
    const text = getDialog('coach', verbosityKey, {
      name: primaryIssue.name,
      mechanical: primaryIssue.mechanical_breakdown,
      feel: primaryIssue.feel_cue,
    });
    warmVoice(apiUrl); // hot by the time the 800ms timer fires the read
    setTimeout(async () => {
      await configureAudioForSpeech();
      await speakChunked(text, voiceGender, language, apiUrl);
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryIssue]);

  // Phase K — pose-detection pipeline. K.5: parallelized in pairs (chunks of
  // 2) so wall-clock drops from N×4s sequential to (N/2)×4s while still
  // passing prior_issues context-window between chunks.
  useEffect(() => {
    if (!session || analysisStatus !== 'pending') return;
    let cancelled = false;
    (async () => {
      // 2026-07-07 (audit) — no outer catch meant any throw between setAnalyzing(true)
      // and setAnalyzing(false) stuck the spinner forever (the 'error' status was
      // declared but never set). Wrap so a failure surfaces the error state + clears
      // the spinner instead of a permanent "analyzing…".
      try {
      const swingsWithClips = session.shots.filter(s => s.clipUri);
      cageLog('summary-mount', 'ok', {
        session_id: session.id,
        shots_total: session.shots.length,
        shots_with_clip: swingsWithClips.length,
      });
      if (swingsWithClips.length === 0) {
        if (!cancelled) setAnalysisStatus('no_data');
        cageLog('summary-phase-k-skip', 'fail', {
          session_id: session.id,
          reason: 'no_clipUri_on_shots',
        });
        return;
      }
      setAnalyzing(true);
      cageLog('summary-phase-k-start', 'ok', {
        session_id: session.id,
        swings_to_analyze: swingsWithClips.length,
      });
      const results: { swing_id: string; analysis: SwingAnalysis }[] = [];
      let anyNoFrames = false;
      const CHUNK = 2;
      for (let chunkStart = 0; chunkStart < swingsWithClips.length; chunkStart += CHUNK) {
        if (cancelled) return;
        const priorIssues = results.slice(-3).map(x => x.analysis.detected_issue).filter(x => x !== 'none');
        const chunk = swingsWithClips.slice(chunkStart, chunkStart + CHUNK);
        const chunkResults = await Promise.all(chunk.map((swing, j) => {
          // 2026-07-21 (BETA — analysis dead-end) — guard each analyzeSwing with a 130s hang race
          // (the same bound SmartMotion uses). Without it, a stalled native thumbnail extraction on
          // one bad clip made this Promise.all never resolve → setAnalyzing(false) never ran →
          // "Analyzing swings…" spun forever. A timeout degrades that one swing, loop still finishes.
          type AnalyzeResult = Awaited<ReturnType<typeof analyzeSwing>>;
          const guarded = Promise.race<AnalyzeResult>([
            analyzeSwing(swing.clipUri!, {
              club: session.club,
              swing_number: chunkStart + j + 1,
              prior_issues: priorIssues,
            }),
            new Promise<AnalyzeResult>((resolve) => setTimeout(() => resolve({ kind: 'error', message: 'Analysis timed out' } as AnalyzeResult), 130_000)),
          ]);
          return guarded.then(r => ({ swing, r }));
        }));
        for (const { swing, r } of chunkResults) {
          if (r.kind === 'ok') {
            results.push({ swing_id: swing.id, analysis: r.analysis });
            // Phase R — persist frame timestamps for swing detail anchors
            useCageStore.getState().setShotIssueTimestamps(session.id, swing.id, r.frame_timestamps_sec);
          }
          if (r.kind === 'no_frames') anyNoFrames = true;
        }
      }
      if (cancelled) return;
      setAnalyzing(false);
      if (results.length === 0) {
        setAnalysisStatus(anyNoFrames ? 'no_frames' : 'no_data');
        cageLog('summary-phase-k-result', 'fail', {
          session_id: session.id,
          reason: anyNoFrames ? 'no_frames' : 'no_data',
        });
        return;
      }
      const issue = classifySession(results);
      const drill = issue ? recommendDrill(issue.issue_id as never) : null;
      setPrimaryIssue(issue);
      if (drill) setDrillRec(drill);
      cageLog('summary-phase-k-result', issue ? 'ok' : 'partial', {
        session_id: session.id,
        results_count: results.length,
        primary_issue: issue?.issue_id ?? null,
        drill_id: drill?.drill_id ?? null,
      });
      // Phase R — persist analysis onto the session record so it surfaces in
      // the unified swing library browse.
      if (session) {
        useCageStore.getState().setSessionAnalysis(session.id, issue, drill);
        // Phase V.7+ — feed Kevin's relationship engine so technical
        // observations accumulate across cage sessions too.
        if (issue) {
          try {
            processSwingAnalysis({ club: session.club, primary_issue: issue });
          } catch (e) {
            console.log('[cage/summary] relationship engine error', e);
          }
        }
      }
      setAnalysisStatus('done');
      } catch (e) {
        if (!cancelled) { setAnalyzing(false); setAnalysisStatus('error'); }
        cageLog('summary-phase-k-error', 'fail', { session_id: session?.id ?? null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
    // 2026-07-23 (QA) — depend on the STABLE session id, not the session object. Mid-loop
    // setShotIssueTimestamps() rewrites sessionHistory → a new `session` identity → this effect
    // used to re-fire while analysisStatus was still 'pending', cancelling its own in-flight run
    // before it reached setAnalysisStatus('done') → "Analyzing swings…" spun forever on any
    // multi-chunk (3+ shot) session. The id only changes on a genuinely different session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, analysisStatus]);

  // Phase O.5 — earbud tap targets SmartPlay while user reviews session
  useEffect(() => {
    void activateMediaSession();
    return () => { void deactivateMediaSession(); };
  }, []);

  useEffect(() => {
    if (!session) {
      router.replace('/cage' as never);
      return;
    }
    incrementSessions();
    clearWatchSession();
    const pts = Math.min(session.shots.length * 2, 50);
    addPoints(pts, 'Cage session');

    // Phase V.7 — chain the two utterances so the second can't start while
    // the first is still speaking (the prior 800ms / 3000ms timer pair raced
    // on wall-clock and cancelled mid-sentence on short summaries).
    if (voiceEnabled && session.summary) {
      const summaryText = session.summary;
      const improveMsg = pattern.improvement
        ? "You got better as the session went on. That's how it works."
        : null;
      warmVoice(apiUrl); // hot by the time the 800ms timer fires the read
      const t = setTimeout(async () => {
        await configureAudioForSpeech();
        await speakChunked(summaryText, voiceGender, language, apiUrl);
        if (improveMsg) {
          await speak(improveMsg, voiceGender, language, apiUrl);
        }
      }, 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;

  const total = shots.length;
  const flushCount = shots.filter(s => s.feel === 'flush' || s.feel === 'solid').length;
  const fatCount   = shots.filter(s => s.feel === 'fat').length;
  const thinCount  = shots.filter(s => s.feel === 'thin').length;
  const flushRate  = total > 0 ? Math.round((flushCount / total) * 100) : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.title}>Session Complete</Text>
          <Text style={styles.subtitle}>{session.club + ' · ' + total + ' shots'}</Text>
        </View>

        {/* Phase I — Coach review intro. Phase K's pose detection will fill
             in actual analysis content; today this just establishes Kevin's
             voice presence at the review entry point. */}
        <KevinCoachBox
          body={getDialog('coach', 'cage_session_review_intro')}
          accent="coach"
        />

        {/* Primary Issue + Drill recommendation cards. These ARE populated by
             the analysis effect above (analyzeSwing → classifySession →
             recommendDrill); they render placeholder copy only when a given
             session genuinely has no analysis yet. (Comment corrected
             2026-06-09 — the old "today, always null" note was stale.) */}
        {/* Phase K — analyzing indicator while pose detection runs */}
        {analyzing && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, marginBottom: 10 }}>
            <Text style={{ color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
              Analyzing swings…
            </Text>
          </View>
        )}
        <PrimaryIssueCard
          issue={primaryIssue ?? session.primary_issue ?? null}
          totalShots={session.shots.length}
        />
        <DrillCard recommendation={drillRec ?? session.drill_recommendation ?? null} />

        {/* KEVIN DEBRIEF */}
        <View style={styles.debriefCard}>
          <Text style={styles.debriefLabel}>KEVIN</Text>
          <Text style={styles.debriefText}>
            {session.summary ?? 'Good session. Keep building.'}
          </Text>
          {session.rootCause && (
            <View style={styles.rootCause}>
              <Text style={styles.rootCauseLabel}>FOCUS AREA</Text>
              <Text style={styles.rootCauseText}>{session.rootCause}</Text>
            </View>
          )}
        </View>

        {/* STATS */}
        <View style={styles.statsRow}>
          {[
            { value: flushRate + '%', label: 'Solid', color: '#00C896' },
            {
              value: total > 0 ? Math.round((fatCount / total) * 100) + '%' : '0%',
              label: 'Fat',
              color: '#f97316',
            },
            {
              value: total > 0 ? Math.round((thinCount / total) * 100) + '%' : '0%',
              label: 'Thin',
              color: '#fbbf24',
            },
            { value: String(total), label: 'Shots', color: '#ffffff' },
          ].map(stat => (
            <View key={stat.label} style={styles.statCard}>
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* TREND */}
        {pattern.trend !== 'insufficient' && (
          <View style={styles.trendCard}>
            <Text style={styles.trendLabel}>TREND THIS SESSION</Text>
            <Text style={[
              styles.trendValue,
              {
                color:
                  pattern.trend === 'improving' ? '#00C896' :
                  pattern.trend === 'declining' ? '#ef4444' : '#6b7280',
              },
            ]}>
              {pattern.trend === 'improving' ? '↑ Improving' :
               pattern.trend === 'declining' ? '↓ Declining' : '→ Consistent'}
            </Text>
          </View>
        )}

        {/* WATCH DATA CARD */}
        {watchConnected && watchSummary && watchSummary.swings.length > 0 && (
          <View style={styles.watchCard}>
            <Text style={styles.watchLabel}>⌚ WATCH DATA</Text>

            <View style={styles.watchStats}>
              <View style={styles.watchStat}>
                <Text style={[
                  styles.watchStatValue,
                  { color: watchSummary.dominantTempoFault === 'good' ? '#00C896' : '#fbbf24' },
                ]}>
                  {watchSummary.averageTempo.toFixed(1) + ':1'}
                </Text>
                <Text style={styles.watchStatLabel}>Avg Tempo</Text>
                <Text style={styles.watchStatSub}>Ideal: 3:1</Text>
              </View>

              <View style={styles.watchStat}>
                <Text style={[
                  styles.watchStatValue,
                  { color: watchSummary.earlyTransitionRate < 0.3 ? '#00C896' : '#f97316' },
                ]}>
                  {Math.round(watchSummary.earlyTransitionRate * 100) + '%'}
                </Text>
                <Text style={styles.watchStatLabel}>Early Trans.</Text>
                <Text style={styles.watchStatSub}>Under 30% good</Text>
              </View>

              <View style={styles.watchStat}>
                <Text style={styles.watchStatValue}>
                  {Math.round(watchSummary.averageClubSpeed) + ' mph'}
                </Text>
                <Text style={styles.watchStatLabel}>Est Speed</Text>
                <Text style={styles.watchStatSub}>Estimated</Text>
              </View>
            </View>

            {watchSummary.dominantTempoFault && watchSummary.dominantTempoFault !== 'good' && (
              <Text style={styles.watchFault}>
                {'Tempo trend: ' + watchSummary.dominantTempoFault}
              </Text>
            )}
          </View>
        )}

        {/* NEXT DRILL */}
        {pattern.kevinNextDrill && (
          <View style={styles.drillCard}>
            <Text style={styles.drillLabel}>WORK ON THIS NEXT</Text>
            <Text style={styles.drillText}>{pattern.kevinNextDrill}</Text>
          </View>
        )}

        {/* DOMINANT MISS */}
        {Boolean(session.dominantMiss) && (
          <View style={styles.missCard}>
            <Text style={styles.missLabel}>DOMINANT MISS</Text>
            <Text style={styles.missValue}>
              {(session.dominantMiss ?? '').charAt(0).toUpperCase() +
               (session.dominantMiss ?? '').slice(1)}
            </Text>
          </View>
        )}

        {/* SHOT DOTS */}
        <View style={styles.dotsCard}>
          <Text style={styles.dotsLabel}>SHOT BY SHOT</Text>
          <View style={styles.dotsRow}>
            {shots.map((shot, i) => {
              const color =
                shot.feel === 'flush' || shot.feel === 'solid' ? '#00C896' :
                shot.feel === 'fat'  ? '#f97316' :
                shot.feel === 'thin' ? '#fbbf24' : '#ef4444';
              return (
                <View key={i} style={[styles.dot, { backgroundColor: color }]} />
              );
            })}
          </View>
        </View>

        {/* ACTIONS */}
        <TouchableOpacity
          style={styles.reviewBtn}
          onPress={() => router.push({
            pathname: '/cage-review/start',
            params: { session_id: session.id },
          } as never)}
        >
          <Text style={styles.reviewBtnText}>Review with Kevin</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.goAgainBtn}
          onPress={() => router.replace('/cage' as never)}
        >
          <Text style={styles.goAgainText}>Go Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.historyBtn}
          onPress={() => router.replace('/cage/history' as never)}
        >
          <Text style={styles.historyBtnText}>View All Sessions</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.doneBtn}
          onPress={() => router.replace('/(tabs)/caddie' as never)}
        >
          <Text style={styles.doneBtnText}>Back to Kevin</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
  debriefCard: {
    backgroundColor: '#0d2418',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  debriefLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  debriefText: {
    ...kevinTextStyle,
  },
  rootCause: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e3a28',
  },
  rootCauseLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  rootCauseText: {
    color: '#fbbf24',
    fontSize: 14,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 3,
  },
  trendCard: {
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trendLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  trendValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  watchCard: {
    backgroundColor: '#0d1a2a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#60a5fa',
    padding: 14,
    marginBottom: 12,
  },
  watchLabel: {
    color: '#60a5fa',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  watchStats: {
    flexDirection: 'row',
    gap: 8,
  },
  watchStat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#060f09',
    borderRadius: 8,
    paddingVertical: 10,
  },
  watchStatValue: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  watchStatLabel: {
    color: '#6b7280',
    fontSize: 10,
    marginTop: 2,
  },
  watchStatSub: {
    color: '#374151',
    fontSize: 9,
    marginTop: 1,
  },
  watchFault: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  drillCard: {
    backgroundColor: '#1a0800',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F5A623',
    padding: 14,
    marginBottom: 12,
  },
  drillLabel: {
    color: '#F5A623',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  drillText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 20,
  },
  missCard: {
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  missLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  missValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  dotsCard: {
    backgroundColor: '#0d1a0d',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 14,
    marginBottom: 16,
  },
  dotsLabel: {
    color: '#6b7280',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  reviewBtn: {
    backgroundColor: '#0d2418',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#00C896',
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  reviewBtnText: {
    color: '#00C896',
    fontSize: 15,
    fontWeight: '700',
  },
  goAgainBtn: {
    backgroundColor: '#00C896',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  goAgainText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  historyBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  historyBtnText: {
    color: '#6b7280',
    fontSize: 14,
  },
  doneBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneBtnText: {
    color: '#6b7280',
    fontSize: 15,
  },
});
