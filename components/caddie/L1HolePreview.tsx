import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ImageBackground, Image, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText, Path } from 'react-native-svg';
import { useRoundStore } from '../../store/roundStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { getHoleGeometry, fetchCourseGeometry, type HoleGeometry } from '../../services/courseGeometryService';
import { refreshFix, getLastFix } from '../../services/smartFinderService';
import { haversineYards, projectToAxis } from '../../utils/geoDistance';
import { getHoleThumbnailUrl } from '../../services/mapboxImagery';

// Curated screenshot fallback for local courses Tim has playtested. The
// Palms set is bundled today; Lakes and Rancho California maps are
// registered as empty so dropping `assets/courses/lakes/hole-XX.jpg` /
// `assets/courses/rancho-california/hole-XX.jpg` files later picks them
// up without further code changes (just add the require() entries here).
import { getLocalHoleImage, getLocalHoleImageById } from '../../data/localCourseImages';

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
  const homeCourseName = usePlayerProfileStore(s => s.homeCourse);
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
  const previewCourseLabel: string | null = (() => {
    if (activeCourse) return activeCourse;
    if (previewCourseId_resolved && previewCourseId_resolved.startsWith('local:')) {
      return previewCourseId_resolved.slice('local:'.length).replace(/-/g, ' ');
    }
    if (previewCourseId_resolved) return previewCourseId_resolved;
    if (homeCourseName) return homeCourseName;
    return null;
  })();

  const [geometry, setGeometry] = useState<HoleGeometry | null>(null);
  const [, setTick] = useState(0);

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
      await refreshFix();
      if (!cancelled) setTick(t => t + 1);
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [isRoundActive]);

  // The preview is wrapped in a tappable that launches the full SmartVision
  // tool for the current hole. Body content varies by data availability.
  const SmartVisionTap: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <TouchableOpacity
      onPress={onOpenSmartVision}
      activeOpacity={onOpenSmartVision ? 0.85 : 1}
      disabled={!onOpenSmartVision}
      accessibilityRole="button"
      accessibilityLabel="Open SmartVision for this hole"
    >
      {children}
    </TouchableOpacity>
  );

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
        <SmartVisionTap>
          <ImageBackground source={defaultImg} style={[styles.wrap, wrapDims]} imageStyle={styles.imgRadius} resizeMode="cover">
            <View style={styles.imageOverlay}>
              <Text style={styles.imageHoleLabel}>SMARTVISION</Text>
              <Text style={styles.placeholderSubLight}>
                {previewImg ? 'Tap to plan this hole.' : 'Pick a course to plan.'}
              </Text>
            </View>
          </ImageBackground>
        </SmartVisionTap>
      );
    }
    return (
      <SmartVisionTap>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>SMARTVISION</Text>
          <Text style={styles.placeholderSub}>Pick a course on the Play tab to plan.</Text>
        </View>
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
      return (
        <SmartVisionTap>
          <ImageBackground source={localImg} style={[styles.wrap, wrapDims]} imageStyle={styles.imgRadius} resizeMode="cover">
            <View style={styles.imageOverlay}>
              <Text style={styles.imageHoleLabel}>HOLE {currentHole}</Text>
            </View>
          </ImageBackground>
        </SmartVisionTap>
      );
    }
    // No geometry + no curated image. Don't shout "unavailable" — that
    // alarmed Tim ("where did my images go?") when he picked a course
    // whose photo bundle isn't dropped in yet. Show a soft placeholder
    // that names the hole and offers SmartVision as the path forward.
    return (
      <SmartVisionTap>
        <View style={[styles.wrap, wrapDims, styles.placeholder]}>
          <Text style={styles.placeholderText}>HOLE {currentHole}</Text>
          <Text style={styles.placeholderSub}>Preview coming for this course.</Text>
          <Text style={styles.placeholderCta}>Tap to open SmartVision →</Text>
        </View>
      </SmartVisionTap>
    );
  }

  const axisYards = haversineYards(geometry.tee, geometry.green);
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

  // Mapbox aerial as substrate (when configured + geometry available).
  // Falls back to the green SVG sketch when Mapbox returns null.
  const aerialUrl = getHoleThumbnailUrl({
    courseId: activeCourseId,
    holeNumber: currentHole,
    par: 4,
    yardage: axisYards,
    tee: geometry.tee,
    green: geometry.green,
  }, W, H);

  return (
    <SmartVisionTap>
    <View style={[styles.wrap, wrapDims]}>
      {aerialUrl ? (
        <Image source={{ uri: aerialUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      <Svg width={W} height={H} style={StyleSheet.absoluteFill}>
        {/* Quiet sketch only when no aerial — otherwise the aerial IS the substrate */}
        {!aerialUrl && (
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
        )}
        {/* Player position overlay — lives over either substrate */}
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
});
