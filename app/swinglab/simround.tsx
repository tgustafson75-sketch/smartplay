/**
 * 2026-07-07 (Tim — SwingSim v1, "Road to the Masters feel").
 *
 * The motion sim game: your phone is the club (IndoorRepDetector), your REAL learned
 * bag is the physics, your CNS miss tendency shapes the dispersion, and the board is
 * our real course models + aerials. Broadcast presentation: cinematic hole-flyover
 * intro card, a TV-style shot tracer drawing on the aerial, lower-third result
 * banners, persona commentary. GAME — badged SIM, never touches real stats; every
 * swing is still a REAL tempo rep and feeds the CNS (playing = practicing).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ImageBackground, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Gyroscope } from 'expo-sensors';
import * as Haptics from 'expo-haptics';
import Svg, { Polyline, Circle as SvgCircle } from 'react-native-svg';
import { useTheme } from '../../contexts/ThemeContext';
import { IndoorRepDetector, type IndoorRep } from '../../services/indoorSwing';
import { simShot, simPutt, lieFor, liePenalty, missBiasFor, scoreName, type SimLie } from '../../services/simGame';
import { COURSES } from '../../data/courses';
import { getLocalHoleImageById } from '../../data/localCourseImages';
import { useClubStatsStore, CLUB_ORDER } from '../../store/clubStatsStore';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import { usePracticePointsStore } from '../../store/practicePointsStore';
import { useSettingsStore } from '../../store/settingsStore';

const NEON = '#88F700';
const SIM_COURSES = ['webster-dudley', 'spessard-holland'];

type Stage = 'lobby' | 'flyover' | 'shot' | 'result' | 'putt' | 'holeout' | 'final';

interface ShotMark { x: number; y: number }

// Persona one-liners (local, offline). Picked by outcome; generic fallback.
function callLine(persona: string, kind: 'flush' | 'good' | 'poor' | 'trees' | 'birdie' | 'bogey'): string {
  const tank: Record<string, string> = {
    flush: 'THAT one. Do it again.', good: 'Playable. Next.', poor: 'You snatched it. Reset.',
    trees: 'In the lumber. Punch out, no heroes.', birdie: 'Circle it. More.', bogey: 'Shake it off. Next tee.',
  };
  const kevin: Record<string, string> = {
    flush: 'Flushed it — that tempo is the one we bottle.', good: 'Solid. We can score from there.',
    poor: 'Quick from the top — same move the range sees.', trees: 'We\'re in trouble — take the medicine.',
    birdie: 'Birdie! That\'s the rhythm paying off.', bogey: 'Bogey — we take it and move on.',
  };
  const book = persona === 'tank' ? tank : kevin;
  return book[kind];
}

export default function SwingSimScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const persona = useSettingsStore((s) => s.caddiePersonality);
  const [courseId, setCourseId] = useState(SIM_COURSES[0]);
  const course = useMemo(() => COURSES.find((c) => c.id === courseId)!, [courseId]);
  const [holeCount, setHoleCount] = useState<9 | 18>(9);
  const [stage, setStage] = useState<Stage>('lobby');
  const [holeIdx, setHoleIdx] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [lie, setLie] = useState<SimLie>('tee');
  const [puttFt, setPuttFt] = useState(0);
  const [scorecard, setScorecard] = useState<{ hole: number; par: number; strokes: number }[]>([]);
  const [banner, setBanner] = useState<{ title: string; sub: string; tone: 'good' | 'warn' | 'bad' } | null>(null);
  const [marks, setMarks] = useState<ShotMark[]>([]);
  const [club, setClub] = useState<string>('7 Iron');
  const [armed, setArmed] = useState(false);
  const detRef = useRef<IndoorRepDetector | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  const hole = course.holes[holeIdx];
  const holeImg = getLocalHoleImageById(`local:${courseId}`, hole?.hole ?? 1);
  const missBias = useMemo(() => missBiasFor(useCaddieMemoryStore.getState().getPlayer().tendencies.dominantMiss), []);

  // Real bag: playable clubs (has a distance), longest first. Caddie suggestion =
  // the club whose carry best fits the remaining number (with lie penalty).
  const bag = useMemo(() => {
    const st = useClubStatsStore.getState();
    return CLUB_ORDER.filter((c) => c !== 'Putter' && st.hasDistance(c))
      .map((c) => ({ club: c, carry: Math.round(st.distanceFor(c)) }))
      .sort((a, b) => b.carry - a.carry);
  }, []);
  const suggest = useCallback((dist: number, currentLie: SimLie) => {
    if (bag.length === 0) return { club: '7 Iron', carry: 150 };
    const eff = liePenalty(currentLie);
    let best = bag[0];
    for (const b of bag) {
      if (Math.abs(b.carry * eff - dist) < Math.abs(best.carry * eff - dist)) best = b;
    }
    return best;
  }, [bag]);

  const stopSensor = useCallback(() => { try { subRef.current?.remove(); } catch { /* gone */ } subRef.current = null; setArmed(false); }, []);
  useEffect(() => () => stopSensor(), [stopSensor]);

  const beginHole = useCallback((idx: number) => {
    const h = course.holes[idx];
    setHoleIdx(idx); setStrokes(0); setRemaining(h.distance); setLie('tee');
    setMarks([{ x: 0.5, y: 0.9 }]); setBanner(null);
    const s = suggest(h.distance, 'tee');
    setClub(s.club);
    setStage('flyover');
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }).start();
    setTimeout(() => setStage('shot'), 2400); // the flyover beat
  }, [course, suggest, fade]);

  // Arm the detector for a swing or putt.
  const arm = useCallback((mode: 'swing' | 'putt') => {
    detRef.current = new IndoorRepDetector(mode);
    setArmed(true);
    try {
      Gyroscope.setUpdateInterval(10);
      subRef.current = Gyroscope.addListener((g) => {
        const rep = detRef.current?.onSample({ t: Date.now(), x: g.x, y: g.y, z: g.z }) ?? null;
        if (rep) { stopSensor(); onRep(rep, mode); }
      });
    } catch { setArmed(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSensor]);

  const onRepRef = useRef<(rep: IndoorRep, mode: 'swing' | 'putt') => void>(() => {});
  const onRep = useCallback((rep: IndoorRep, mode: 'swing' | 'putt') => onRepRef.current(rep, mode), []);

  onRepRef.current = (rep, mode) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // Every game swing is a REAL tempo rep → the one CNS picture.
    try { useCaddieMemoryStore.getState().recordSwingMetrics({ tempoRatio: rep.tempoRatio, nowMs: Date.now() }); } catch { /* additive */ }

    if (mode === 'putt') {
      const out = simPutt({ distanceFt: puttFt, rep });
      const s = strokes + 1;
      setStrokes(s);
      if (out.holed) {
        finishHole(s);
      } else if (s - hole.par >= 3) {
        finishHole(s + 1); // pick-up mercy: cap the blowup
      } else {
        setPuttFt(out.remainingFt);
        setBanner({ title: `${out.remainingFt} FT LEFT`, sub: rep.throughStroke === 'decelerating' ? 'Decel into it — the classic miss' : 'Burned the edge', tone: 'warn' });
      }
      return;
    }

    const effCarry = (bag.find((b) => b.club === club)?.carry ?? 150) * liePenalty(lie);
    const out = simShot({ clubCarry: effCarry, rep, missBias });
    const s = strokes + 1;
    setStrokes(s);
    const newRemaining = Math.max(0, Math.round(remaining - out.carryYds));
    const newLie = lieFor(Math.abs(out.lateralYds), newRemaining);
    // Advance the tracer on the aerial: progress along the hole = y, lateral = x.
    const progress = 1 - newRemaining / hole.distance;
    const px = Math.max(0.14, Math.min(0.86, 0.5 + (out.lateralYds / 40) * 0.3));
    const py = 0.9 - progress * 0.72;
    setMarks((m) => [...m, { x: px, y: py }]);
    setRemaining(newRemaining);
    setLie(newLie);

    if (newLie === 'green') {
      const ft = Math.max(3, Math.round((newRemaining || 6) * 1.6 + Math.abs(out.lateralYds)));
      setPuttFt(ft);
      setBanner({ title: `ON IN ${s}`, sub: `${out.carryYds}y ${out.flushed ? '— FLUSHED' : ''} · ${ft}ft for ${scoreName(s + 1, hole.par).toLowerCase()}`, tone: 'good' });
      setStage('putt');
    } else {
      const kind = out.flushed ? 'flush' : newLie === 'trees' ? 'trees' : out.quality >= 0.55 ? 'good' : 'poor';
      setBanner({
        title: `${out.carryYds}y · ${newLie.toUpperCase()}`,
        sub: callLine(persona, kind),
        tone: out.flushed ? 'good' : newLie === 'trees' ? 'bad' : out.quality >= 0.55 ? 'good' : 'warn',
      });
      const next = suggest(newRemaining, newLie);
      setClub(next.club);
      setStage('result');
    }
  };

  const finishHole = useCallback((finalStrokes: number) => {
    setScorecard((sc) => [...sc, { hole: hole.hole, par: hole.par, strokes: finalStrokes }]);
    setBanner({ title: scoreName(finalStrokes, hole.par), sub: finalStrokes - hole.par <= -1 ? callLine(persona, 'birdie') : finalStrokes - hole.par >= 1 ? callLine(persona, 'bogey') : 'Steady.', tone: finalStrokes <= hole.par ? 'good' : 'warn' });
    setStage('holeout');
  }, [hole, persona]);

  const nextHole = useCallback(() => {
    const nextIdx = holeIdx + 1;
    if (nextIdx >= holeCount) {
      try {
        usePracticePointsStore.getState().awardPracticePoints({ key: 'indoor:sim', label: 'SwingSim Round', swings: scorecard.reduce((a, h) => a + h.strokes, 0), now: Date.now() });
      } catch { /* additive */ }
      setStage('final');
    } else {
      beginHole(nextIdx);
    }
  }, [holeIdx, holeCount, beginHole, scorecard]);

  const toPar = scorecard.reduce((a, h) => a + (h.strokes - h.par), 0);
  const s = makeStyles(colors);

  // ── Render ──
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => { stopSensor(); router.back(); }} accessibilityRole="button" accessibilityLabel="Exit sim">
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={s.title}>SWINGSIM</Text>
          <Text style={s.simBadge}>SIM ROUND · NOT REAL STATS</Text>
        </View>
        <Text style={s.toPar}>{scorecard.length > 0 ? (toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`) : ''}</Text>
      </View>

      {stage === 'lobby' ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={s.lobbyLead}>Your real bag. Your real tendencies. Your real tempo. A full round from wherever you're standing.</Text>
          {SIM_COURSES.map((id) => {
            const c = COURSES.find((x) => x.id === id)!;
            return (
              <TouchableOpacity key={id} style={[s.courseCard, courseId === id && { borderColor: NEON }]} onPress={() => setCourseId(id)} accessibilityRole="button">
                <Text style={s.courseName}>{c.name}</Text>
                <Text style={s.courseSub}>par {c.par} · {c.totalYards}y</Text>
              </TouchableOpacity>
            );
          })}
          <View style={s.toggleRow}>
            {([9, 18] as const).map((n) => (
              <TouchableOpacity key={n} style={[s.toggleBtn, holeCount === n && s.toggleBtnActive]} onPress={() => setHoleCount(n)} accessibilityRole="button">
                <Text style={[s.toggleText, holeCount === n && { color: '#0b1220' }]}>{n} HOLES</Text>
              </TouchableOpacity>
            ))}
          </View>
          {bag.length === 0 ? <Text style={s.honest}>No learned club distances yet — the sim will use a stock 150y club until your bag learns.</Text> : null}
          <TouchableOpacity style={s.teeOff} onPress={() => { setScorecard([]); beginHole(0); }} accessibilityRole="button" accessibilityLabel="Tee off">
            <Text style={s.teeOffText}>TEE OFF</Text>
          </TouchableOpacity>
          <Text style={s.honest}>Swing the phone like a club when prompted. Every swing is a real tempo rep — it all feeds your caddie.</Text>
        </ScrollView>
      ) : stage === 'final' ? (
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <Text style={s.flyPar}>FINAL</Text>
          <Text style={s.finalScore}>{toPar === 0 ? 'EVEN' : toPar > 0 ? `+${toPar}` : `${toPar}`}</Text>
          {scorecard.map((h) => (
            <View key={h.hole} style={s.scRow}>
              <Text style={s.scHole}>{h.hole}</Text>
              <Text style={s.scPar}>par {h.par}</Text>
              <Text style={[s.scStrokes, { color: h.strokes < h.par ? NEON : h.strokes === h.par ? '#fff' : '#F0C030' }]}>{h.strokes}</Text>
              <Text style={s.scName}>{scoreName(h.strokes, h.par)}</Text>
            </View>
          ))}
          <TouchableOpacity style={s.teeOff} onPress={() => { setScorecard([]); beginHole(0); }} accessibilityRole="button"><Text style={s.teeOffText}>RUN IT BACK</Text></TouchableOpacity>
          <TouchableOpacity style={s.ghostBtn} onPress={() => router.back()} accessibilityRole="button"><Text style={s.ghostText}>Clubhouse</Text></TouchableOpacity>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {/* THE BOARD — hole aerial with the broadcast tracer */}
          <ImageBackground source={holeImg ?? undefined} style={s.board} imageStyle={{ borderRadius: 18 }} resizeMode="cover">
            <View style={s.boardShade} />
            {stage !== 'flyover' ? (
              <Svg style={StyleSheet.absoluteFill}>
                <Polyline
                  points={marks.map((m) => `${m.x * 100}%,${m.y * 100}%`).join(' ')}
                  fill="none" stroke={NEON} strokeWidth={3} strokeOpacity={0.9} strokeLinecap="round" strokeLinejoin="round"
                />
                {marks.map((m, i) => (
                  <SvgCircle key={i} cx={`${m.x * 100}%`} cy={`${m.y * 100}%`} r={i === marks.length - 1 ? 7 : 4}
                    fill={i === marks.length - 1 ? '#fff' : NEON} stroke={NEON} strokeWidth={2} />
                ))}
              </Svg>
            ) : null}
            {stage === 'flyover' ? (
              <Animated.View style={[s.flyCard, { opacity: fade }]}>
                <Text style={s.flyHole}>HOLE {hole.hole}</Text>
                <Text style={s.flyPar}>PAR {hole.par} · {hole.distance} YDS</Text>
                <Text style={s.flyCourse}>{course.name.toUpperCase()}</Text>
              </Animated.View>
            ) : null}
            {/* Lower third — broadcast banner */}
            {banner && stage !== 'flyover' ? (
              <View style={[s.lowerThird, banner.tone === 'good' ? { borderLeftColor: NEON } : banner.tone === 'warn' ? { borderLeftColor: '#F0C030' } : { borderLeftColor: '#ef4444' }]}>
                <Text style={s.ltTitle}>{banner.title}</Text>
                <Text style={s.ltSub}>{banner.sub}</Text>
              </View>
            ) : null}
          </ImageBackground>

          {/* HUD deck */}
          <View style={s.deck}>
            <View style={s.hudRow}>
              <View style={s.hudStat}><Text style={s.hudValue}>{stage === 'putt' ? `${puttFt}ft` : `${remaining}y`}</Text><Text style={s.hudLabel}>{stage === 'putt' ? 'TO THE CUP' : 'TO THE PIN'}</Text></View>
              <View style={s.hudStat}><Text style={s.hudValue}>{strokes}</Text><Text style={s.hudLabel}>STROKES</Text></View>
              <View style={s.hudStat}><Text style={s.hudValue}>{lie.toUpperCase()}</Text><Text style={s.hudLabel}>LIE</Text></View>
            </View>
            {stage === 'shot' || stage === 'result' ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                  {bag.map((b) => (
                    <TouchableOpacity key={b.club} style={[s.clubChip, club === b.club && s.clubChipActive]} onPress={() => setClub(b.club)} accessibilityRole="button">
                      <Text style={[s.clubChipText, club === b.club && { color: '#0b1220' }]}>{b.club} · {b.carry}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={[s.swingBtn, armed && s.swingBtnArmed]} onPress={() => (armed ? null : arm('swing'))} accessibilityRole="button" accessibilityLabel="Arm the swing">
                  <Text style={[s.swingBtnText, armed && { color: NEON }]}>{armed ? 'SWING THE PHONE — I\'M WATCHING' : `ARM ${club.toUpperCase()}`}</Text>
                </TouchableOpacity>
              </>
            ) : stage === 'putt' ? (
              <TouchableOpacity style={[s.swingBtn, armed && s.swingBtnArmed]} onPress={() => (armed ? null : arm('putt'))} accessibilityRole="button" accessibilityLabel="Arm the putt">
                <Text style={[s.swingBtnText, armed && { color: NEON }]}>{armed ? 'STROKE IT — I\'M WATCHING' : 'ARM THE PUTT'}</Text>
              </TouchableOpacity>
            ) : stage === 'holeout' ? (
              <TouchableOpacity style={s.teeOff} onPress={nextHole} accessibilityRole="button">
                <Text style={s.teeOffText}>{holeIdx + 1 >= holeCount ? 'TO THE CLUBHOUSE' : `HOLE ${course.holes[holeIdx + 1].hole} →`}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#04120a' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 8 },
    title: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 3 },
    simBadge: { color: '#F0C030', fontSize: 9, fontWeight: '900', letterSpacing: 1.4, marginTop: 2 },
    toPar: { color: NEON, fontSize: 18, fontWeight: '900', width: 40, textAlign: 'right' },
    lobbyLead: { color: '#fff', fontSize: 17, fontWeight: '800', lineHeight: 24, marginBottom: 16 },
    courseCard: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 16, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
    courseName: { color: '#fff', fontSize: 16, fontWeight: '800' },
    courseSub: { color: '#9aa5b1', fontSize: 12, marginTop: 2 },
    toggleRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
    toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
    toggleBtnActive: { backgroundColor: NEON, borderColor: NEON },
    toggleText: { color: '#9aa5b1', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    teeOff: { marginTop: 18, backgroundColor: NEON, borderRadius: 28, paddingVertical: 15, alignItems: 'center' },
    teeOffText: { color: '#0b1220', fontWeight: '900', fontSize: 15, letterSpacing: 1.6 },
    honest: { color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 12 },
    board: { flex: 1, margin: 12, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end' },
    boardShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,10,6,0.18)' },
    flyCard: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(2,10,6,0.55)' },
    flyHole: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: 4 },
    flyPar: { color: NEON, fontSize: 18, fontWeight: '900', letterSpacing: 2, marginTop: 4 },
    flyCourse: { color: '#c2cbd4', fontSize: 12, fontWeight: '800', letterSpacing: 2.4, marginTop: 10 },
    lowerThird: { margin: 12, backgroundColor: 'rgba(2,10,6,0.82)', borderLeftWidth: 4, borderRadius: 10, padding: 12 },
    ltTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 0.6 },
    ltSub: { color: '#c2cbd4', fontSize: 13, marginTop: 2 },
    deck: { paddingHorizontal: 14, paddingBottom: 14 },
    hudRow: { flexDirection: 'row', gap: 10 },
    hudStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, alignItems: 'center', paddingVertical: 8 },
    hudValue: { color: '#fff', fontSize: 18, fontWeight: '900' },
    hudLabel: { color: '#9aa5b1', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
    clubChip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8 },
    clubChipActive: { backgroundColor: NEON, borderColor: NEON },
    clubChipText: { color: '#c2cbd4', fontSize: 12, fontWeight: '800' },
    swingBtn: { marginTop: 10, borderWidth: 1.5, borderColor: NEON, borderRadius: 26, paddingVertical: 14, alignItems: 'center' },
    swingBtnArmed: { backgroundColor: 'rgba(136,247,0,0.12)' },
    swingBtnText: { color: NEON, fontWeight: '900', fontSize: 14, letterSpacing: 1.2 },
    finalScore: { color: NEON, fontSize: 56, fontWeight: '900', marginBottom: 14 },
    scRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
    scHole: { color: '#6b7280', width: 22, fontWeight: '800' },
    scPar: { color: '#9aa5b1', width: 50, fontSize: 12 },
    scStrokes: { fontSize: 16, fontWeight: '900', width: 30 },
    scName: { color: '#9aa5b1', fontSize: 12, fontWeight: '800' },
    ghostBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 12 },
    ghostText: { color: '#9aa5b1', fontSize: 14, fontWeight: '700' },
  });
}
