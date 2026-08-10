import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ImageBackground, StyleSheet, Image, type ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { getHoleGeometry, fetchCourseGeometry, type HoleGeometry } from '../../services/courseGeometryService';
import { peekFix, getLastFix, resolveGreenCoords } from '../../services/smartFinderService';
import { haversineYards, projectToAxis } from '../../utils/geoDistance';

// Curated screenshot fallback for local courses Tim has playtested. The
// Palms set is bundled today; Lakes and Rancho California maps are
// registered as empty so dropping `assets/courses/lakes/hole-XX.jpg` /
// `assets/courses/rancho-california/hole-XX.jpg` files later picks them
// up without further code changes (just add the require() entries here).
import { getLocalHoleImage, getLocalHoleImageById } from '../../data/localCourseImages';
import { getBundledHoles, COURSES } from '../../data/courses';
import { HoleBrandBadge } from './HoleBrandBadge';
import { useCourseCaptureStore } from '../../store/courseCaptureStore';
import { resolveCaptureUri } from '../../services/courseCaptureIngest';
import { getHoleImageryUrl } from '../../services/mapboxImagery';

const REFRESH_MS = 4_000;
const DEFAULT_W = 320;
const DEFAULT_H = 300;

/**
 * L1 (Quiet) hole preview — a glanceable top-down sketch of the current hole
 * (tee at bottom, green at top, dashed centerline, player dot when GPS is
 * available). Falls back to a quiet "Hole geometry unavailable" placeholder
 * when the upstream lacks tee/green coordinates.
 *
 * 2026-07-28 (Tim — "off-center / containment isn't right" + "white on either side") — containment
 * fixes: (1) the box MEASURES its own laid-out size via onLayout instead of trusting the width prop
 * (which lags the native re-layout across a Fold transition → off-center + one-sided blank band);
 * (2) a curated crop is fit into a box of ITS OWN natural aspect and centered (cover == contain — the
 * whole hole stays visible, no crop) instead of the box taking the screen's aspect and cropping the
 * art. Our bundled crops are NOT all 2:3 (they range 2:3 → 2.6:1 → 1:1), so the aspect is read per
 * image via Image.resolveAssetSource rather than hard-coded. Non-curated sources (captured aerials,
 * the SVG sketch, placeholders) fill the box.
 */
type Props = {
  /** Tap handler — opens the full SmartVision tool for the current hole. */
  onOpenSmartVision?: () => void;
  /** Optional width override (first-render fallback; the box then measures its real size). */
  width?: number;
  /** Optional height override (first-render fallback; the box then measures its real size). */
  height?: number;
  /**
   * Top inset (px) for the branded HoleBrandBadge. Default 8. The full-size Caddie-tab preview
   * passes a larger value so the badge tucks BELOW the ••• tools pill in the upper-right (Tim:
   * "tools pill … upper right … smartvision data … below that pill"). The corner mini + SmartVision
   * have no pill in the way, so they keep the default.
   */
  badgeTop?: number;
};

/** Natural aspect (height / width) of a bundled require() image (a number id); null for a uri/unknown. */
function imageAspect(src: ImageSourcePropType | null | undefined): number | null {
  if (typeof src !== 'number') return null; // captured uri / array / null → measured elsewhere / fill
  try {
    const r = Image.resolveAssetSource(src);
    if (r && r.width > 0 && r.height > 0) return r.height / r.width;
  } catch { /* ignore */ }
  return null;
}

/**
 * Fit a box of the given natural aspect (h/w) inside w×h and center it (CONTAIN — whole image, no
 * crop). A null aspect (captured aerial / unknown) fills w×h.
 */
function buildHoleBox(aspect: number | null, w: number, h: number): { width: number; height: number } {
  if (!aspect || aspect <= 0) return { width: w, height: h };
  let bw = w;
  let bh = Math.round(w * aspect);
  if (bh > h) { bh = h; bw = Math.round(h / aspect); }
  return { width: bw, height: bh };
}

// 2026-06-14 (audit — perf) — hoisted to MODULE level so the 4s dot-tick doesn't remount the subtree.
// 2026-07-28 — now the measuring + centering frame: it FILLS its parent (so the true container size
// is used, not a lagging width prop), reports its measured size, and centers the aspect-locked child.
const HoleFrame: React.FC<{
  onPress?: () => void;
  onLayout?: (w: number, h: number) => void;
  children: React.ReactNode;
}> = ({ onPress, onLayout, children }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={onPress ? 0.85 : 1}
    disabled={!onPress}
    accessibilityRole="button"
    accessibilityLabel="Open SmartVision for this hole"
    style={styles.frame}
    onLayout={onLayout ? (e) => onLayout(e.nativeEvent.layout.width, e.nativeEvent.layout.height) : undefined}
  >
    {children}
  </TouchableOpacity>
);

export default function L1HolePreview({ onOpenSmartVision, width, height, badgeTop = 8 }: Props) {
  const propW = width ?? DEFAULT_W;
  const propH = height ?? DEFAULT_H;
  // Measured container size — the source of truth once laid out (robust to Fold resize). The width/
  // height props are only the first-render fallback before onLayout fires.
  const [dims, setDims] = useState({ w: propW, h: propH });
  const setMeasuredDims = useCallback((w: number, h: number) => {
    if (w > 0 && h > 0) setDims(prev => (Math.abs(prev.w - w) > 1 || Math.abs(prev.h - h) > 1 ? { w, h } : prev));
  }, []);
  const W = dims.w;
  const H = dims.h;
  const wrapDims = { width: W, height: H };

  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const currentHole = useRoundStore(s => s.currentHole);
  const activeCourseId = useRoundStore(s => s.activeCourseId);
  const activeCourse = useRoundStore(s => s.activeCourse);
  const pendingStartCourseId = useRoundStore(s => s.pendingStartCourseId);
  const previewCourseId = useRoundStore(s => s.previewCourseId);
  const _homeCourseName = usePlayerProfileStore(s => s.homeCourse);
  const previewCourseId_resolved: string | null =
    activeCourseId ?? pendingStartCourseId ?? previewCourseId ?? null;
  const previewCourseLabel: string | null = (() => {
    if (activeCourse) return activeCourse;
    if (previewCourseId_resolved && previewCourseId_resolved.startsWith('local:')) {
      // 2026-07-28 (audit — DISCO-F5) — use the REAL course name ("Coyote Creek (Tournament)") from
      // COURSES rather than a lowercase de-slugified guess ("coyote creek tournament").
      const slug = previewCourseId_resolved.slice('local:'.length);
      const real = COURSES.find(c => c.id === slug)?.name;
      return real ?? slug.replace(/-/g, ' ');
    }
    if (previewCourseId_resolved) return previewCourseId_resolved;
    return null;
  })();

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [, setTick] = useState(0);
  // 2026-06-13 (Tim) — course-data bootstrap: prefer a real captured shot of THIS hole
  // (snapped in SmartFinder) over the generic Mapbox tile. Self-built course imagery.
  const captured = useCourseCaptureStore(s => s.bestForward(activeCourseId, currentHole));
  const capturedUri = captured?.kind === 'single' ? resolveCaptureUri(captured.uri) : null;

  useEffect(() => {
    let cancelled = false;
    if (!activeCourseId) { setGeometry(null); return; }
    const cached = getHoleGeometry(activeCourseId, currentHole);
    if (cached && !cancelled) setGeometry(cached);
    fetchCourseGeometry(activeCourseId).then(() => {
      if (cancelled) return;
      // 2026-08-08 (wave-2 audit — twice-around clobber): resolve via getHoleGeometry (owns the
      // 10-18→1-9 wrap); the raw .find missed holes 10-18 and nulled the flyover on the second loop.
      setGeometry(getHoleGeometry(activeCourseId, currentHole));
    });
    return () => { cancelled = true; };
  }, [activeCourseId, currentHole]);

  /**
   * 2026-08-10 (Tim, playing Connecticut National — "back at the main caddy tab, I still get green
   * screen", while tapping through to full SmartVision showed the real hole).
   *
   * ROOT CAUSE: this preview's ONLY imagery sources were a player-captured aerial and a curated
   * BUNDLED hole photo. SmartVision has a third one — the Mapbox satellite tile built from the hole's
   * tee/green geometry (getHoleImageryUrl) — and this component never had it. So on any course we
   * don't ship photos for (i.e. every course resolved live through the download engine), the preview
   * fell straight past both sources to the SVG sketch, whose backdrop is a dark-green <Rect>. That
   * green rectangle IS the "green screen" — not a load failure, a missing source.
   *
   * Reusing the same builder SmartVision calls keeps the two views on one projection (identical
   * center/zoom/tee→green bearing), so the preview can't disagree with the screen it opens into.
   * Null (Mapbox unconfigured / no valid green) → unchanged SVG-sketch behavior.
   *
   * Hook placement is deliberate: ABOVE the `!isRoundActive` early return, with the other hooks —
   * a hook below a gate is what crashed SmartMotion on open ([[analysis-wow-wave-2026-08-09]]).
   */
  const aerialTileUrl = useMemo(() => {
    if (!geometry?.green) return null;
    try {
      return getHoleImageryUrl(
        {
          courseId: activeCourseId,
          holeNumber: currentHole,
          tee: geometry.tee ?? null,
          green: geometry.green,
          par: geometry.par,
          yardage: geometry.yardage,
        },
        { width: Math.round(Math.max(320, Math.min(W, 1280))), height: Math.round(Math.max(240, Math.min(H, 1280))) },
      );
    } catch {
      return null;
    }
  }, [geometry, W, H, activeCourseId, currentHole]);

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

  // 2026-05-17 — Pre-round path. Show the selected/planned course's hole 1 imagery if available
  // (curated 2:3 crop → aspect-locked + centered), else a soft placeholder.
  if (!isRoundActive) {
    const previewImg =
      getLocalHoleImageById(previewCourseId_resolved, 1) ??
      (previewCourseLabel ? getLocalHoleImage(previewCourseLabel, 1) : null);
    if (previewImg) {
      const box = buildHoleBox(imageAspect(previewImg), W, H);
      // Pre-round hole-1 distance for the branded badge (bundled data; null for non-local courses).
      const previewDist = (() => {
        try { return getBundledHoles(previewCourseId_resolved || '')?.find(h => h.hole === 1)?.distance ?? null; }
        catch { return null; }
      })();
      return (
        <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
          <ImageBackground source={previewImg} style={[styles.wrap, box]} imageStyle={styles.imgRadius} resizeMode="cover">
            {/* 2026-07-25 (Tim — "540 bleeds through the card") — the curated hole JPG has the yardage
                printed on it, which showed through behind the label. A bottom-up scrim seats the text
                on a clean dark base so only OUR label reads, not the baked-in number. */}
            <View style={styles.planScrim} pointerEvents="none" />
            <View style={styles.planLabelWrap} pointerEvents="none">
              <Text style={styles.placeholderSubLight}>Tap to plan this hole.</Text>
            </View>
          </ImageBackground>
          {/* 2026-07-28 (Tim — "branded badge not showing") — the Course/Hole/Distance badge was only on
              the in-round branches, so browsing the Caddie tab pre-round showed no badge. Add it here too
              (previewing hole 1 of the selected course), frame-level so it clears the ••• tools pill. */}
          <HoleBrandBadge course={previewCourseLabel} hole={1} distanceYds={previewDist} style={{ top: badgeTop, right: 8 }} />
        </HoleFrame>
      );
    }
    return (
      <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>SMARTVISION</Text>
          <Text style={styles.placeholderSub}>Pick a course on the Play tab to plan.</Text>
        </View>
      </HoleFrame>
    );
  }

  // Curated bundled image takes priority over any aerial/SVG fallback whenever one exists.
  const curatedImage =
    getLocalHoleImageById(activeCourseId, currentHole) ??
    getLocalHoleImage(activeCourse, currentHole);

  // Prefer the player's own captured shot, then the curated bundle, then the SAME Mapbox satellite
  // tile SmartVision renders (2026-08-10 green-screen fix — see aerialTileUrl above). Only when all
  // three are absent do we fall through to the SVG sketch.
  // NOTE: the captured-shot ternary stays on ONE line — scripts/simulations/run-sim.ts asserts this
  // exact precedence (`capturedUri ? ({ uri: capturedUri }`) to lock "your own photo always wins".
  const heroImageSource: ImageSourcePropType | null = capturedUri ? ({ uri: capturedUri } as const) : (curatedImage ?? (aerialTileUrl ? ({ uri: aerialTileUrl } as const) : null));

  if (heroImageSource) {
    // A curated crop (require) → aspect-lock to its natural aspect; a captured aerial (uri) → fill.
    const box = buildHoleBox(imageAspect(heroImageSource), W, H);
    const fix = getLastFix();
    const holeRecord = useRoundStore.getState().courseHoles.find(h => h.hole === currentHole);
    const resolvedGreen = (() => { try { return resolveGreenCoords(currentHole).middle; } catch { return null; } })();
    const previewGreen = resolvedGreen ?? geometry?.green ?? null;
    const teeLatLng = (geometry?.tee && previewGreen)
      ? { tee: geometry.tee, green: previewGreen }
      : holeRecord && (holeRecord.teeLat || holeRecord.teeLng) && (previewGreen || holeRecord.middleLat || holeRecord.middleLng)
        ? { tee: { lat: holeRecord.teeLat, lng: holeRecord.teeLng }, green: previewGreen ?? { lat: holeRecord.middleLat, lng: holeRecord.middleLng } }
        : null;
    let pctAlong: number | null = null;
    let yardsToGreen: number | null = null;
    if (fix && teeLatLng) {
      let total = haversineYards(teeLatLng.tee, teeLatLng.green);
      const bundledDist = holeRecord?.distance;
      if (typeof bundledDist === 'number' && bundledDist > 0 && total > 0 &&
          (total > bundledDist * 1.6 || total < bundledDist * 0.55)) {
        total = bundledDist;
      }
      const fromPlayer = haversineYards(fix.location, teeLatLng.green);
      if (total > 0 && Number.isFinite(fromPlayer) && fromPlayer < 1500) {
        yardsToGreen = Math.round(fromPlayer);
        pctAlong = Math.max(0, Math.min(1, 1 - fromPlayer / total));
      }
    }
    // Vertical position along the photo: tee at bottom (pctAlong=0), green at top (pctAlong=1).
    const padTop = 8;
    const padBottom = 8;
    const trackHeight = box.height - padTop - padBottom;
    const cartY = pctAlong != null ? (padBottom + pctAlong * trackHeight) : null;
    return (
      <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
        <ImageBackground source={heroImageSource} style={[styles.wrap, box]} imageStyle={styles.imgRadius} resizeMode="cover">
          {cartY != null && yardsToGreen != null ? (
            <>
              <View style={[styles.playerCartOnImage, { bottom: cartY, left: box.width / 2 - 12 }]}>
                <Ionicons name="navigate" size={14} color="#0d1a0d" />
              </View>
              <View style={styles.playerYardageBadge}>
                <Text style={styles.playerYardageText}>{yardsToGreen}y</Text>
              </View>
            </>
          ) : null}
        </ImageBackground>
        {/* Branded badge is a FRAME child (full width), not inside the centered/narrower image box —
            so it pins to the card's true top-right and clears the ••• tools pill (badgeTop). */}
        <HoleBrandBadge course={activeCourse} hole={currentHole} distanceYds={holeRecord?.distance ?? null} style={{ top: badgeTop, right: 8 }} />
      </HoleFrame>
    );
  }

  if (!geometry || !geometry.tee || !geometry.green) {
    const localImg =
      getLocalHoleImageById(activeCourseId, currentHole) ??
      getLocalHoleImage(activeCourse, currentHole);
    if (localImg) {
      const box = buildHoleBox(imageAspect(localImg), W, H);
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
        <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
          <ImageBackground source={localImg} style={[styles.wrap, box]} imageStyle={styles.imgRadius} resizeMode="cover">
            {pctAlong != null && yardsToGreen != null ? (
              <>
                <View style={[styles.playerTrackBar, { width: box.width - 16 }]}>
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
          <HoleBrandBadge course={activeCourse} hole={currentHole} distanceYds={holeRecord?.distance ?? null} style={{ top: badgeTop, right: 8 }} />
        </HoleFrame>
      );
    }
    // No geometry + no curated image — soft placeholder.
    return (
      <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
          <Text style={styles.placeholderSub}>Preview coming for this course.</Text>
          <Text style={styles.placeholderCta}>Tap to open SmartVision →</Text>
        </View>
      </HoleFrame>
    );
  }

  let axisYards = haversineYards(geometry.tee, geometry.green);
  {
    const bundledDist = useRoundStore.getState().courseHoles.find(h => h.hole === currentHole)?.distance;
    if (typeof bundledDist === 'number' && bundledDist > 0 && axisYards > 0 &&
        (axisYards > bundledDist * 1.6 || axisYards < bundledDist * 0.55)) {
      axisYards = bundledDist;
    }
  }
  // 2026-07-20 (white-screen guard) — `!(axisYards > 0)` rejects NaN/Infinity before they reach SVG.
  if (!(axisYards > 0)) {
    return (
      <View style={[styles.wrap, wrapDims, styles.placeholder]}>
        <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
      </View>
    );
  }

  const fix = getLastFix();
  const rawProj = fix ? projectToAxis(fix.location, geometry.tee, geometry.green) : null;
  // Drop a non-finite fix (render the hole without the you-are-here dot) — SVG NaN white-screen guard.
  const playerProj = rawProj && Number.isFinite(rawProj.x) && Number.isFinite(rawProj.y) ? rawProj : null;

  // Fit-to-canvas projection (the SVG sketch fills the measured box).
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
    <HoleFrame onPress={onOpenSmartVision} onLayout={setMeasuredDims}>
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
    </HoleFrame>
  );
}

const styles = StyleSheet.create({
  // 2026-07-28 — fills the parent + centers the aspect-locked hole box (so a curated 2:3 crop is
  // contained, not screen-aspect-cropped). Dark bg shows as clean letterbox bars around the crop.
  frame: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a1f12',
    borderRadius: 10,
    overflow: 'hidden',
  },
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
  planScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,15,9,0.42)' },
  planLabelWrap: { position: 'absolute', left: 8, bottom: 8, right: 8 },
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
