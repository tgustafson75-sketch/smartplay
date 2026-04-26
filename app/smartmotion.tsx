import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useKeepAwake } from 'expo-keep-awake';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { useRelationshipStore } from '../store/relationshipStore';
import { compressFrame, analyzeSwingFrame } from '../services/swingCapture';
import type { SwingView } from '../services/swingCapture';

export default function SmartMotion() {
  useKeepAwake();
  const router = useRouter();
  const params = useLocalSearchParams();

  const club = String(params.club ?? '7 iron');
  const feel = params.feel ? String(params.feel) : null;
  const shape = params.shape ? String(params.shape) : null;

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [fix, setFix] = useState<string | null>(null);
  const [swingView, setSwingView] = useState<SwingView>('face-on');
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const { voiceGender, voiceEnabled, language } = useSettingsStore();
  const { dominantMiss, physicalLimitation } = usePlayerProfileStore();
  const { addObservation } = useRelationshipStore();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const [sessionFaults, setSessionFaults] = useState<string[]>([]);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, []);

  useEffect(() => {
    if (isRecording) {
      setRecordingTime(0);
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ]),
      );
      pulseLoop.current.start();

      timerRef.current = setInterval(() => {
        setRecordingTime(t => t + 1);
      }, 1000);

      autoStopRef.current = setTimeout(() => {
        handleStopRecording();
      }, 8000);
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      if (autoStopRef.current) { clearTimeout(autoStopRef.current); autoStopRef.current = null; }
      setRecordingTime(0);
    }

    return () => {
      pulseLoop.current?.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoStopRef.current) clearTimeout(autoStopRef.current);
    };
  }, [isRecording]);

  const handleStartRecording = async () => {
    if (!cameraRef.current || isAnalyzing) return;
    setFix(null);
    setIsRecording(true);
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: 8 });
      // Recording finished (manual stop or maxDuration reached)
      setIsRecording(false);
      if (result?.uri) {
        await handleVideoReady(result.uri);
      }
    } catch (err) {
      console.log('[smartmotion] record error:', err);
      setIsRecording(false);
    }
  };

  const handleStopRecording = () => {
    if (!cameraRef.current) return;
    try {
      cameraRef.current.stopRecording();
    } catch (err) {
      console.log('[smartmotion] stop error:', err);
    }
    // isRecording set to false via recordAsync Promise resolution above
  };

  const handleVideoReady = async (videoUri: string) => {
    setIsAnalyzing(true);
    try {
      const compressed = await ImageManipulator.manipulateAsync(
        videoUri,
        [{ resize: { width: 640 } }],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG },
      );

      const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
        encoding: 'base64',
      });

      const result = await analyzeSwingFrame(
        base64,
        club,
        feel,
        shape,
        dominantMiss,
        physicalLimitation,
        sessionFaults,
        swingView,
        language,
        apiUrl,
      );

      setFix(result.fix);

      if (result.fault) {
        setSessionFaults(prev => [...prev, result.fault!]);
      }

      if (result.fix) {
        addObservation({
          type: 'technical',
          content: club + ' SmartMotion: ' + result.fix.slice(0, 100),
        });
      }

      if (voiceEnabled && result.fix) {
        await configureAudioForSpeech();
        await speak(result.fix, voiceGender, language, apiUrl);
      }
    } catch (err) {
      console.log('[smartmotion] analyze error:', err);
      setFix('Could not read the frame. Try again with better lighting.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!permission?.granted) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.permView}>
          <Text style={styles.permText}>
            Camera access needed for SmartMotion analysis.
          </Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Allow Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>

      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mode="video"
        onCameraReady={() => console.log('[smartmotion] camera ready')}
      />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtnOverlay}>
            <Text style={styles.backTextOverlay}>‹</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.title}>SmartMotion</Text>
            <Text style={styles.clubLabel}>{club}</Text>
          </View>

          <TouchableOpacity
            onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
            style={styles.flipBtn}
          >
            <Text style={styles.flipIcon}>🔄</Text>
          </TouchableOpacity>
        </View>

        {/* VIEW SELECTOR */}
        <View style={styles.viewSelector}>
          {(['face-on', 'down-the-line'] as SwingView[]).map(v => (
            <TouchableOpacity
              key={v}
              style={[styles.viewBtn, swingView === v && styles.viewBtnActive]}
              onPress={() => setSwingView(v)}
            >
              <Text style={[styles.viewBtnText, swingView === v && styles.viewBtnTextActive]}>
                {v === 'face-on' ? 'Face On' : 'Down The Line'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* GRID OVERLAY */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.gridV} />
          <View style={[styles.gridH, { top: '33%' }]} />
          <View style={[styles.gridH, { top: '66%' }]} />
        </View>

        {/* RECORDING TIMER */}
        {isRecording && (
          <View style={styles.timer}>
            <Animated.View style={[styles.recDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.timerText}>{recordingTime + 's'}</Text>
          </View>
        )}

        {/* KEVIN FIX CARD */}
        {fix && !isAnalyzing && (
          <View style={styles.fixCard}>
            <Text style={styles.fixLabel}>KEVIN</Text>
            <Text style={styles.fixText}>{fix}</Text>
            <TouchableOpacity onPress={() => setFix(null)} style={styles.fixDismiss}>
              <Text style={styles.fixDismissText}>Tap to dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ANALYZING */}
        {isAnalyzing && (
          <View style={styles.analyzing}>
            <ActivityIndicator color="#00C896" size="small" />
            <Text style={styles.analyzingText}>Kevin is watching...</Text>
          </View>
        )}

        {/* RECORD BUTTON */}
        <View style={styles.controls}>
          {!isRecording && !isAnalyzing && !fix && (
            <Text style={styles.hint}>Position camera then record</Text>
          )}

          <TouchableOpacity
            style={[
              styles.recordBtn,
              isRecording && styles.recordBtnActive,
              isAnalyzing && styles.recordBtnDisabled,
            ]}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
            disabled={isAnalyzing}
            activeOpacity={0.85}
          >
            {isRecording
              ? <View style={styles.stopSquare} />
              : <View style={styles.recordCircle} />
            }
          </TouchableOpacity>

          <Text style={styles.recordLabel}>
            {isRecording
              ? 'Tap to stop  (auto-stops at 8s)'
              : isAnalyzing
              ? 'Kevin is watching...'
              : 'Tap to record swing'}
          </Text>
        </View>

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backBtnOverlay: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backTextOverlay: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '300',
  },
  headerCenter: {
    alignItems: 'center',
  },
  title: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  clubLabel: {
    color: '#00C896',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  flipBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipIcon: {
    fontSize: 22,
  },
  viewSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  viewBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  viewBtnActive: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0,200,150,0.2)',
  },
  viewBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  viewBtnTextActive: {
    color: '#00C896',
  },
  gridV: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  timer: {
    position: 'absolute',
    top: 120,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ef4444',
  },
  timerText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  fixCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(13,36,24,0.95)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#00C896',
    padding: 16,
    gap: 8,
  },
  fixLabel: {
    color: '#00C896',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
  },
  fixText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400',
  },
  fixDismiss: {
    alignItems: 'center',
    paddingTop: 4,
  },
  fixDismissText: {
    color: '#6b7280',
    fontSize: 12,
  },
  analyzing: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    marginHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 12,
  },
  analyzingText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  controls: {
    alignItems: 'center',
    paddingBottom: 32,
    gap: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingTop: 16,
  },
  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  recordBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnActive: {
    borderColor: '#ef4444',
  },
  recordBtnDisabled: {
    opacity: 0.4,
  },
  recordCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ef4444',
  },
  stopSquare: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  recordLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    textAlign: 'center',
  },
  permView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
    backgroundColor: '#060f09',
  },
  permText: {
    color: '#9ca3af',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  permBtn: {
    backgroundColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  permBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  backBtn: {
    paddingVertical: 10,
  },
  backText: {
    color: '#6b7280',
    fontSize: 14,
  },
});
