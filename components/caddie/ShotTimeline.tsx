/**
 * 2026-05-25 — Fix X: in-round shot timeline for the Caddie tab.
 *
 * Tim's note from tonight's Palms round: "the dashboard did show me
 * what my recorded shots were that I said... this was very cool and
 * needs to show cleanly on the caddie tab. v1 of the app months ago
 * would show shot by shot and worked well for analysis using icons
 * with and numbers."
 *
 * This component renders a compact scrolling timeline of round shots,
 * newest first, with one row per shot:
 *   [club icon] [hole #] [club label] [distance] [outcome chip]
 *
 * Pulls from roundStore.shots directly so it stays in sync with voice-
 * logged + scorecard-logged shots without prop drilling. Hides itself
 * when there are zero shots logged (no empty section noise during a
 * fresh round).
 *
 * Filtering: defaults to ALL shots in the active round (cap MAX_ROWS so
 * the strip doesn't dominate the Caddie tab on a long round). Can be
 * narrowed to current-hole-only via the optional `holeOnly` prop if
 * we want a per-hole variant later.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoundStore, type ShotResult } from '../../store/roundStore';
import { useTranslation } from 'react-i18next';
import { shotDistanceDisplay } from '../../services/puttUnits';
import { useDistanceUnit } from '../../hooks/useDistanceUnit';
import { recentShotFacts, type RecentShotFacts } from '../../services/round/recentShots';
import { clubLabel } from '../../services/clubRecognition';

interface Props {
  /** Optional cap on rows rendered. Default 8 — enough to see the
   *  current hole's shots plus a couple from the prior hole at a
   *  glance without overwhelming the Caddie tab. */
  maxRows?: number;
  /** When true, only show shots from the current hole. */
  holeOnly?: boolean;
  /**
   * The shots to draw. Omit for the live round — right for the Caddie tab and the shot log, where
   * "the round you are playing" is what the player means. The Dashboard passes its own pool so that
   * "RECENT SHOTS" keeps meaning your recent shots when no round is in progress.
   */
  shots?: readonly ShotResult[];
  /**
   * 2026-09-29 — what these shots ARE ("THIS ROUND", "LAST ROUND · SEP 20"). The Dashboard's pool can
   * be the live round or a finished one, and a list that does not say which lets last week's shots
   * pass for today's. Omitted → the generic "SHOTS" header.
   */
  label?: string;
}

const DEFAULT_MAX_ROWS = 8;

// Club → icon mapping. Wood/iron/wedge/putter each gets a distinct
// glyph so the user can scan the column at a glance.
// 2026-09-29 — a shot with no club logged is still a shot; it is NOT a question. This returned
// 'help-outline' — a "?" glyph — for every club-less row, and quick-score placeholders made those
// most of the card. A neutral marker now; the row says in words what is missing.
function clubIcon(club: string | null): keyof typeof Ionicons.glyphMap {
  if (!club) return 'ellipse-outline';
  const c = club.toLowerCase();
  if (c.includes('putter') || c === 'p') return 'flag-outline';
  if (c.includes('wedge') || /\b(sw|pw|gw|lw|aw)\b/.test(c)) return 'leaf-outline';
  if (c.includes('driver') || c === 'd' || c === '1w') return 'rocket-outline';
  if (c.includes('wood') || /\b\dw\b/.test(c)) return 'flash-outline';
  return 'golf-outline'; // iron / hybrid / default
}

// Outcome → { label, color }. Penalties get amber/red; clean gets green.
function outcomeChip(outcome: ShotResult['outcome'] | null | undefined): {
  label: string;
  color: string;
  bg: string;
} | null {
  if (!outcome || outcome === 'clean') return null;
  switch (outcome) {
    case 'water':
      return { label: 'water', color: '#60a5fa', bg: '#1e3a8a44' };
    case 'ob':
      return { label: 'OB', color: '#ef4444', bg: '#7f1d1d44' };
    case 'hazard_drop':
      return { label: 'hazard', color: '#f59e0b', bg: '#78350f44' };
    case 'unplayable':
      return { label: 'unplayable', color: '#f59e0b', bg: '#78350f44' };
    case 'lost':
      return { label: 'lost', color: '#ef4444', bg: '#7f1d1d44' };
    default:
      return { label: String(outcome), color: '#c2cad4', bg: '#37415144' };
  }
}

// Compact direction badge: hooks/slices/etc. Returns null when straight
// or absent so we don't clutter the row.
function directionTag(direction: ShotResult['direction'] | null | undefined): string | null {
  if (!direction || direction === 'straight') return null;
  return String(direction);
}

/**
 * The line under the club: every result fact the row carries. A club-less row (a cockpit quick tap)
 * may carry ONLY its direction — "straight" included — or only "short of target", and those were
 * never drawn at all; the row showed a "?" and two dashes over the one thing that was known.
 */
function resultLine(f: RecentShotFacts): string | null {
  const dir = f.club || f.clubAsLogged ? directionTag(f.direction) : f.direction;
  const parts = [dir, f.outcomeText].filter((p): p is string => !!p);
  if (parts.length === 0 && f.feel) parts.push(f.feel);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * 2026-09-13 (Tim, dashboard review) — RECENT SHOTS RENDERED AS A HEADING WITH NOTHING UNDER IT.
 *
 * Two owners of "your recent shots". The Dashboard's gate falls back to the LAST COMPLETED ROUND's
 * shots when no round is live, so with rounds logged it is non-empty and the "no shots logged yet"
 * empty state is skipped — while this component read `useRoundStore(s => s.shots)`, the ACTIVE
 * round only, found none off the course, and returned null. Heading, then nothing, then the next
 * section. The screen promised a thing it had already decided not to draw.
 *
 * `shots` is now an optional prop: a caller that already knows WHICH shots it means passes them,
 * and the live-round default stays for the caddie tab and the shot log, where "the round you are
 * playing" is the right answer. One source per caller, chosen by the caller.
 * [[two-owners-is-the-root-cause]]
 */
export default function ShotTimeline({ maxRows = DEFAULT_MAX_ROWS, holeOnly = false, shots: shotsProp, label }: Props) {
  const distanceUnit = useDistanceUnit();
  const { t } = useTranslation();
  const liveShots = useRoundStore(s => s.shots);
  const currentHole = useRoundStore(s => s.currentHole);
  const shots = shotsProp ?? liveShots;

  /**
   * 2026-09-29 — only rows that ARE shots, each reduced to what is known about it (services/round/
   * recentShots, the one owner). Quick-score placeholders and penalty strokes are not shots; a row
   * with no fact yet has nothing to show. The count in the header counts the same rows.
   */
  const { rows, total } = useMemo(() => {
    const scoped = holeOnly ? shots.filter(s => s.hole === currentHole) : shots;
    const facts = scoped.map(recentShotFacts).filter((f): f is RecentShotFacts => f != null);
    return { rows: facts.slice(-maxRows).reverse(), total: facts.length };
  }, [shots, currentHole, holeOnly, maxRows]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>{label ?? t('caddie_shot_timeline.shot_timeline.shots')}</Text>
        <Text style={styles.headerCount}>{t('caddie_shot_timeline.shot_timeline.of', { shown: rows.length, total })}</Text>
      </View>
      <ScrollView
        horizontal={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight: 240 }}
      >
        {rows.map((shot, i) => {
          const club = shot.club ?? shot.clubAsLogged;
          const icon = clubIcon(club);
          // 2026-09-13 (Tim) — "putts should be always in Feet." Every row said "yds", so a putt
          // logged from eight yards out read "8 yds" instead of the twenty-four-footer it was.
          // 2026-09-29 — the distance is the one recentShotFacts derives (said → GPS back-fill →
          // start/end locations); when none exists the column stays EMPTY, never a dash and a unit.
          const dist = shotDistanceDisplay(club, shot.distanceYards, distanceUnit);
          const result = resultLine(shot);
          const oc = outcomeChip(shot.outcome);
          return (
            <View key={shot.id ?? i} style={styles.row}>
              <View style={styles.iconCol}>
                <Ionicons name={icon} size={18} color="#00C896" />
                <Text style={styles.holeBadge}>{shot.hole}</Text>
              </View>
              <View style={styles.clubCol}>
                {club ? (
                  <Text style={styles.clubLabel} numberOfLines={1}>{shot.club ? clubLabel(shot.club) : club}</Text>
                ) : (
                  <Text style={[styles.clubLabel, styles.clubMissing]} numberOfLines={1}>
                    {t('caddie_shot_timeline.shot_timeline.club_not_logged')}
                  </Text>
                )}
                {result ? <Text style={styles.dirLabel}>{result}</Text> : null}
              </View>
              <View style={styles.distCol}>
                {dist ? (
                  <>
                    <Text style={styles.distValue}>{dist.value}</Text>
                    <Text style={styles.distUnit}>{dist.unit}</Text>
                  </>
                ) : null}
              </View>
              {oc ? (
                <View style={[styles.chip, { backgroundColor: oc.bg, borderColor: oc.color }]}>
                  <Text style={[styles.chipLabel, { color: oc.color }]}>{oc.label}</Text>
                </View>
              ) : (
                <View style={styles.chip} />
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#0d2418',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLabel: { color: '#00C896', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  headerCount: { color: '#64748b', fontSize: 11, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#1e3a28',
    gap: 10,
  },
  iconCol: { width: 36, alignItems: 'center' },
  holeBadge: { color: '#bcc6d3', fontSize: 10, fontWeight: '700', marginTop: 2 },
  clubCol: { flex: 1 },
  clubLabel: { color: '#f8fafc', fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  dirLabel: { color: '#bcc6d3', fontSize: 11, marginTop: 1 },
  clubMissing: { color: '#c2cad4', fontWeight: '500', textTransform: 'none' },
  distCol: { width: 50, alignItems: 'flex-end' },
  distValue: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  distUnit: { color: '#64748b', fontSize: 9 },
  chip: {
    minWidth: 60,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  chipLabel: { fontSize: 10, fontWeight: '700' },
});
