/**
 * DispersionMap.tsx — TrackMan-style top-down ball-flight dispersion chart.
 *
 * Layout:  300 × 400 px, bottom = player, top = target.
 * Layers:  background → distance rings → fairway cone → target line →
 *          shot dots → labels → legend.
 */
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Svg, { Circle as SvgCircle, Ellipse as SvgEllipse } from 'react-native-svg';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShotResult = 'left' | 'straight' | 'right';
type ShotTarget = 'left' | 'center' | 'right';
export type ClubType =
  | 'driver' | '3wood' | '5wood'
  | '4iron' | '5iron' | '6iron' | '7iron' | '8iron' | '9iron'
  | 'pw' | 'gw' | 'sw' | 'lw'
  | 'putter';

export interface DispersionShot {
  result: ShotResult;
  target: ShotTarget;
  club?: ClubType;
}

interface DispersionMapProps {
  shots: DispersionShot[];
  /** Pre-select a club filter from outside (optional). */
  initialClub?: ClubType | 'all';
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const W            = 300;           // canvas width
const H            = 400;           // canvas height — portrait, top-down view
const CX           = W / 2;

const PLAYER_Y     = H - 40;        // player icon y-centre (near bottom)
const TARGET_Y     = 32;            // target / flag y (near top)

const SHOT_TOP     = TARGET_Y + 22; // topmost y a shot dot can land
const SHOT_BOTTOM  = PLAYER_Y - 20; // bottommost y a shot dot can land
const SHOT_H       = SHOT_BOTTOM - SHOT_TOP;

const X_SPREAD     = 44;            // px left/right of centre for L/R columns

// Fairway cone half-widths at apex (flag) and base (player)
const CONE_TOP_HW  = 22;
const CONE_BOT_HW  = 82;

const DOT_R        = 7;
const DOT_R_RECENT = 10;
const RECENT_N     = 3;

// ─── Colours ──────────────────────────────────────────────────────────────────

const DOT_COLOR: Record<ShotResult, string> = {
  left:     '#ef4444',
  straight: '#4ade80',
  right:    '#60a5fa',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const xForResult = (r: ShotResult): number =>
  r === 'left' ? CX - X_SPREAD : r === 'right' ? CX + X_SPREAD : CX;

const dominantTarget = (shots: DispersionShot[]): ShotTarget => {
  if (!shots.length) return 'center';
  const c: Record<ShotTarget, number> = { left: 0, center: 0, right: 0 };
  shots.forEach((s) => c[s.target]++);
  if (c.left  > c.center && c.left  > c.right) return 'left';
  if (c.right > c.center && c.right > c.left)  return 'right';
  return 'center';
};

const tlXfor = (t: ShotTarget): number =>
  t === 'left' ? CX - X_SPREAD : t === 'right' ? CX + X_SPREAD : CX;

/**
 * Build per-dot render data.
 *
 * Y mapping: shot index 0 → SHOT_BOTTOM (close to player), last shot → SHOT_TOP
 * (far, near target).  This simulates ball-flight distance so later shots appear
 * further down the fairway — like a TrackMan plot.
 *
 * X: left = CX−X_SPREAD, straight = CX, right = CX+X_SPREAD, plus a small
 * alternating jitter so stacked dots stay visible.
 */
const buildDots = (shots: DispersionShot[]) => {
  const n = shots.length;
  const colCounts: Record<ShotResult, number> = { left: 0, straight: 0, right: 0 };
  shots.forEach((s) => colCounts[s.result]++);

  return shots.map((shot, idx) => {
    const yFrac = n > 1 ? idx / (n - 1) : 0.5;
    const baseY = SHOT_BOTTOM - yFrac * SHOT_H;
    const jitter = (idx % 2 === 0 ? 1 : -1) * 4;
    const x = xForResult(shot.result) + jitter;
    const y = baseY;
    const isRecent  = idx >= n - RECENT_N;
    const clusterOp = Math.min(0.40 + (colCounts[shot.result] / n) * 0.60, 1.0);
    const radius    = isRecent ? DOT_R_RECENT : DOT_R;
    return { x, y, result: shot.result, idx, isRecent, clusterOp, radius };
  });
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function DispersionMap({ shots, initialClub = 'all' }: DispersionMapProps) {
  const [selectedClub, setSelectedClub] = useState<ClubType | 'all'>(initialClub);

  // Clubs that actually appear in the data (preserves insertion order)
  const availableClubs = (['all', ...Array.from(
    new Set(shots.map((s) => s.club).filter(Boolean) as ClubType[])
  )] as (ClubType | 'all')[]);

  // Filtered shot list
  const filtered = selectedClub === 'all'
    ? shots
    : shots.filter((s) => s.club === selectedClub);

  const dots = buildDots(filtered);
  const aim  = dominantTarget(filtered);
  const tlX  = tlXfor(aim);

  const avgOffset = filtered.length === 0 ? null : (() => {
    const offs = filtered.map((s) => xForResult(s.result) - CX);
    return offs.reduce((a, b) => a + b, 0) / offs.length;
  })();

  const biasLabel =
    avgOffset === null    ? null
    : avgOffset >  14     ? { text: 'Bias: Right',   color: '#60a5fa' }
    : avgOffset < -14     ? { text: 'Bias: Left',    color: '#ef4444' }
    : filtered.length > 0 ? { text: 'Bias: Neutral', color: '#4ade80' }
    : null;

  // Cone left/right edge vectors — drawn as rotated 1.5-px wide Views
  const coneEdge = (fromX: number, toX: number) => {
    const dx  = toX  - fromX;
    const dy  = SHOT_BOTTOM - SHOT_TOP;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dx, dy) * (180 / Math.PI);
    return { len, ang, fromX };
  };

  const leftEdge  = coneEdge(CX - CONE_TOP_HW, CX - CONE_BOT_HW);
  const rightEdge = coneEdge(CX + CONE_TOP_HW, CX + CONE_BOT_HW);

  // ── Grouping ellipse stats ───────────────────────────────────────────
  const ellipse = (() => {
    if (dots.length < 2) return null;
    const n    = dots.length;
    const mX   = dots.reduce((s, d) => s + d.x, 0) / n;
    const mY   = dots.reduce((s, d) => s + d.y, 0) / n;
    const varX = dots.reduce((s, d) => s + (d.x - mX) ** 2, 0) / n;
    const varY = dots.reduce((s, d) => s + (d.y - mY) ** 2, 0) / n;
    const rx   = Math.max(Math.sqrt(varX), 10);
    const ry   = Math.max(Math.sqrt(varY), 14);
    return { cx: mX, cy: mY, rx, ry };
  })();

  // ── Heat map: one large, low-opacity glow circle per dot ────────────
  // Overlapping circles at the same location stack to form a hot zone.
  const HEAT_R   = 26;   // glow radius (px)
  const HEAT_OP  = 0.07; // opacity per circle — stacking reveals density

  return (
    <View style={{ alignSelf: 'center' }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
        width: W, marginBottom: 6, paddingHorizontal: 4,
      }}>
        <Text style={{ color: '#6b7280', fontSize: 11, fontWeight: '700', letterSpacing: 0.9 }}>
          DISPERSION
        </Text>
        {biasLabel && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: biasLabel.color }} />
            <Text style={{ color: biasLabel.color, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 }}>
              {biasLabel.text}
            </Text>
          </View>
        )}
        {filtered.length >= 2 && (
          <Text style={{ color: '#525252', fontSize: 10, fontStyle: 'italic' }}>Recent highlighted</Text>
        )}
      </View>

      {/* ── Club filter buttons ────────────────────────────────────── */}
      {availableClubs.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ width: W, marginBottom: 8 }}
          contentContainerStyle={{ paddingHorizontal: 4, gap: 6, flexDirection: 'row' }}
        >
          {availableClubs.map((club) => {
            const active = selectedClub === club;
            const label  = club === 'all' ? 'All' : club.toUpperCase();
            return (
              <TouchableOpacity
                key={club}
                onPress={() => setSelectedClub(club)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: active ? '#4ade80' : '#2a3a2e',
                  backgroundColor: active ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.03)',
                }}
              >
                <Text style={{
                  color: active ? '#4ade80' : '#6b7280',
                  fontSize: 10,
                  fontWeight: active ? '800' : '500',
                  letterSpacing: 0.4,
                }}>
                  {label}
                  {club !== 'all' && (
                    ` (${shots.filter((s) => s.club === club).length})`
                  )}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <View style={{ width: W, height: H, position: 'relative', overflow: 'hidden', borderRadius: 16 }}>

        {/* Background */}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: '#0a1a0f',
          borderRadius: 16,
          borderWidth: 1,
          borderColor: '#1a3a22',
        }} />

        {/* ── Distance rings (horizontal grid) ─────────────────────── */}
        {[0.25, 0.5, 0.75].map((frac, i) => (
          <View key={i} style={{
            position: 'absolute',
            left: 14, right: 14,
            top: SHOT_TOP + frac * SHOT_H - 0.5,
            height: 1,
            backgroundColor: 'rgba(255,255,255,0.07)',
          }} />
        ))}

        {/* ── Fairway cone fill ─────────────────────────────────────── */}
        <View style={{
          position: 'absolute',
          left: CX - CONE_BOT_HW,
          top:  SHOT_TOP,
          width: CONE_BOT_HW * 2,
          height: SHOT_H,
          backgroundColor: 'rgba(74,222,128,0.035)',
        }} />

        {/* ── Fairway cone edges ────────────────────────────────────── */}
        {[leftEdge, rightEdge].map((e, i) => (
          <View key={i} style={{
            position: 'absolute',
            left: e.fromX,
            top:  SHOT_TOP,
            width: 1.5,
            height: e.len,
            backgroundColor: 'rgba(255,255,255,0.14)',
            transformOrigin: 'top left',
            transform: [{ rotate: `${e.ang}deg` }],
          }} />
        ))}

        {/* ── Target line ───────────────────────────────────────────── */}
        <View style={{
          position: 'absolute',
          left:   tlX - 1,
          top:    TARGET_Y + 2,
          bottom: H - SHOT_BOTTOM,
          width:  2,
          backgroundColor: 'rgba(255,255,255,0.60)',
          borderRadius: 1,
        }} />

        {/* ── Flag / target marker ──────────────────────────────────── */}
        <View style={{ position: 'absolute', left: tlX - 1, top: TARGET_Y - 18 }}>
          {/* Pole */}
          <View style={{ width: 1.5, height: 20, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 1 }} />
          {/* Flag */}
          <View style={{
            position: 'absolute', top: 0, left: 2,
            width: 12, height: 8,
            backgroundColor: '#fbbf24',
            borderRadius: 1,
          }} />
        </View>
        <Text style={{
          position: 'absolute',
          top:  TARGET_Y + 4,
          left: aim === 'right' ? tlX - 52 : tlX + 5,
          width: 48,
          textAlign: aim === 'right' ? 'right' : 'left',
          color: 'rgba(255,255,255,0.50)',
          fontSize: 8, fontWeight: '700', letterSpacing: 0.5,
        }}>
          {aim === 'left' ? '← AIM' : aim === 'right' ? 'AIM →' : 'AIM LINE'}
        </Text>

        {/* ── Distance labels (right edge) ──────────────────────────── */}
        {[0.25, 0.5, 0.75].map((frac, i) => (
          <Text key={i} style={{
            position: 'absolute',
            right: 5,
            top: SHOT_TOP + frac * SHOT_H - 7,
            color: 'rgba(255,255,255,0.18)',
            fontSize: 8, fontWeight: '600',
          }}>
            {(3 - i) * 25}yd
          </Text>
        ))}

        {/* ── Column labels (L / C / R) ─────────────────────────────── */}
        {([
          { label: 'L', x: CX - X_SPREAD, result: 'left'     },
          { label: 'C', x: CX,            result: 'straight' },
          { label: 'R', x: CX + X_SPREAD, result: 'right'    },
        ] as { label: string; x: number; result: ShotResult }[]).map(({ label, x, result }) => (
          <Text key={result} style={{
            position: 'absolute',
            top: SHOT_TOP - 14, left: x - 5, width: 10,
            textAlign: 'center',
            color: DOT_COLOR[result],
            fontSize: 9, fontWeight: '800', opacity: 0.45, letterSpacing: 0.5,
          }}>
            {label}
          </Text>
        ))}

        {/* ── Heat map (SVG, below dots) ─────────────────────────────── */}
        {dots.length > 0 && (
          <Svg
            width={W}
            height={H}
            style={{ position: 'absolute', top: 0, left: 0 }}
            pointerEvents="none"
          >
            {dots.map((dot) => (
              <SvgCircle
                key={`heat-${dot.idx}`}
                cx={dot.x}
                cy={dot.y}
                r={HEAT_R}
                fill={DOT_COLOR[dot.result]}
                opacity={HEAT_OP}
              />
            ))}
          </Svg>
        )}

        {/* ── Grouping ellipse (SVG overlay) ────────────────────────── */}
        {ellipse && (
          <Svg
            width={W}
            height={H}
            style={{ position: 'absolute', top: 0, left: 0 }}
            pointerEvents="none"
          >
            <SvgEllipse
              cx={ellipse.cx}
              cy={ellipse.cy}
              rx={ellipse.rx}
              ry={ellipse.ry}
              fill="rgba(255,255,255,0.04)"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          </Svg>
        )}

        {/* ── Shot dots ─────────────────────────────────────────────── */}
        {dots.map((dot) => (
          <View
            key={dot.idx}
            style={{
              position: 'absolute',
              left:   dot.x - dot.radius,
              top:    dot.y - dot.radius,
              width:  dot.radius * 2,
              height: dot.radius * 2,
              borderRadius: dot.radius,
              backgroundColor: DOT_COLOR[dot.result],
              opacity: dot.clusterOp,
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth:  dot.isRecent ? 1.5 : 0,
              borderColor:  'rgba(255,255,255,0.85)',
              shadowColor:  dot.isRecent ? DOT_COLOR[dot.result] : 'transparent',
              shadowOpacity: dot.isRecent ? 0.75 : 0,
              shadowRadius:  dot.isRecent ? 4    : 0,
              elevation:     dot.isRecent ? 4    : 0,
            }}
          >
            <Text style={{
              color: '#000',
              fontSize: dot.isRecent ? 8 : 6,
              fontWeight: '900',
              lineHeight: dot.isRecent ? 9 : 7,
            }}>
              {dot.result === 'left' ? 'L' : dot.result === 'right' ? 'R' : '●'}
            </Text>
          </View>
        ))}

        {/* ── Player marker ─────────────────────────────────────────── */}
        <View style={{
          position: 'absolute',
          left: CX - 9, top: PLAYER_Y - 9,
          width: 18, height: 18, borderRadius: 9,
          backgroundColor: '#0f2a1a',
          borderWidth: 1.5, borderColor: '#4ade80',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 10, lineHeight: 11 }}>🏌️</Text>
        </View>
        <Text style={{
          position: 'absolute',
          top: PLAYER_Y + 11, left: CX - 16, width: 32,
          textAlign: 'center',
          color: 'rgba(167,243,208,0.30)',
          fontSize: 8, fontWeight: '700', letterSpacing: 0.4,
        }}>
          YOU
        </Text>

        {/* ── Empty state ───────────────────────────────────────────── */}
        {filtered.length === 0 && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            justifyContent: 'center', alignItems: 'center',
          }}>
            <Text style={{ color: '#3a5a44', fontSize: 13, fontStyle: 'italic' }}>
              No shots yet
            </Text>
          </View>
        )}

      </View>{/* end canvas */}

      {/* ── Legend ─────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 }}>
        {(Object.entries(DOT_COLOR) as [ShotResult, string][]).map(([result, color]) => (
          <View key={result} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
            <Text style={{ color: '#6b7280', fontSize: 10, textTransform: 'capitalize' }}>{result}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}


