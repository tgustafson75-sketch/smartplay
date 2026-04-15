import { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import PracticeTutorialOverlay from '../components/PracticeTutorialOverlay';
import { useCaddieMemory } from '../store/CaddieMemory';
import { extractFrames } from '../services/VideoAnalysisHelper';
import { analyzeSwing } from '../services/SwingAnalysisEngine';

// ─── Types ────────────────────────────────────────────────────────────────────
type ShotDirection = 'left' | 'straight' | 'right';
type Contact       = 'clean' | 'fat' | 'thin';
type Feel          = 'good' | 'neutral' | 'bad';
type Target        = 'left' | 'center' | 'right';

interface ShotEntry {
  id:        number;
  result:    ShotDirection;   // canonical outcome field
  direction: ShotDirection;   // kept for existing display helpers
  contact:   Contact;
  feel:      Feel;
  target:    Target;
  timestamp: number;          // Date.now() when logged
  videoTime: number | null;   // seconds elapsed in active recording
  videoUri:  string | null;   // URI of the video file being recorded
  // AI / video frame analysis fields
  sessionId: string;          // groups all shots in this practice session
  frameTag:  string | null;   // media-fragment ref: "<videoUri>#t=<videoTime>s" or null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pct = (count: number, total: number) =>
  total === 0 ? '0%' : `${Math.round((count / total) * 100)}%`;

const DIRECTION_COLOR: Record<ShotDirection, string> = {
  left:     '#fcd34d',
  straight: '#4ade80',
  right:    '#93c5fd',
};

const FEEL_COLOR: Record<Feel, string> = {
  good:    '#4ade80',
  neutral: '#a3a3a3',
  bad:     '#f87171',
};

const directionLabel: Record<ShotDirection, string> = {
  left:     '← Left',
  straight: '● Straight',
  right:    'Right →',
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function SwingLab() {
  const router = useRouter();

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(false);

  // Camera permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission,    requestMicPermission]    = useMicrophonePermissions();

  // Recording state
  const cameraRef            = useRef<CameraView>(null);
  const recordingStartRef    = useRef<number | null>(null);  // epoch ms when rec started
  const [recording,       setRecording]       = useState(false);
  const [videoUri,        setVideoUri]         = useState<string | null>(null);
  const [recordingStatus, setRecordingStatus]  = useState('Ready to record');

  // Target
  const [target, setTarget] = useState<Target>('center');

  // Shot input
  const [pendingContact, setPendingContact] = useState<Contact>('clean');
  const [pendingFeel, setPendingFeel]       = useState<Feel>('good');

  // Shot log
  const [shots, setShots]             = useState<ShotEntry[]>([]);
  const [nextId, setNextId]           = useState(1);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Stable session identifier — regenerated on each new session
  const [sessionId, setSessionId]     = useState<string>(
    () => `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  );

  // ── Recording handlers ──────────────────────────────────────────────────────
  const handleStartRecording = async () => {
    // Request permissions on first use
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) { setRecordingStatus('Camera permission denied'); return; }
    }
    if (!micPermission?.granted) {
      const res = await requestMicPermission();
      if (!res.granted) { setRecordingStatus('Microphone permission denied'); return; }
    }
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setVideoUri(null);
    recordingStartRef.current = Date.now();
    setRecordingStatus('Recording…');
    try {
      // recordAsync resolves when stopRecording() is called
      const video = await cameraRef.current.recordAsync();
      if (video?.uri) {
        setVideoUri(video.uri);
        setRecordingStatus('Video saved ✔');
      } else {
        setRecordingStatus('Recording stopped');
      }
    } catch {
      setRecordingStatus('Recording error');
    } finally {
      setRecording(false);
      recordingStartRef.current = null;
    }
  };

  const handleStopRecording = () => {
    if (!cameraRef.current || !recording) return;
    cameraRef.current.stopRecording(); // resolves the recordAsync promise above
  };

  // ── Shot logging ────────────────────────────────────────────────────────────
  const logShot = (direction: ShotDirection) => {
    if (sessionEnded) return;
    const now = Date.now();
    const videoTime =
      recording && recordingStartRef.current !== null
        ? Math.round((now - recordingStartRef.current) / 1000)
        : null;
    const entry: ShotEntry = {
      id:        nextId,
      result:    direction,
      direction,
      contact:   pendingContact,
      feel:      pendingFeel,
      target,
      timestamp: now,
      videoTime,
      videoUri:  videoUri,
      sessionId,
      frameTag:  videoUri && videoTime !== null ? `${videoUri}#t=${videoTime}s` : null,
    };
    setShots((prev) => [...prev, entry]);
    setNextId((n) => n + 1);
  };

  // ── Derived stats ────────────────────────────────────────────────────────────
  const total     = shots.length;
  const leftCount = shots.filter((s) => s.direction === 'left').length;
  const strCount  = shots.filter((s) => s.direction === 'straight').length;
  const rightCount = shots.filter((s) => s.direction === 'right').length;
  const lastShot  = shots[shots.length - 1] ?? null;

  // ── Insight ──────────────────────────────────────────────────────────────────
  const getInsight = (): string => {
    if (total < 3) return 'Hit a few shots to build your pattern.';
    const leftPct  = leftCount  / total;
    const rightPct = rightCount / total;
    const strPct   = strCount   / total;
    if (leftPct >= 0.6)  return `Strong left bias (${pct(leftCount, total)}). Try an inside-out path.`;
    if (rightPct >= 0.6) return `Strong right bias (${pct(rightCount, total)}). Check your face angle at impact.`;
    if (strPct   >= 0.7) return `Solid consistency — ${pct(strCount, total)} straight. Keep it up.`;
    const poorFeel = shots.filter((s) => s.feel === 'bad').length;
    if (poorFeel / total >= 0.5) return 'More than half your shots felt bad — slow down and dial in contact first.';
    const fatThin = shots.filter((s) => s.contact === 'fat' || s.contact === 'thin').length;
    if (fatThin / total >= 0.5) return 'Contact is inconsistent — focus on sweeping the base of the arc.';
    return 'Mixed pattern — stay patient and commit to each shot.';
  };

  // ── End session ──────────────────────────────────────────────────────────────
  const updateMemoryFromSession = useCaddieMemory((s) => s.updateMemoryFromSession);

  const handleEndSession = async () => {
    setRecording(false);
    setSessionEnded(true);
    const fatCount   = shots.filter((s) => s.contact === 'fat').length;
    const thinCount  = shots.filter((s) => s.contact === 'thin').length;
    const cleanCount = shots.filter((s) => s.contact === 'clean').length;

    // Derive swing characteristics from video frames when a recording exists.
    let swingPathResult: 'in-to-out' | 'out-to-in' | 'neutral' | undefined;
    let faceAngleResult: 'open' | 'closed' | 'square' | undefined;
    if (videoUri) {
      try {
        const dominantResult: ShotDirection =
          rightCount >= leftCount && rightCount >= strCount ? 'right' :
          leftCount  >= strCount  ? 'left' :
          'straight';
        const frames   = await extractFrames(videoUri);
        const analysis = analyzeSwing(frames, { shotResult: dominantResult });
        swingPathResult = analysis.clubPath as typeof swingPathResult;
        faceAngleResult = analysis.faceAngle as typeof faceAngleResult;
      } catch { /* video analysis is best-effort */ }
    }

    updateMemoryFromSession({
      totalShots:    total,
      leftCount,
      rightCount,
      straightCount: strCount,
      fatCount,
      thinCount,
      cleanCount,
      swingPath: swingPathResult,
      faceAngle: faceAngleResult,
    });
  };

  const handleNewSession = () => {
    setShots([]);
    setNextId(1);
    setSessionEnded(false);
    setRecordingStatus('Ready to record');
    setVideoUri(null);
    setPendingContact('clean');
    setPendingFeel('good');
    setTarget('center');
    setSessionId(`sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <PracticeTutorialOverlay
        visible={showTutorial}
        onDismiss={() => setShowTutorial(false)}
      />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── 1. Header ───────────────────────────────────────────────────── */}
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>‹ Back</Text>
          </Pressable>
          <Text style={s.heading}>Swing Lab</Text>
          <Pressable onPress={() => setShowTutorial(true)} style={s.tutorialBtn}>
            <Text style={s.tutorialBtnText}>Tutorial</Text>
          </Pressable>
        </View>

        {/* ── 2. Video / Recording ────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>📹  Video</Text>

          {/* Live camera preview */}
          <View style={s.cameraContainer}>
            {cameraPermission?.granted ? (
              <CameraView
                ref={cameraRef}
                style={s.camera}
                mode="video"
                facing="back"
              />
            ) : (
              <View style={s.videoPlaceholder}>
                <Text style={s.videoPlaceholderIcon}>🎬</Text>
                <Text style={s.videoPlaceholderText}>Camera preview</Text>
                {!cameraPermission?.granted && (
                  <Pressable onPress={requestCameraPermission} style={s.permBtn}>
                    <Text style={s.permBtnText}>Enable Camera</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* Recording indicator overlay */}
            {recording && (
              <View style={s.recIndicator}>
                <View style={s.recDot} />
                <Text style={s.recIndicatorText}>REC</Text>
              </View>
            )}

            {/* Saved video badge */}
            {!recording && videoUri && (
              <View style={s.savedBadge}>
                <Text style={s.savedBadgeText}>✓ Video saved</Text>
              </View>
            )}
          </View>

          <View style={s.row}>
            <Pressable
              onPress={handleStartRecording}
              disabled={recording || sessionEnded}
              style={[s.recBtn, s.recBtnStart, (recording || sessionEnded) && s.btnDisabled]}
            >
              <Text style={s.recBtnText}>⏺  Start</Text>
            </Pressable>
            <Pressable
              onPress={handleStopRecording}
              disabled={!recording}
              style={[s.recBtn, s.recBtnStop, !recording && s.btnDisabled]}
            >
              <Text style={s.recBtnText}>⏹  Stop</Text>
            </Pressable>
          </View>
          <Text style={s.statusText}>{recordingStatus}</Text>
        </View>

        {/* ── 3. Target ───────────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>🎯  Target</Text>
          <View style={s.row}>
            {(['left', 'center', 'right'] as Target[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTarget(t)}
                style={[
                  s.targetBtn,
                  target === t && s.targetBtnActive,
                ]}
              >
                <Text style={[s.targetBtnText, target === t && s.targetBtnTextActive]}>
                  {t === 'left' ? '← Left' : t === 'center' ? '● Center' : 'Right →'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.subLabel}>
            Current target: <Text style={s.subLabelValue}>{target.charAt(0).toUpperCase() + target.slice(1)}</Text>
          </Text>
        </View>

        {/* ── 4. Shot Input ───────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>🏌️  Log Shot</Text>

          {/* Contact quality */}
          <Text style={s.selectorLabel}>Contact</Text>
          <View style={s.row}>
            {(['clean', 'fat', 'thin'] as Contact[]).map((c) => (
              <Pressable
                key={c}
                onPress={() => setPendingContact(c)}
                style={[s.selectorBtn, pendingContact === c && s.selectorBtnActive]}
              >
                <Text style={[s.selectorBtnText, pendingContact === c && s.selectorBtnTextActive]}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Feel */}
          <Text style={s.selectorLabel}>Feel</Text>
          <View style={s.row}>
            {(['good', 'neutral', 'bad'] as Feel[]).map((f) => (
              <Pressable
                key={f}
                onPress={() => setPendingFeel(f)}
                style={[
                  s.selectorBtn,
                  pendingFeel === f && { ...s.selectorBtnActive, borderColor: FEEL_COLOR[f] },
                ]}
              >
                <Text style={[
                  s.selectorBtnText,
                  pendingFeel === f && { color: FEEL_COLOR[f], fontWeight: '700' },
                ]}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Direction */}
          <Text style={s.selectorLabel}>Direction</Text>
          <View style={s.row}>
            {(['left', 'straight', 'right'] as ShotDirection[]).map((d) => (
              <Pressable
                key={d}
                onPress={() => logShot(d)}
                disabled={sessionEnded}
                style={[
                  s.dirBtn,
                  { borderColor: DIRECTION_COLOR[d] },
                  sessionEnded && s.btnDisabled,
                ]}
              >
                <Text style={[s.dirBtnText, { color: DIRECTION_COLOR[d] }]}>
                  {directionLabel[d]}
                </Text>
              </Pressable>
            ))}
          </View>
          {sessionEnded && (
            <Text style={s.sessionEndedNote}>Session ended — start a new session to log more shots.</Text>
          )}
        </View>

        {/* ── 5. Live Stats ───────────────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>📊  Stats</Text>
          <View style={s.statsRow}>
            <View style={s.statCell}>
              <Text style={s.statValue}>{total}</Text>
              <Text style={s.statLabel}>Shots</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCell}>
              <Text style={[s.statValue, { color: DIRECTION_COLOR.left }]}>{pct(leftCount, total)}</Text>
              <Text style={s.statLabel}>Left</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCell}>
              <Text style={[s.statValue, { color: DIRECTION_COLOR.straight }]}>{pct(strCount, total)}</Text>
              <Text style={s.statLabel}>Straight</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statCell}>
              <Text style={[s.statValue, { color: DIRECTION_COLOR.right }]}>{pct(rightCount, total)}</Text>
              <Text style={s.statLabel}>Right</Text>
            </View>
          </View>

          {/* Mini bar chart */}
          {total > 0 && (
            <View style={s.barRow}>
              {leftCount > 0 && (
                <View style={[s.bar, { flex: leftCount, backgroundColor: DIRECTION_COLOR.left }]} />
              )}
              {strCount > 0 && (
                <View style={[s.bar, { flex: strCount, backgroundColor: DIRECTION_COLOR.straight }]} />
              )}
              {rightCount > 0 && (
                <View style={[s.bar, { flex: rightCount, backgroundColor: DIRECTION_COLOR.right }]} />
              )}
            </View>
          )}
        </View>

        {/* ── 6. Last Shot Card ───────────────────────────────────────────── */}
        {lastShot && (
          <View style={[s.card, s.lastShotCard]}>
            <Text style={s.cardTitle}>🏹  Last Shot  <Text style={s.shotIdText}>#{lastShot.id}</Text></Text>
            <View style={s.lastShotRow}>
              <View style={[s.lastShotChip, { borderColor: DIRECTION_COLOR[lastShot.direction] }]}>
                <Text style={[s.lastShotChipText, { color: DIRECTION_COLOR[lastShot.direction] }]}>
                  {directionLabel[lastShot.direction]}
                </Text>
              </View>
              <View style={[s.lastShotChip, { borderColor: '#6b7280' }]}>
                <Text style={s.lastShotChipText}>{lastShot.contact.charAt(0).toUpperCase() + lastShot.contact.slice(1)}</Text>
              </View>
              <View style={[s.lastShotChip, { borderColor: FEEL_COLOR[lastShot.feel] }]}>
                <Text style={[s.lastShotChipText, { color: FEEL_COLOR[lastShot.feel] }]}>
                  {lastShot.feel.charAt(0).toUpperCase() + lastShot.feel.slice(1)}
                </Text>
              </View>
            </View>
            <Text style={s.lastShotTarget}>
              Target: <Text style={s.subLabelValue}>{lastShot.target.charAt(0).toUpperCase() + lastShot.target.slice(1)}</Text>
            </Text>
            <Text style={s.lastShotMeta}>
              {new Date(lastShot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              {lastShot.videoTime !== null ? `  ·  📹 ${lastShot.videoTime}s` : ''}
            </Text>
          </View>
        )}

        {/* ── 7. Insights Card ────────────────────────────────────────────── */}
        <View style={[s.card, s.insightCard]}>
          <Text style={s.cardTitle}>💡  Insight</Text>
          <Text style={s.insightText}>{getInsight()}</Text>
        </View>

        {/* ── 8. End / New Session ────────────────────────────────────────── */}
        {!sessionEnded ? (
          <Pressable onPress={handleEndSession} style={s.endBtn}>
            <Text style={s.endBtnText}>End Session</Text>
          </Pressable>
        ) : (
          <View style={s.sessionSummary}>
            <Text style={s.summaryTitle}>Session Complete</Text>
            <Text style={s.summaryStats}>{total} shot{total !== 1 ? 's' : ''} logged</Text>

            {total > 0 && (
              <>
                {/* ── Miss Bias ─────────────────────────────── */}
                <View style={s.summarySection}>
                  <Text style={s.summarySectionLabel}>MISS BIAS</Text>
                  <View style={s.summaryRow}>
                    <View style={[s.summaryChip, { borderColor: '#fcd34d' }]}>
                      <Text style={[s.summaryChipLabel, { color: '#fcd34d' }]}>← Left</Text>
                      <Text style={s.summaryChipVal}>{leftCount} · {pct(leftCount, total)}</Text>
                    </View>
                    <View style={[s.summaryChip, { borderColor: '#4ade80' }]}>
                      <Text style={[s.summaryChipLabel, { color: '#4ade80' }]}>● Straight</Text>
                      <Text style={s.summaryChipVal}>{strCount} · {pct(strCount, total)}</Text>
                    </View>
                    <View style={[s.summaryChip, { borderColor: '#93c5fd' }]}>
                      <Text style={[s.summaryChipLabel, { color: '#93c5fd' }]}>Right →</Text>
                      <Text style={s.summaryChipVal}>{rightCount} · {pct(rightCount, total)}</Text>
                    </View>
                  </View>
                  {total >= 3 && (() => {
                    if (leftCount  / total >= 0.5) return <Text style={[s.summaryBiasLabel, { color: '#fcd34d' }]}>Left-biased — check your path</Text>;
                    if (rightCount / total >= 0.5) return <Text style={[s.summaryBiasLabel, { color: '#93c5fd' }]}>Right-biased — check face angle</Text>;
                    if (strCount   / total >= 0.6) return <Text style={[s.summaryBiasLabel, { color: '#4ade80' }]}>Well-balanced — solid session</Text>;
                    return <Text style={[s.summaryBiasLabel, { color: '#a3a3a3' }]}>Mixed pattern — keep working at it</Text>;
                  })()}
                </View>

                {/* ── Contact Distribution ───────────────────── */}
                <View style={s.summarySection}>
                  <Text style={s.summarySectionLabel}>CONTACT</Text>
                  <View style={s.summaryRow}>
                    {(['clean', 'fat', 'thin'] as Contact[]).map((c) => {
                      const cnt = shots.filter((sh) => sh.contact === c).length;
                      const col = c === 'clean' ? '#4ade80' : '#f87171';
                      return (
                        <View key={c} style={[s.summaryChip, { borderColor: col }]}>
                          <Text style={[s.summaryChipLabel, { color: col }]}>
                            {c.charAt(0).toUpperCase() + c.slice(1)}
                          </Text>
                          <Text style={s.summaryChipVal}>{cnt} · {pct(cnt, total)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* ── Feel Distribution ─────────────────────── */}
                <View style={s.summarySection}>
                  <Text style={s.summarySectionLabel}>FEEL</Text>
                  <View style={s.summaryRow}>
                    {(['good', 'neutral', 'bad'] as Feel[]).map((f) => {
                      const cnt = shots.filter((sh) => sh.feel === f).length;
                      return (
                        <View key={f} style={[s.summaryChip, { borderColor: FEEL_COLOR[f] }]}>
                          <Text style={[s.summaryChipLabel, { color: FEEL_COLOR[f] }]}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                          </Text>
                          <Text style={s.summaryChipVal}>{cnt} · {pct(cnt, total)}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              </>
            )}

            <Pressable onPress={handleNewSession} style={s.newSessionBtn}>
              <Text style={s.newSessionBtnText}>New Session</Text>
            </Pressable>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#060f0a',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#0d1f14',
    borderWidth: 1,
    borderColor: '#1a3a22',
  },
  backBtnText: {
    color: '#A7F3D0',
    fontSize: 14,
    fontWeight: '600',
  },
  heading: {
    color: '#A7F3D0',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  tutorialBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#0d2318',
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  tutorialBtnText: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: '700',
  },

  // Card
  card: {
    backgroundColor: '#0d1f14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a3a22',
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: '#A7F3D0',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 2,
  },

  // Video section
  cameraContainer: {
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#071209',
    borderWidth: 1,
    borderColor: '#1a3a22',
  },
  camera: {
    flex: 1,
  },
  videoPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  videoPlaceholderIcon: {
    fontSize: 36,
  },
  videoPlaceholderText: {
    color: '#4a7a5a',
    fontSize: 13,
  },
  permBtn: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: '#143d22',
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  permBtnText: {
    color: '#4ade80',
    fontSize: 13,
    fontWeight: '700',
  },
  // Recording indicator (top-left overlay)
  recIndicator: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  recIndicatorText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  // Saved video badge (bottom-right overlay)
  savedBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(20,61,34,0.85)',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4ade80',
  },
  savedBadgeText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  recBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  recBtnStart: {
    backgroundColor: '#143d22',
    borderColor: '#4ade80',
  },
  recBtnStop: {
    backgroundColor: '#3d1414',
    borderColor: '#ef4444',
  },
  recBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  statusText: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
  },
  btnDisabled: {
    opacity: 0.3,
  },

  // Target section
  targetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a3a22',
    backgroundColor: '#071209',
  },
  targetBtnActive: {
    backgroundColor: '#143d22',
    borderColor: '#4ade80',
  },
  targetBtnText: {
    color: '#4a7a5a',
    fontSize: 13,
    fontWeight: '600',
  },
  targetBtnTextActive: {
    color: '#4ade80',
  },
  subLabel: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
  },
  subLabelValue: {
    color: '#A7F3D0',
    fontWeight: '700',
  },

  // Shot input selectors
  selectorLabel: {
    color: '#4a7a5a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: -4,
  },
  selectorBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a3a22',
    backgroundColor: '#071209',
  },
  selectorBtnActive: {
    backgroundColor: '#143d22',
    borderColor: '#4ade80',
  },
  selectorBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  selectorBtnTextActive: {
    color: '#A7F3D0',
    fontWeight: '700',
  },

  // Direction buttons
  dirBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    backgroundColor: '#071209',
  },
  dirBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  sessionEndedNote: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: 2,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCell: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: '#A7F3D0',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 28,
  },
  statLabel: {
    color: '#4a7a5a',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#1a3a22',
  },
  barRow: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    gap: 1,
    marginTop: 4,
  },
  bar: {
    borderRadius: 4,
    minWidth: 4,
  },

  // Last Shot
  lastShotCard: {
    borderColor: '#2a3d2a',
  },
  lastShotRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  lastShotChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: '#071209',
  },
  lastShotChipText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  lastShotTarget: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  lastShotMeta: {
    color: '#4a7a5a',
    fontSize: 11,
    marginTop: 4,
  },
  shotIdText: {
    color: '#4a7a5a',
    fontSize: 12,
    fontWeight: '400',
  },

  // Insight
  insightCard: {
    backgroundColor: '#0a1c12',
    borderColor: '#1a3a22',
  },
  insightText: {
    color: '#d1fae5',
    fontSize: 15,
    lineHeight: 22,
  },

  // End session
  endBtn: {
    backgroundColor: '#3d1414',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  endBtnText: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Session summary
  sessionSummary: {
    backgroundColor: '#0d1f14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#4ade80',
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  summaryTitle: {
    color: '#4ade80',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryStats: {
    color: '#A7F3D0',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  summarySection: {
    width: '100%',
    marginTop: 4,
    gap: 6,
    alignItems: 'center',
  },
  summarySectionLabel: {
    color: '#4a7a5a',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  summaryChip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignItems: 'center',
    gap: 2,
    minWidth: 72,
  },
  summaryChipLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d1fae5',
  },
  summaryChipVal: {
    fontSize: 11,
    color: '#6b7280',
  },
  summaryBiasLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontStyle: 'italic',
    marginTop: 2,
  },
  newSessionBtn: {
    marginTop: 8,
    backgroundColor: '#143d22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4ade80',
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  newSessionBtnText: {
    color: '#4ade80',
    fontSize: 15,
    fontWeight: '700',
  },
});
