import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useKeepAwake } from 'expo-keep-awake';
import Svg, { Line, Circle, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { File, Paths } from 'expo-file-system';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { speak, configureAudioForSpeech } from '../services/voiceService';
import { useSmartVision } from '../contexts/SmartVisionContext';

// ─── SATELLITE CACHE ──────────────────────
const SATELLITE_CACHE: Record<string, string> = {};

// ─── HOLE IMAGE HELPER ────────────────────
// Hole photos are pre-round preview only.
// Files not yet bundled — returns null gracefully.
// Never used for measurement.
const safeHoleImage = (_hole: number): null => null;

// ─── GPS HELPERS ──────────────────────────

const haversineYards = (
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number => {
  const R = 6371000; // meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1.09361; // yards
};

const getHoleHeading = (
  teeLat: number, teeLng: number,
  greenLat: number, greenLng: number,
): number => {
  const dLng = (greenLng - teeLng) * Math.PI / 180;
  const φ1 = teeLat * Math.PI / 180;
  const φ2 = greenLat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

const getHoleZoom = (distance: number, par: number): number => {
  if (par === 3 || distance < 180) return 18;
  if (distance < 400) return 17;
  return 16;
};

// Meters per pixel at each zoom level for 600px wide tile
const mppForZoom = (zoom: number): number => {
  if (zoom === 18) return 1.19;
  if (zoom === 17) return 2.39;
  return 4.78;
};

// ─── COMPONENT ────────────────────────────

export default function HoleView() {
  useKeepAwake();
  const router = useRouter();
  const { width: W, height: H } = useWindowDimensions();
  const IMAGE_WIDTH = W - 24;
  const IMAGE_HEIGHT = Math.min(
    Math.round(IMAGE_WIDTH * (500 / 600)),
    Math.round(H * 0.40),
  );
  const params = useLocalSearchParams();

  const hole = Number(String(params.hole ?? '')) || 1;
  const par = Number(String(params.par ?? '')) || 4;
  const distance = Number(String(params.distance ?? '')) || 150;
  const courseName = String(params.courseName ?? '');
  const isRoundActive = params.isRoundActive === 'true';
  const autoRunVision = params.autoRunVision === 'true';
  const teeLat = Number(String(params.teeLat ?? '')) || 0;
  const teeLng = Number(String(params.teeLng ?? '')) || 0;
  const middleLat = Number(String(params.middleLat ?? '')) || 0;
  const middleLng = Number(String(params.middleLng ?? '')) || 0;
  const frontYards = Number(String(params.front ?? '')) || 0;
  const backYards = Number(String(params.back ?? '')) || 0;

  const { voiceGender, language } = useSettingsStore();
  const { dominantMiss, firstName } = usePlayerProfileStore();
  const { setSmartVisionState } = useSmartVision();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';

  // ── State ──────────────────────────────
  const [gpsCoords, setGpsCoords] = useState<{
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null>(null);
  const [gpsValid, setGpsValid] = useState(false);
  const [centerYards, setCenterYards] = useState(distance);
  const [imageReady, setImageReady] = useState(false);
  const [measureMode, setMeasureMode] = useState(false);
  const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null);
  const [measureYards, setMeasureYards] = useState<number | null>(null);
  const [analysisText, setAnalysisText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const gpsWatchRef = useRef<Location.LocationSubscription | null>(null);

  // ── GPS validity ───────────────────────
  const checkGpsValid = (coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  }): boolean =>
    Math.abs(coords.latitude) > 0.01 &&
    Math.abs(coords.longitude) > 0.01 &&
    coords.accuracy < 30;

  // ── GPS watcher ────────────────────────
  useEffect(() => {
    if (!isRoundActive) return;

    const startGPS = async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return;

      gpsWatchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 2,
        },
        (loc) => {
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy ?? 99,
          };
          setGpsCoords(coords);
          const valid = checkGpsValid(coords);
          setGpsValid(valid);

          if (valid && middleLat !== 0 && middleLng !== 0) {
            const yards = haversineYards(
              coords.latitude, coords.longitude,
              middleLat, middleLng,
            );
            if (yards > 5 && yards < 800) {
              setCenterYards(Math.round(yards));
            }
          }
        },
      );
    };

    startGPS();
    return () => { gpsWatchRef.current?.remove(); };
  }, [isRoundActive, middleLat, middleLng]);

  // ── SmartVision context — open/close ────
  useEffect(() => {
    setSmartVisionState({ isOpen: true, holeNumber: hole, par });
    return () => setSmartVisionState({ isOpen: false, analysisText: null });
  }, []);

  // ── SmartVision context — live yardage ──
  useEffect(() => {
    setSmartVisionState({ centerYards });
  }, [centerYards]);

  // ── SmartVision context — tap measure ───
  useEffect(() => {
    setSmartVisionState({ measureYards });
  }, [measureYards]);

  // ── SmartVision context — analysis text ─
  useEffect(() => {
    if (analysisText) setSmartVisionState({ analysisText });
  }, [analysisText]);

  // ── Satellite URL ──────────────────────
  const getSatelliteUrl = useCallback((): string | null => {
    if (!mapsKey) return null;
    if (Math.abs(middleLat) < 0.01 || Math.abs(middleLng) < 0.01) return null;

    const hasTee = Math.abs(teeLat) > 0.01 && Math.abs(teeLng) > 0.01;

    let centerLat = middleLat;
    let centerLng = middleLng;
    let heading = 0;

    if (hasTee) {
      centerLat = teeLat + (middleLat - teeLat) * 0.55;
      centerLng = teeLng + (middleLng - teeLng) * 0.55;
      heading = getHoleHeading(teeLat, teeLng, middleLat, middleLng);
    }

    const zoom = getHoleZoom(distance, par);
    const url =
      'https://maps.googleapis.com/maps/api/staticmap' +
      '?center=' + centerLat + ',' + centerLng +
      '&zoom=' + zoom +
      '&size=600x500' +
      '&maptype=satellite' +
      (heading > 0 ? '&heading=' + heading : '') +
      '&key=' + mapsKey;

    return url;
  }, [mapsKey, middleLat, middleLng, teeLat, teeLng, distance, par]);

  // ── Image display logic ────────────────
  const satelliteUrl = getSatelliteUrl();
  const bundledImage = !isRoundActive ? safeHoleImage(hole) : null;

  type DisplayType = 'bundled' | 'satellite' | 'none';

  const displayType: DisplayType =
    bundledImage ? 'bundled'
    : satelliteUrl ? 'satellite'
    : 'none';

  const imageSource =
    displayType === 'bundled' ? bundledImage
    : displayType === 'satellite' ? { uri: satelliteUrl! }
    : null;

  // ── SmartVision ────────────────────────
  const runSmartVision = useCallback(async () => {
    if (!satelliteUrl) {
      setAnalysisText('No satellite image available. GPS coordinates needed.');
      return;
    }

    setAnalysisLoading(true);
    setAnalysisText('');

    try {
      const cacheKey = courseName.replace(/\s/g, '_') + '_h' + hole;
      let base64 = SATELLITE_CACHE[cacheKey];

      if (!base64) {
        console.log('[SmartVision] downloading...');
        const dlRes = await fetch(satelliteUrl);
        if (!dlRes.ok) {
          throw new Error('Download failed: ' + dlRes.status);
        }
        const arrayBuffer = await dlRes.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        const CHUNK = 8192;
        let dlBinary = '';
        for (let offset = 0; offset < uint8.byteLength; offset += CHUNK) {
          const slice = uint8.subarray(offset, offset + CHUNK);
          dlBinary += String.fromCharCode(...(slice as unknown as number[]));
        }
        const dlBase64 = btoa(dlBinary);
        const cacheFile = new File(Paths.cache, 'sv_' + cacheKey + '.jpg');
        cacheFile.write(dlBase64, { encoding: 'base64' });
        console.log('[SmartVision] downloaded');

        const compressed = await manipulateAsync(
          cacheFile.uri,
          [{ resize: { width: 400 } }],
          { compress: 0.7, format: SaveFormat.JPEG },
        );

        base64 = new File(compressed.uri).base64Sync();

        SATELLITE_CACHE[cacheKey] = base64;
        console.log('[SmartVision] base64 length:', base64.length);
      } else {
        console.log('[SmartVision] cache hit:', cacheKey);
      }

      const res = await fetch(apiUrl + '/api/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'hole',
          image: base64,
          hole,
          par,
          distance: centerYards,
          courseName,
          playerFirstName: firstName,
          dominantMiss,
          isRoundActive,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.log('[SmartVision] API error:', res.status, errText);
        throw new Error('API error ' + res.status);
      }

      const data = await res.json() as { message?: string };
      const message = data.message ?? '';
      console.log('[SmartVision] response:', message);

      if (!message) throw new Error('Empty response');

      setAnalysisText(message);

      // Kevin speaks the analysis
      await configureAudioForSpeech();
      await speak(message, voiceGender, language, apiUrl);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[SmartVision] error:', msg);
      setAnalysisText('Take a look at the layout and pick your target.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [
    satelliteUrl, hole, par, centerYards, courseName,
    firstName, dominantMiss, isRoundActive, apiUrl,
    voiceGender, language,
  ]);

  // ── Auto-run vision ────────────────────
  useEffect(() => {
    if (autoRunVision && imageReady && satelliteUrl) {
      const timer = setTimeout(() => { runSmartVision(); }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoRunVision, imageReady, satelliteUrl, runSmartVision]);

  // ── Measuring tool ─────────────────────
  const handleImageTap = (evt: { nativeEvent: { locationX: number; locationY: number } }) => {
    if (!measureMode) return;
    if (displayType !== 'satellite') return;

    const { locationX, locationY } = evt.nativeEvent;
    setTapPoint({ x: locationX, y: locationY });

    if (Math.abs(middleLat) < 0.01) {
      setMeasureYards(null);
      return;
    }

    const zoom = getHoleZoom(distance, par);
    const mpp = mppForZoom(zoom);

    const imageCenterLat = teeLat + (middleLat - teeLat) * 0.55;
    const imageCenterLng = teeLng + (middleLng - teeLng) * 0.55;

    const cx = IMAGE_WIDTH / 2;
    const cy = IMAGE_HEIGHT / 2;
    const dxM = (locationX - cx) * mpp;
    const dyM = (cy - locationY) * mpp;

    const tapLat = imageCenterLat + (dyM / 111320);
    const tapLng = imageCenterLng + (dxM / (111320 * Math.cos(imageCenterLat * Math.PI / 180)));

    const yards = haversineYards(tapLat, tapLng, middleLat, middleLng);
    setMeasureYards(yards > 1 && yards < 800 ? Math.round(yards) : null);
  };

  // ── GPS pixel position ─────────────────
  const getPlayerPixel = (): { x: number; y: number } | null => {
    if (!gpsValid || !gpsCoords) return null;
    if (Math.abs(middleLat) < 0.01) return null;

    const zoom = getHoleZoom(distance, par);
    const mpp = mppForZoom(zoom);

    const imageCenterLat = teeLat + (middleLat - teeLat) * 0.55;
    const imageCenterLng = teeLng + (middleLng - teeLng) * 0.55;

    const dyM = (gpsCoords.latitude - imageCenterLat) * 111320;
    const dxM = (gpsCoords.longitude - imageCenterLng) *
      111320 * Math.cos(imageCenterLat * Math.PI / 180);

    return {
      x: IMAGE_WIDTH / 2 + dxM / mpp,
      y: IMAGE_HEIGHT / 2 - dyM / mpp,
    };
  };

  const playerPixel = isRoundActive && gpsValid ? getPlayerPixel() : null;
  const greenPixel = { x: IMAGE_WIDTH / 2, y: IMAGE_HEIGHT * 0.2 };

  const modeBadgeText =
    isRoundActive && gpsValid ? '● LIVE GPS'
    : isRoundActive ? '○ GPS SEARCHING...'
    : '○ PRE-ROUND';
  const modeBadgeColor = isRoundActive && gpsValid ? '#00C896' : '#6b7280';

  // ── RENDER ─────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{'Hole ' + hole + ' · Par ' + par}</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* MODE BADGE */}
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { borderColor: modeBadgeColor }]}>
            <Text style={[styles.badgeText, { color: modeBadgeColor }]}>
              {modeBadgeText}
            </Text>
          </View>
        </View>

        {/* HOLE IMAGE */}
        <View
          style={[styles.imageWrapper, { width: IMAGE_WIDTH, height: IMAGE_HEIGHT }]}
          onStartShouldSetResponder={() => measureMode}
          onResponderRelease={handleImageTap}
        >
          {imageSource ? (
            <Image
              source={imageSource}
              style={styles.holeImage}
              resizeMode="cover"
              onLoad={() => setImageReady(true)}
            />
          ) : (
            <View style={styles.noImage}>
              <Text style={styles.noImageText}>{'Hole ' + hole}</Text>
              <Text style={styles.noImageSub}>{'Par ' + par + ' · ' + distance + ' yds'}</Text>
            </View>
          )}

          {/* SVG overlay — satellite only */}
          {displayType === 'satellite' && imageReady && (
            <Svg
              style={StyleSheet.absoluteFill}
              width={IMAGE_WIDTH}
              height={IMAGE_HEIGHT}
            >
              {/* Green center dot */}
              <Circle
                cx={greenPixel.x}
                cy={greenPixel.y}
                r={8}
                fill="#F5A623"
                stroke="#ffffff"
                strokeWidth={2}
              />

              {/* Player dot */}
              {playerPixel && (
                <>
                  <Line
                    x1={playerPixel.x}
                    y1={playerPixel.y}
                    x2={greenPixel.x}
                    y2={greenPixel.y}
                    stroke="#00C896"
                    strokeWidth={2}
                    strokeDasharray="6,4"
                    opacity={0.8}
                  />
                  <Circle
                    cx={playerPixel.x}
                    cy={playerPixel.y}
                    r={9}
                    fill="#00C896"
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                </>
              )}

              {/* Tap measuring point */}
              {tapPoint && measureMode && (
                <>
                  <Line
                    x1={tapPoint.x}
                    y1={tapPoint.y}
                    x2={greenPixel.x}
                    y2={greenPixel.y}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    strokeDasharray="4,3"
                    opacity={0.9}
                  />
                  <Circle
                    cx={tapPoint.x}
                    cy={tapPoint.y}
                    r={7}
                    fill="#ffffff"
                    stroke="#00C896"
                    strokeWidth={2}
                  />
                  {measureYards && (
                    <SvgText
                      x={tapPoint.x + 12}
                      y={tapPoint.y - 8}
                      fill="#ffffff"
                      fontSize={14}
                      fontWeight="bold"
                    >
                      {measureYards + 'y'}
                    </SvgText>
                  )}
                </>
              )}
            </Svg>
          )}

          {/* Pre-round badge */}
          {displayType === 'bundled' && (
            <LinearGradient
              colors={['transparent', 'rgba(6,15,9,0.85)']}
              style={styles.preRoundBadge}
              pointerEvents="none"
            >
              <Text style={styles.preRoundText}>📸 Hole Preview</Text>
              <Text style={styles.preRoundSub}>GPS view when round starts</Text>
            </LinearGradient>
          )}
        </View>

        {/* BUTTON ROW */}
        <View style={styles.btnRow}>
          {displayType === 'satellite' && (
            <TouchableOpacity
              style={[styles.btn, measureMode && styles.btnActive]}
              onPress={() => {
                setMeasureMode(!measureMode);
                setTapPoint(null);
                setMeasureYards(null);
              }}
            >
              <Text style={[styles.btnText, measureMode && styles.btnTextActive]}>
                📐 Measure
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.btn}
            onPress={() =>
              router.push({
                pathname: '/hole-view-3d',
                params: { courseName },
              } as never)
            }
          >
            <Text style={styles.btnText}>🌐 3D View</Text>
          </TouchableOpacity>
        </View>

        {/* MEASURE RESULT */}
        {measureMode && measureYards !== null && (
          <View style={styles.measureResult}>
            <Text style={styles.measureResultText}>{measureYards + ' yds to flag'}</Text>
          </View>
        )}

        {/* SMARTVISION BUTTON */}
        <TouchableOpacity
          style={[styles.svBtn, analysisLoading && styles.svBtnLoading]}
          onPress={runSmartVision}
          disabled={analysisLoading}
          activeOpacity={0.85}
        >
          {analysisLoading ? (
            <ActivityIndicator color="#00C896" size="small" />
          ) : (
            <Text style={styles.svBtnText}>
              {analysisText ? 'SmartVision — tap to re-run' : 'SmartVision Analysis'}
            </Text>
          )}
        </TouchableOpacity>

        {/* ANALYSIS CARD */}
        {Boolean(analysisText) && (
          <View style={styles.analysisCard}>
            <Text style={styles.analysisLabel}>KEVIN</Text>
            <Text style={styles.analysisText} numberOfLines={4}>
              {analysisText}
            </Text>
          </View>
        )}

        {/* YARDAGE ROW */}
        <View style={styles.yardRow}>
          <View style={styles.yardCard}>
            <Text style={styles.yardLabel}>FRONT</Text>
            <Text style={styles.yardValue}>
              {frontYards > 0 ? frontYards : distance - 16}
            </Text>
          </View>

          <View style={[styles.yardCard, styles.yardCardCenter]}>
            <Text style={styles.yardLabelGreen}>CTR</Text>
            <Text style={styles.yardValueCenter}>{centerYards}</Text>
            {isRoundActive && gpsValid && (
              <Text style={styles.playsLike}>{'plays like ' + centerYards + ' yds'}</Text>
            )}
          </View>

          <View style={styles.yardCard}>
            <Text style={styles.yardLabel}>BACK</Text>
            <Text style={styles.yardValue}>
              {backYards > 0 ? backYards : distance + 16}
            </Text>
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 60,
  },
  backText: {
    color: '#00C896',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  badgeRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  imageWrapper: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  holeImage: {
    width: '100%',
    height: '100%',
  },
  noImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d2418',
  },
  noImageText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
  },
  noImageSub: {
    color: '#6b7280',
    fontSize: 14,
    marginTop: 4,
  },
  preRoundBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  preRoundText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  preRoundSub: {
    color: '#9ca3af',
    fontSize: 11,
    marginTop: 1,
  },
  btnRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 6,
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a28',
    backgroundColor: '#060f09',
  },
  btnActive: {
    borderColor: '#00C896',
    backgroundColor: '#003d20',
  },
  btnText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '600',
  },
  btnTextActive: {
    color: '#00C896',
  },
  measureResult: {
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: '#0d1a00',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5A623',
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  measureResultText: {
    color: '#F5A623',
    fontSize: 14,
    fontWeight: '700',
  },
  svBtn: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#0d2418',
    borderWidth: 1.5,
    borderColor: '#00C896',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  svBtnLoading: {
    borderColor: '#F5A623',
  },
  svBtnText: {
    color: '#00C896',
    fontSize: 14,
    fontWeight: '700',
  },
  analysisCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#0d2418',
    borderLeftWidth: 3,
    borderLeftColor: '#00C896',
    borderRadius: 8,
    padding: 12,
  },
  analysisLabel: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 6,
  },
  analysisText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 21,
  },
  yardRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    gap: 6,
  },
  yardCard: {
    flex: 1,
    backgroundColor: '#0d2418',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  yardCardCenter: {
    flex: 1.3,
    borderWidth: 2,
    borderColor: '#00C896',
  },
  yardLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  yardLabelGreen: {
    color: '#00C896',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  yardValue: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '700',
  },
  yardValueCenter: {
    color: '#ffffff',
    fontSize: 38,
    fontWeight: '900',
  },
  playsLike: {
    color: '#F5A623',
    fontSize: 11,
    marginTop: 3,
  },
});
