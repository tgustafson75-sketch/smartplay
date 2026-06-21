import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ImageBackground, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { getHoleGeometry, fetchCourseGeometry, type HoleGeometry } from '../../services/courseGeometryService';
import { peekFix, getLastFix } from '../../services/smartFinderService';
import { haversineYards, projectToAxis } from '../../utils/geoDistance';

// Curated screenshot fallback for local courses Tim has playtested. The
// Palms set is bundled today; Lakes and Rancho California maps are
// registered as empty so dropping `assets/courses/lakes/hole-XX.jpg` /
// `assets/courses/rancho-california/hole-XX.jpg` files later picks them
// up without further code changes (just add the require() entries here).
import { getLocalHoleImage, getLocalHoleImageById } from '../../data/localCourseImages';
import { useCourseCaptureStore } from '../../store/courseCaptureStore';

const REFRESH_MS = 4_000;
const DEFAULT_W = 320;
const DEFAULT_H = 300;

/**
 * L1 (Quiet) hole preview — a glanceable top-down sketch of the current hole
 * (tee at bottom, green at top, dashed centerline, player dot when GPS is
 * available). Sized for the L1 layout's logo+preview block above the
 * SmartFinder card. No tap interaction — purely informational.
 *
 * Falls back to a quiet "Hole geometry unavailable" placeholder when the
 * upstream lacks tee/green coordinates (the typical golfcourseapi case
 * today). Sizing is fixed so the L1 block doesn't reflow when geometry
 * resolves.
 */
type Props = {
  /** Tap handler — opens the full SmartVision tool for the current hole. */
  onOpenSmartVision?: () => void;
  /** Optional width override (default 320). */
  width?: number;
  /** Optional height override (default 300). */
  height?: number;
};

// 2026-06-14 (audit — perf) — hoisted to MODULE level. It was defined inside the
// render body, so every 4s dot-tick (setTick) created a NEW component type and React
// unmounted/remounted the whole subtree — the hero Image reloaded and ParallaxTilt
// re-subscribed DeviceMotion every tick. A stable module-level component lets React
// reconcile in place. The tap handler is passed as a prop.
const SmartVisionTap: React.FC<{ onPress?: () => void; children: React.ReactNode }> = ({ onPress, children }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={onPress ? 0.85 : 1}
    disabled={!onPress}
    accessibilityRole="button"
    accessibilityLabel="Open SmartVision for this hole"
  >
    {children}
  </TouchableOpacity>
);

export default function L1HolePreview({ onOpenSmartVision, width, height }: Props) {
  const W = width ?? DEFAULT_W;
  const H = height ?? DEFAULT_H;
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);
  // 2026-05-17 — pre-round planning context. When there's no active
  // round but the user has picked a course on the Play tab (sets
  // pendingStartCourseId) or has a home course set, use that course's
  // hole 1 imagery in the L1 preview AND drop the "Start a round to
  // see your hole" gate. Tim's point: "we have save in the upper right
  // corner... I wanted to be able to see the whole view images to
  // preplan around using the measuring tool. Right now, pre round,
  // it's just green screens."
  const pendingStartCourseId = useRoundStore(s => s.pendingStartCourseId);
  const previewCourseId = useRoundStore(s => s.previewCourseId);
  const _homeCourseName = usePlayerProfileStore(s => s.homeCourse);
  // 2026-05-17 — Removed the hard "palms" fallback at the tail of the
  // cascade. Previously when there was no active round, no pending
  // course, no preview, and no home-course set, we'd return the literal
  // string "palms" and getLocalHoleImage would resolve to Palms hole 1.
  // That leaked Palms imagery into every empty state, and in active
  // rounds where activeCourse briefly read null during a state
  // transition. Empty state now renders the explicit "pick a course"
  // copy instead.
  const previewCourseId_resolved: string | null =
    activeCourseId ?? pendingStartCourseId ?? previewCourseId ?? null;
  // 2026-05-17 — Removed the trailing `homeCourseName` fallback. Tim's
  // homeCourse is "Menifee Lakes — Palms", so when the user opens the
  // app WITHOUT first selecting a course on the Play tab, this branch
  // returned a string containing "palms" and getLocalHoleImage
  // substring-matched to PALMS_HOLE_IMAGES — rendering Palms imagery
  // for whatever the user actually thought they were looking at. The
  // empty state is more honest.
  const previewCourseLabel: string | null = (() => {
    if (activeCourse) return activeCourse;
    if (previewCourseId_resolved && previewCourseId_resolved.startsWith('local:')) {
      return previewCourseId_resolved.slice('local:'.length).replace(/-/g, ' ');
    }
    if (previewCourseId_resolved) return previewCourseId_resolved;
    return null;
  })();

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [, setTick] = useState(0);
  // 2026-06-13 (Tim) — course-data bootstrap: prefer a real captured shot of THIS hole
  // (snapped in SmartFinder) over the generic Mapbox tile. Self-built course imagery.
  const captured = useCourseCaptureStore(s => s.bestForward(activeCourseId, currentHole));
  const capturedUri = captured?.kind === 'single' ? captured.uri : null;

  useEffect(() => {
    let cancelled = false;
    if (!activeCourseId) { setGeometry(null); return; }
    const cached = getHoleGeometry(activeCourseId, currentHole);
    if (cached && !cancelled) setGeometry(cached);
    fetchCourseGeometry(activeCourseId).then(full => {
      if (cancelled) return;
      setGeometry(full?.holes.find(h => h.hole_number === currentHole) ?? null);
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  // Player dot refresh tick
  useEffect(() => {
    if (!isRoundActive) return;
    let cancelled = false;
    const tick = async () => {
      await peekFix(); // rides the watch cache — no forced GPS pulse per tick (audit)
      if (!cancelled) setTick(t => t + 1);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isRoundActive]);

  const wrapDims = { width: W, height: H };

  // 2026-05-17 — Pre-round path. Show the selected/planned course's
  // hole 1 imagery if available (so the user can tap into SmartVision
  // and pre-plan with the measuring tool), otherwise fall back to the
  // default preview. The "Start a round to see your hole" copy is
  // replaced with "Tap to plan" — Tim's preplanning workflow.
  if (!isRoundActive) {
    // 2026-05-17 — courseId-first lookup so a planning preview for a
    // local course resolves to that course's imagery (not the
    // home-course substring-match leak). Name-based fallback only when
    // we don't have a local: id.
    const previewImg =
      getLocalHoleImageById(previewCourseId_resolved, 1) ??
      (previewCourseLabel ? getLocalHoleImage(previewCourseLabel, 1) : null);
    const defaultImg = previewImg;
    if (defaultImg) {
      return (
        <SmartVisionTap onPress={onOpenSmartVision}>
          <ImageBackground source={defaultImg} style={[styles.wrap, wrapDims]} imageStyle={styles.imgRadius} resizeMode="cover">
            <View style={styles.imageOverlay}>
              <Text style={styles.imageHoleLabel}>SMARTVISION</Text>
              <Text style={styles.placeholderSubLight}>Tap to plan this hole.</Text>
            </View>
          </ImageBackground>
        </SmartVisionTap>
      );
    }
    return (
      <SmartVisionTap onPress={onOpenSmartVision}>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>SMARTVISION</Text>
          <Text style={styles.placeholderSub}>Pick a course on the Play tab to plan.</Text>
        </View>
      </SmartVisionTap>
    );
  }

  // 2026-05-19 — Curated bundled image takes priority over any aerial/
  // SVG fallback whenever one exists for the course, regardless of
  // whether geometry is loaded. Tim's repeated "the whole view is gone"
  // complaint on Menifee Palms was the geometry-seeded synthetic round
  // bypassing the curated image and falling into the aerial/Mapbox path
  // (which renders a generic green satellite tile). Curated photos
  // are the canonical render for any course that has them; geometry
  // only drives the player-dot overlay coordinates.
  const curatedImage =
    getLocalHoleImageById(activeCourseId, currentHole) ??
    getLocalHoleImage(activeCourse, currentHole);

  // Prefer the player's own captured shot; fall back to the curated bundle. A captured
  // shot (uri) and a curated require() are both valid Image sources.
  const heroImageSource = capturedUri ? ({ uri: capturedUri } as const) : (curatedImage ?? null);

  if (heroImageSource) {
    const fix = getLastFix();
    const holeRecord = useRoundStore.getState().courseHoles.find(h => h.hole === currentHole);
    // Prefer the seeded geometry's tee/green if available; fall back to
    // courseHoles record (Palms has these). Either path produces an
    // axis we can project the player onto.
    const teeLatLng = (geometry?.tee && geometry?.green)
      ? { tee: geometry.tee, green: geometry.green }
      : holeRecord && (holeRecord.teeLat || holeRecord.teeLng) && (holeRecord.middleLat || holeRecord.middleLng)
        ? { tee: { lat: holeRecord.teeLat, lng: holeRecord.teeLng }, green: { lat: holeRecord.middleLat, lng: holeRecord.middleLng } }
        : null;
    let pctAlong: number | null = null;
    let yardsToGreen: number | null = null;
    if (fix && teeLatLng) {
      let total = haversineYards(teeLatLng.tee, teeLatLng.green);
      // 2026-06-12 (Tim's Lakes round) — sanity-check the GPS tee→green against the
      // BUNDLED hole distance. A bad tee MARK (GPS off, or marking the wrong hole's tee)
      // produced a 548y "total" on a 134y par-3, which threw the player-dot position.
      // When the trusted bundled distance disagrees wildly (>1.6× or <0.55×), trust it.
      const bundledDist = holeRecord?.distance;
      if (typeof bundledDist === 'number' && bundledDist > 0 && total > 0 &&
          (total > bundledDist * 1.6 || total < bundledDist * 0.55)) {
        total = bundledDist;
      }
      const fromPlayer = haversineYards(fix.location, teeLatLng.green);
      // 2026-05-19 — Sanity guard. If the player is more than 1500y
      // from the green, it's not a real position — usually means a
      // prior simulator session's fix leaked into a new course's
      // round, or a real GPS coord landed in a synthetic round. Hide
      // the overlay instead of rendering "629,441y" which is
      // meaningless and alarming to the user.
      if (total > 0 && Number.isFinite(fromPlayer) && fromPlayer < 1500) {
        yardsToGreen = Math.round(fromPlayer);
        pctAlong = Math.max(0, Math.min(1, 1 - fromPlayer / total));
      }
    }
    // Vertical position along the photo: hole photos are framed
    // tee-at-bottom, green-at-top. pctAlong=0 at tee → dot near bottom.
    // pctAlong=1 at green → dot near top.
    // 2026-05-19 — Direction was inverted (used 1-pctAlong by mistake).
    // bottom: cartY positions the icon `cartY` px from the bottom of
    // the container, so AT TEE (pctAlong=0) we want cartY small, and
    // AT GREEN (pctAlong=1) we want cartY large.
    const padTop = 8;
    const padBottom = 8;
    const trackHeight = wrapDims.height - padTop - padBottom;
    const cartY = pctAlong != null ? (padBottom + pctAlong * trackHeight) : null;
    return (
      <SmartVisionTap onPress={onOpenSmartVision}>
        <ImageBackground source={heroImageSource} style={[styles.wrap, wrapDims]} imageStyle={styles.imgRadius} resizeMode="cover">
          <View style={styles.imageOverlay}>
            <Text style={styles.imageHoleLabel}>HOLE {currentHole}</Text>
          </View>
          {cartY != null && yardsToGreen != null ? (
            <>
              <View style={[styles.playerCartOnImage, { bottom: cartY, left: wrapDims.width / 2 - 12 }]}>
                <Ionicons name="navigate" size={14} color="#0d1a0d" />
              </View>
              <View style={styles.playerYardageBadge}>
                <Text style={styles.playerYardageText}>{yardsToGreen}y</Text>
              </View>
            </>
          ) : null}
        </ImageBackground>
      </SmartVisionTap>
    );
  }

  if (!geometry || !geometry.tee || !geometry.green) {
    // 2026-05-17 — courseId-first lookup. Falls back to name-based only
    // when no local: id is set (e.g. golfcourseapi-only rounds).
    const localImg =
      getLocalHoleImageById(activeCourseId, currentHole) ??
      getLocalHoleImage(activeCourse, currentHole);
    if (localImg) {
      // 2026-05-18 — Overlay a live player-position indicator on the
      // curated hole image. The image isn't pixel-mapped (we don't know
      // its framing), so we use a horizontal progress bar at the bottom
      // showing how far the player is along the hole's GPS axis plus a
      // small dot tracking it. Lets the user (and the synthetic round
      // harness) eyeball that GPS is updating without opening full
      // SmartVision. Falls back to no overlay when fix or hole record
      // is missing.
      const fix = getLastFix();
      const holeRecord = useRoundStore.getState().courseHoles.find(h => h.hole === currentHole);
      let pctAlong: number | null = null;
      let yardsToGreen: number | null = null;
      if (fix && holeRecord && (holeRecord.teeLat || holeRecord.teeLng) && (holeRecord.middleLat || holeRecord.middleLng)) {
        const tee = { lat: holeRecord.teeLat, lng: holeRecord.teeLng };
        const green = { lat: holeRecord.middleLat, lng: holeRecord.middleLng };
        const total = haversineYards(tee, green);
        const fromPlayer = haversineYards(fix.location, green);
        if (total > 0 && Number.isFinite(fromPlayer)) {
          yardsToGreen = Math.round(fromPlayer);
          pctAlong = Math.max(0, Math.min(1, 1 - fromPlayer / total));
        }
      }
      return (
        <SmartVisionTap onPress={onOpenSmartVision}>
          <ImageBackground source={localImg} style={[styles.wrap, wrapDims]} imageStyle={styles.imgRadius} resizeMode="cover">
            <View style={styles.imageOverlay}>
              <Text style={styles.imageHoleLabel}>HOLE {currentHole}</Text>
            </View>
            {pctAlong != null && yardsToGreen != null ? (
              <>
                <View style={[styles.playerTrackBar, { width: wrapDims.width - 16 }]}>
                  <View style={styles.playerTrackTee} />
                  <View style={styles.playerTrackGreen} />
                  <View style={[styles.playerTrackDot, { left: `${pctAlong * 100}%` }]} />
                </View>
                <View style={styles.playerYardageBadge}>
                  <Text style={styles.playerYardageText}>{yardsToGreen}y</Text>
                </View>
              </>
            ) : null}
          </ImageBackground>
        </SmartVisionTap>
      );
    }
    // No geometry + no curated image. Don't shout "unavailable" — that
    // alarmed Tim ("where did my images go?") when he picked a course
    // whose photo bundle isn't dropped in yet. Show a soft placeholder
    // that names the hole and offers SmartVision as the path forward.
    return (
      <SmartVisionTap onPress={onOpenSmartVision}>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
          <Text style={styles.placeholderSub}>Preview coming for this course.</Text>
          <Text style={styles.placeholderCta}>Tap to open SmartVision →</Text>
        </View>
      </SmartVisionTap>
    );
  }

  let axisYards = haversineYards(geometry.tee, geometry.green);
  // 2026-06-12 (Tim's Lakes round) — same bundled-distance sanity guard as the photo
  // path: a bad tee mark made axisYards read 548y on a 134y par-3 (the satellite/aerial
  // view's hole total + dot scale). Trust the bundled distance when GPS disagrees wildly.
  {
    const bundledDist = useRoundStore.getState().courseHoles.find(h => h.hole === currentHole)?.distance;
    if (typeof bundledDist === 'number' && bundledDist > 0 && axisYards > 0 &&
        (axisYards > bundledDist * 1.6 || axisYards < bundledDist * 0.55)) {
      axisYards = bundledDist;
    }
  }
  if (axisYards <= 0) {
    return (
      <View style={[styles.wrap, styles.placeholder]}>
        <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
      </View>
    );
  }

  const fix = getLastFix();
  const playerProj = fix ? projectToAxis(fix.location, geometry.tee, geometry.green) : null;

  // Fit-to-canvas projection
  const pad = 18;
  const xRange = Math.max(60, (playerProj ? Math.abs(playerProj.x) * 2 : 0) + 60);
  const yRange = axisYards + 40;
  const xScale = (W - pad * 2) / xRange;
  const yScale = (H - pad * 2) / yRange;
  const project = (xYd: number, yYd: number) => ({
    sx: pad + (xYd + xRange / 2) * xScale,
    sy: H - pad - yYd * yScale,
  });
  const teePos = project(0, 0);
  const greenPos = project(0, axisYards);
  const playerPos = playerProj ? project(playerProj.x, playerProj.y) : null;

  return (
    <SmartVisionTap onPress={onOpenSmartVision}>
    <View style={[styles.wrap, wrapDims]}>
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {/* SVG sketch — always dark, no satellite */}
        <>
          <Rect x={0} y={0} width={W} height={H} rx={10} fill="#0a1f12" />
          <Line
            x1={teePos.sx} y1={teePos.sy} x2={greenPos.sx} y2={greenPos.sy}
            stroke="#1e3a28" strokeWidth={1} strokeDasharray="4 4"
          />
          <Circle cx={teePos.sx} cy={teePos.sy} r={4} fill="#6b7280" />
          <SvgText x={teePos.sx} y={teePos.sy + 13} fill="#9ca3af" fontSize={8} textAnchor="middle">TEE</SvgText>
          <Circle cx={greenPos.sx} cy={greenPos.sy} r={7} fill="#003d20" stroke="#00C896" strokeWidth={1.2} />
          <SvgText x={greenPos.sx} y={greenPos.sy - 11} fill="#00C896" fontSize={8} textAnchor="middle">GREEN</SvgText>
        </>
        {/* Player position overlay */}
        {playerPos && (
          <>
            <Path
              d={`M ${playerPos.sx} ${playerPos.sy} L ${greenPos.sx} ${greenPos.sy}`}
              stroke="#F5A623" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.85}
            />
            <Circle cx={playerPos.sx} cy={playerPos.sy} r={5} fill="#F5A623" stroke="#0d1a0d" strokeWidth={1.5} />
          </>
        )}
        <SvgText x={W - pad} y={pad + 2} fill="#fff" fontSize={9} fontWeight="800" textAnchor="end" letterSpacing={1}>
          HOLE {currentHole}
        </SvgText>
      </Svg>
    </View>
    </SmartVisionTap>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0a1f12',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  placeholderText: { color: '#6b7280', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  placeholderCta: { color: '#00C896', fontSize: 11, fontWeight: '700', marginTop: 10 },
  placeholderSub: { color: '#4b5563', fontSize: 11, marginTop: 6, textAlign: 'center' },
  placeholderSubLight: { color: 'rgba(255,255,255,0.85)', fontSize: 11, marginTop: 4, textAlign: 'center' },
  imgRadius: { borderRadius: 10 },
  imageOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  imageHoleLabel: { color: '#ffffff', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  svHint: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0,200,150,0.18)',
    borderWidth: 1,
    borderColor: '#00C896',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  svHintText: { color: '#00C896', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  // 2026-05-18 — Live player-position overlay on curated hole image.
  // Bottom track: tee marker (left), green marker (right), player dot
  // slides between them based on GPS distance-to-green / hole length.
  playerTrackBar: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 3,
    overflow: 'visible',
  },
  playerTrackTee: {
    position: 'absolute',
    left: 0, top: -2, width: 3, height: 10, backgroundColor: '#9ca3af', borderRadius: 1.5,
  },
  playerTrackGreen: {
    position: 'absolute',
    right: 0, top: -2, width: 3, height: 10, backgroundColor: '#00C896', borderRadius: 1.5,
  },
  playerTrackDot: {
    position: 'absolute',
    top: -4,
    width: 14, height: 14, marginLeft: -7,
    backgroundColor: '#F5A623',
    borderRadius: 7,
    borderWidth: 2, borderColor: '#0d1a0d',
  },
  playerYardageBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  playerYardageText: { color: '#F5A623', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
  // 2026-05-19 — Live player cart icon overlaid on the curated hole
  // photo. Moves vertically from tee (bottom) to pin (top) as the
  // player progresses along the GPS axis. Position computed inline at
  // render time.
  playerCartOnImage: {
    position: 'absolute',
    width: 24, height: 24,
    borderRadius: 12,
    backgroundColor: '#F5A623',
    borderWidth: 2, borderColor: '#ffffff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6, shadowRadius: 3, elevation: 8,
  },
});
