import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import CageSessionOverlay, { type CageDrillContext } from '../../components/CageSessionOverlay';
import PrimaryIssueCard from '../../components/PrimaryIssueCard';
import { getRankedPrimaryIssues } from '../../services/primaryIssueRanker';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import AppIcon from '../../components/AppIcon';
import { getDialog } from '../../services/dialogEngine';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useRoundStore } from '../../store/roundStore';
import { generatePatternInsights } from '../../services/patternDetection';

// ─── DRILL DATA ────────────────────────────

type DrillEnv = 'range' | 'cage' | 'indoor' | 'arena';

/** Curated coach video links per drill. Each entry points at a specific
 *  reputable instructor's content on this topic. We use YouTube search
 *  URLs targeted at the coach + drill keywords rather than direct video
 *  IDs — the top result is reliably the coach on that topic, and the
 *  approach survives coach re-uploads / channel reorganizations. Each
 *  link should resolve to a video under 5 minutes. */
interface DrillVideo {
  coach: string;
  /** YouTube URL — search-query form is preferred for durability. */
  url: string;
}

interface Drill {
  id: string;
  title: string;
  description: string;
  environments: DrillEnv[];
  steps: string[];
  tip: string;
  navigateTo: 'cage' | 'arena' | null;
  /** Phase I — Kevin's Coach voice walkthrough for this drill. Authored
   *  per drill so each reads in its own rhythm — Tempo Training has a
   *  different voice than Impact Position. Kept short (2–4 sentences). */
  coach_voice: string;
  /** Curated coach video links — under 5-minute drill demonstrations
   *  from reputable instructors (Rick Shiels, Me and My Golf, Hank
   *  Haney, etc). 2–3 per drill so the player has options. */
  videos: DrillVideo[];
}

const DRILLS: Drill[] = [
  {
    id: 'alignment',
    title: 'Alignment Check',
    description: 'Ensure feet, hips, and shoulders are parallel to the target line.',
    environments: ['range', 'cage'],
    steps: [
      'Place two alignment sticks parallel — one for ball line, one for feet.',
      'Take your address, confirming feet are parallel to the target stick.',
      'Check shoulders in a mirror or phone camera — parallel to feet line.',
      'Hold this position for 10 seconds to build muscle memory.',
      'Hit 10 balls, verifying alignment before each shot.',
    ],
    tip: 'Most amateurs aim right. Your shoulders are usually the culprit.',
    navigateTo: 'cage',
    coach_voice: "Alignment is the silent killer. Most amateurs think they're aiming at the flag — they're not. Get the shoulders square. If the shoulders are right, the swing path follows.",
    videos: [
      { coach: 'Rick Shiels',     url: 'https://www.youtube.com/results?search_query=rick+shiels+alignment+drill+golf' },
      { coach: 'Me and My Golf',  url: 'https://www.youtube.com/results?search_query=me+and+my+golf+alignment+drill' },
      { coach: 'Hank Haney',      url: 'https://www.youtube.com/results?search_query=hank+haney+alignment+drill' },
    ],
  },
  {
    id: 'tempo',
    title: 'Tempo Training',
    description: 'Build the 3:1 backswing-to-downswing ratio for consistent ball striking.',
    environments: ['range', 'indoor'],
    steps: [
      'Use a metronome app set to 72 BPM.',
      'On beat 1 start backswing, beats 2–3 continue back, beat 4 start downswing.',
      'Feel the pause at the top before transition.',
      'Hit 20 balls matching the rhythm.',
      'Gradually remove the metronome — carry the internal count.',
    ],
    tip: 'Rushing the downswing is the #1 cause of over-the-top moves.',
    navigateTo: null,
    coach_voice: "Tempo wins more rounds than swing speed. Three-to-one is the rhythm — slow back, easy through. Feel the pause at the top. When the rhythm's in, every club gets longer.",
    videos: [
      { coach: 'Mark Crossfield',    url: 'https://www.youtube.com/results?search_query=mark+crossfield+golf+tempo+drill' },
      { coach: 'Me and My Golf',     url: 'https://www.youtube.com/results?search_query=me+and+my+golf+tempo+3+to+1' },
      { coach: 'Padraig Harrington', url: 'https://www.youtube.com/results?search_query=padraig+harrington+tempo+drill' },
    ],
  },
  {
    id: 'impact',
    title: 'Impact Position',
    description: 'Train the ideal impact position — hands ahead, shaft lean, weight forward.',
    environments: ['cage', 'indoor'],
    steps: [
      'Set up an impact bag at ball position.',
      'Swing slowly to impact — freeze when hands reach the bag.',
      'Check: hands ahead of ball, weight 70% front foot, hips open 30°.',
      'Hold the position for 5 seconds.',
      'Repeat 15 times before hitting balls at full speed.',
    ],
    tip: 'Shaft lean at impact = distance. Every pro has it. Train it deliberately.',
    navigateTo: 'cage',
    coach_voice: "Impact is the only position that matters — everything else is just getting there. Hands ahead, weight forward, hips clearing. Train it slowly. The body learns position before it learns speed.",
    videos: [
      { coach: 'Athletic Motion Golf', url: 'https://www.youtube.com/results?search_query=athletic+motion+golf+impact+position+drill' },
      { coach: 'Hank Haney',           url: 'https://www.youtube.com/results?search_query=hank+haney+impact+position+drill' },
      { coach: 'Eric Cogorno',         url: 'https://www.youtube.com/results?search_query=eric+cogorno+impact+bag+drill' },
    ],
  },
  {
    id: 'gate',
    title: 'Gate Drill',
    description: 'Path control using a narrow gate that forces the club through on plane.',
    environments: ['range', 'cage'],
    steps: [
      'Place two tees 1 inch wider than your clubhead — inside and outside the ball.',
      'The goal: swing through without hitting either tee.',
      'Inside tee hit → path is too outside-in (slice).',
      'Outside tee hit → path is too inside-out (hook).',
      'Hit 30 balls maintaining a clean pass through the gate.',
    ],
    tip: 'Start with a 7-iron. The gate exposes path immediately — no hiding.',
    navigateTo: 'cage',
    coach_voice: "Path doesn't lie. The gate gives you immediate feedback — no second-guessing. Hit the inside tee, you're cutting across. Hit the outside tee, you're swinging out. Aim to clean it through ten in a row.",
    videos: [
      { coach: 'Rick Shiels',     url: 'https://www.youtube.com/results?search_query=rick+shiels+gate+drill+golf' },
      { coach: 'Chris Ryan Golf', url: 'https://www.youtube.com/results?search_query=chris+ryan+golf+tee+gate+drill' },
      { coach: 'Eric Cogorno',    url: 'https://www.youtube.com/results?search_query=eric+cogorno+swing+path+gate+drill' },
    ],
  },
  {
    id: 'pump',
    title: 'Pump Drill',
    description: 'Build lag, sequence, and the correct downswing feel.',
    environments: ['range', 'cage', 'indoor'],
    steps: [
      'Take the club to the top of your backswing.',
      'Start the downswing — stop when hands reach hip height. Pump back up.',
      'Repeat the pump 3 times, maintaining the lag angle.',
      'On the 4th pump, continue through to a full finish.',
      'Focus on feeling the hands lead the clubhead on the way down.',
    ],
    tip: 'The pump exaggerates lag. After 20 reps, your natural swing retains it.',
    navigateTo: null,
    coach_voice: "Lag is a feel, not a position. The pump teaches your hands to lead the clubhead — that's the whole game on the downswing. Reps over thinking. Twenty pumps, then go hit a ball. The body remembers.",
    videos: [
      { coach: 'Hank Haney',         url: 'https://www.youtube.com/results?search_query=hank+haney+pump+drill+downswing' },
      { coach: 'Top Speed Golf',     url: 'https://www.youtube.com/results?search_query=top+speed+golf+pump+drill+lag' },
      { coach: 'George Gankas',      url: 'https://www.youtube.com/results?search_query=george+gankas+pump+drill' },
    ],
  },
  {
    id: 'landing-zone',
    title: 'Landing Zone',
    description: 'Target accuracy with measured zones for approach consistency.',
    environments: ['arena'],
    steps: [
      'Open Arena Mode and set a target distance.',
      'Imagine 3 rings: 5 yards, 10 yards, 15 yards from target.',
      'Hit 10 balls at your chosen target.',
      'Score: center = 3 pts, middle ring = 2 pts, outer ring = 1 pt.',
      'Work toward a score of 24+ out of 30.',
    ],
    tip: 'Misses patterning right? Your release is early. Left? You\'re holding off.',
    navigateTo: 'arena',
    coach_voice: "Targets sharpen everything. Aim small, miss small. Watch where misses cluster — that's the read. Right pattern is an early release; left is the opposite. The pattern tells the truth.",
    videos: [
      { coach: 'Me and My Golf',     url: 'https://www.youtube.com/results?search_query=me+and+my+golf+target+practice+drill' },
      { coach: 'Mark Crossfield',    url: 'https://www.youtube.com/results?search_query=mark+crossfield+target+practice+drill' },
      { coach: 'Dan Whittaker Golf', url: 'https://www.youtube.com/results?search_query=dan+whittaker+wedge+target+drill' },
    ],
  },
  {
    id: 'one-handed',
    title: 'One Handed Swings',
    description: 'Develop touch, feel, and the correct hand role in the swing.',
    environments: ['range', 'cage', 'indoor'],
    steps: [
      'Trail hand only: hold with only your right hand (right-handed golfers).',
      'Make 10 slow swings — feel the clubface rotating through impact.',
      'Lead hand only: repeat with only left hand.',
      'Focus on the wrist hinge and release.',
      'Reconnect both hands — feel the balance of both roles.',
    ],
    tip: 'One-handed swings reveal which hand is dominating. Balance them.',
    navigateTo: null,
    coach_voice: "One-handed work strips the swing down to feel. Trail hand teaches release; lead hand teaches structure. Slow swings only — speed comes back when both hands rejoin. Feel which hand wants to take over.",
    videos: [
      { coach: 'Me and My Golf', url: 'https://www.youtube.com/results?search_query=me+and+my+golf+one+handed+drill' },
      { coach: 'Rick Shiels',    url: 'https://www.youtube.com/results?search_query=rick+shiels+one+handed+swing+drill' },
      { coach: 'Eric Cogorno',   url: 'https://www.youtube.com/results?search_query=eric+cogorno+one+handed+swing+drill' },
    ],
  },
  {
    id: 'distance-control',
    title: 'Distance Control',
    description: 'Consistent half and three-quarter shots for approach precision.',
    environments: ['range', 'arena'],
    steps: [
      'Pick a target at 60% of your full club distance.',
      'Use a half-swing: club stops at waist height back and through.',
      'Hit 5 half-swings and note the carry distance.',
      'Adjust tempo (not effort) until carries land consistently on target.',
      'Move to three-quarter swing — build your full yardage ladder.',
    ],
    tip: 'Most scoring happens inside 150 yards. Own those shots.',
    navigateTo: 'arena',
    coach_voice: "Scoring lives inside 150. Half-shots, three-quarter shots, knockdowns — these are the clubs that drop strokes. Adjust tempo, never effort. Build a yardage ladder you can trust under pressure.",
    videos: [
      { coach: 'Dan Whittaker Golf', url: 'https://www.youtube.com/results?search_query=dan+whittaker+wedge+distance+control+drill' },
      { coach: 'Me and My Golf',     url: 'https://www.youtube.com/results?search_query=me+and+my+golf+wedge+distance+control' },
      { coach: 'Rick Shiels',        url: 'https://www.youtube.com/results?search_query=rick+shiels+wedge+yardage+ladder' },
    ],
  },
];

const ENV_FILTERS: { key: DrillEnv | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'range', label: 'Range' },
  { key: 'cage', label: 'Cage' },
  { key: 'indoor', label: 'Indoor' },
  { key: 'arena', label: 'Arena' },
];

const ENV_COLORS: Record<DrillEnv, string> = {
  range: '#16a34a',
  cage: '#2563eb',
  indoor: '#7c3aed',
  arena: '#b45309',
};

// ─── COMPONENT ────────────────────────────

export default function SwingLab() {
  const router = useRouter();
  const { drill_id: drillIdParam } = useLocalSearchParams<{ drill_id?: string }>();
  const { watchConnected } = useSettingsStore();
  const { firstName } = usePlayerProfileStore();
  const { roundsTogether } = useRelationshipStore();
  const recentShots = useRoundStore(s => s.shots);
  const roundHistory = useRoundStore(s => s.roundHistory);
  const [activeEnv, setActiveEnv] = useState<DrillEnv | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Per-section collapse state. Tim's restructure: Common Faults → Cage
  // Mode → Swing Library → Tutorial → Drills → Arena, each as its own
  // discoverable card. Common Faults defaults open (it's the prominent
  // surface); rest collapsed so the tab reads as a clean stack.
  const [drillsOpen, setDrillsOpen] = useState(false);
  const [cageOpen, setCageOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [arenaOpen, setArenaOpen] = useState(false);
  // Phase 111-followup — Common Faults section collapsible per Tim
  // feedback. Default false so the tab opens compact; user expands to
  // browse faults.
  // Common Faults defaults open — Tim wants it as the prominent card on
  // tab visit. The first card inside is the caddie's read on the player's
  // most likely fault (getRankedPrimaryIssues reorders by detected
  // history); that ranked-first card auto-expands inside the section so
  // the player lands on actionable content with no taps required.
  const [faultsOpen, setFaultsOpen] = useState(true);
  const [cageActive, setCageActive] = useState(false);
  // Optional drill context for the unified Cage Mode session. null =
  // free practice (current default behavior). Set by the inline drill
  // picker OR by a Drill card's "Open in Cage Mode" CTA.
  const [cageDrillCtx, setCageDrillCtx] = useState<CageDrillContext | null>(null);
  // (cagePickerOpen removed — drill picker now lives INSIDE
  // CageSessionOverlay's preview phase, not as an inline chip row in
  // Practice Tools. Kept the comment to mark the design pivot.)

  // Phase J.5 deep-link — when arriving with ?drill_id=X (from DrillCard's
  // "Open Drill" CTA on the Cage post-session review), auto-expand that
  // drill so the user lands on the right walkthrough.
  React.useEffect(() => {
    if (drillIdParam && DRILLS.some(d => d.id === drillIdParam)) {
      setExpandedId(drillIdParam);
    }
  }, [drillIdParam]);

  // Phase I + I.5 — Coach intro + drill suggestion. Pattern-aware variant
  // fires when accumulated shot data shows a clear miss tendency
  // (right-miss → Gate Drill, etc.). Falls back to the generic random
  // suggestion when no clear pattern exists.
  const coachIntroBody = React.useMemo(() => {
    const introKey = roundsTogether === 0 ? 'swinglab_home_intro' : 'swinglab_home_intro_returning';
    const intro = getDialog('coach', introKey, { name: firstName ?? 'there' });

    // Pattern-aware drill suggestion. Uses last completed round if available,
    // else current in-flight round shots.
    const lastRound = roundHistory[roundHistory.length - 1];
    const shotsForPattern = (lastRound?.shots ?? recentShots ?? []).slice(-30);
    const patternInsights = generatePatternInsights(shotsForPattern);
    const tendency = patternInsights.raw_stats.miss_tendency_overall;

    let suggestedDrill: typeof DRILLS[number] | undefined;
    let patternPhrase: string | null = null;
    if (tendency === 'right' || tendency === 'left') {
      // Gate Drill addresses both directional misses.
      suggestedDrill = DRILLS.find(d => d.id === 'gate');
      patternPhrase = `that ${tendency} miss`;
    }

    if (suggestedDrill && patternPhrase) {
      const suggestion = getDialog('coach', 'drill_suggestion_with_pattern', {
        drill: suggestedDrill.title,
        pattern: patternPhrase,
      });
      return `${intro} ${suggestion}`;
    }

    const generic = DRILLS[Math.floor(Math.random() * DRILLS.length)];
    const suggestion = getDialog('coach', 'drill_suggestion_generic', { drill: generic.title });
    return `${intro} ${suggestion}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTitleLongPress = () => {
    router.push('/cage-debug' as never);
  };

  // Unified Cage Mode: single surface that hosts both free-practice
  // sessions AND drill-guided sessions. cageDrillCtx (set by the inline
  // picker or a Drill card's CTA) drives whether the drill-info strip
  // renders inside CageSessionOverlay; null = free practice.
  if (cageActive) {
    return (
      <CageSessionOverlay
        drill={cageDrillCtx}
        onComplete={(sessionId) => {
          setCageActive(false);
          setCageDrillCtx(null);
          // Phase BS-followup Issue G — route to the swing detail screen
          // (which is keyed by sessionHistory[].id and renders the BR/U1
          // analysis pipeline) instead of /cage-debug. Fall back to
          // /swinglab/library on missing id so the user always lands
          // somewhere productive.
          if (sessionId) {
            router.push(`/swinglab/swing/${sessionId}` as never);
          } else {
            router.push('/swinglab/library' as never);
          }
        }}
        onCancel={() => { setCageActive(false); setCageDrillCtx(null); }}
      />
    );
  }

  // Helper — open Cage Mode for free practice (no drill context). The
  // in-overlay picker lets the user upgrade to a guided drill once
  // inside, so we don't need a pre-pick chip row in this tab anymore.
  const openCageFree = () => { setCageDrillCtx(null); setCageActive(true); };
  // Helper — open Cage Mode for a specific drill (info strip renders).
  // Used by Drill cards' "Open in Cage Mode" CTA.
  const openCageWithDrill = (d: typeof DRILLS[number]) => {
    setCageDrillCtx({ id: d.id, title: d.title, steps: d.steps, tip: d.tip });
    setCageActive(true);
  };

  const visibleDrills =
    activeEnv === 'all'
      ? DRILLS
      : DRILLS.filter(d => d.environments.includes(activeEnv));

  const toggleDrill = (id: string) =>
    setExpandedId(prev => (prev === id ? null : id));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header — long-press title to open cage debug screen */}
        <TouchableOpacity
          style={styles.header}
          onLongPress={handleTitleLongPress}
          delayLongPress={800}
          activeOpacity={1}
        >
          <Text style={styles.headerTitle}>SwingLab</Text>
          <Text style={styles.headerSub}>Drills, technique, and setup guides</Text>
        </TouchableOpacity>

        {/* Phase I — Kevin's Coach-mode contained-presence card. Visible by
             default at L2/L3/L4. Hidden at L1. Dismissible per-session. */}
        <KevinCoachBox body={coachIntroBody} accent="coach" />

        {/* Common Faults — promoted to top of tab per Tim. The ranked-first
            card auto-expands so the user lands on the caddie's read of
            their most likely fault. Section header still collapsible.
            Phase 111 + photo-zoom + caddie-driven ranking. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setFaultsOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Common Faults</Text>
            <Text style={styles.drillsCardSub}>Caddie&apos;s read on top · tap a photo to zoom</Text>
          </View>
          <AppIcon name={faultsOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>
        {faultsOpen && (() => {
          const ranked = getRankedPrimaryIssues();
          // First card gets the personalization badge if the catalog was
          // re-ordered (i.e. the first entry is NOT the static default
          // first entry, which is swing_path).
          const personalizedFirst = ranked.length > 0 && ranked[0].category !== 'swing_path';
          return ranked.map((entry, idx) => (
            <PrimaryIssueCard
              key={entry.category}
              entry={entry}
              isPersonalized={personalizedFirst && idx === 0}
              defaultExpanded={idx === 0}
              onTryDrill={(drillId) => router.push(`/swinglab?drill=${drillId}` as never)}
            />
          ));
        })()}

        {/* CAGE MODE — own card. Camera + auto-detect + analysis +
            drill picker (inside overlay). Bullseye Drill + Scan Your
            Space hang off here as cage-related supporting tools. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setCageOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Cage Mode</Text>
            <Text style={styles.drillsCardSub}>Camera · auto-detect · analysis · drills</Text>
          </View>
          <AppIcon name={cageOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>
        {cageOpen && (
          <View style={styles.toolsList}>
            <ToolRow
              icon="videocam"
              label="Open Cage Mode"
              sub="Camera · auto-detect swings · drill picker inside"
              onPress={openCageFree}
            />
            <ToolRow
              icon="radio-button-on-outline"
              label="Bullseye Drill"
              sub="Structured 12-second capture with bullseye scoring"
              onPress={() => router.push('/swinglab/cage-drill' as never)}
            />
            <ToolRow
              icon="scan-outline"
              label="Scan Your Space"
              sub="30-second setup read for cage framing"
              onPress={() => router.push('/swinglab/space-scan' as never)}
            />
          </View>
        )}

        {/* SWING LIBRARY — own card. Browse + replay every recorded swing. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setLibraryOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Swing Library</Text>
            <Text style={styles.drillsCardSub}>Browse + replay every captured swing</Text>
          </View>
          <AppIcon name={libraryOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>
        {libraryOpen && (
          <View style={styles.toolsList}>
            <ToolRow
              icon="library-outline"
              label="Open Swing Library"
              sub="Every recorded swing with analysis + biomechanics"
              onPress={() => router.push('/swinglab/library' as never)}
            />
          </View>
        )}

        {/* TUTORIALS — own card. Add coaching lessons + browse the library. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setTutorialOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Tutorials</Text>
            <Text style={styles.drillsCardSub}>Add coaching lessons · browse what Kevin can reference</Text>
          </View>
          <AppIcon name={tutorialOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>
        {tutorialOpen && (
          <View style={styles.toolsList}>
            <ToolRow
              icon="cloud-upload-outline"
              label="Add Tutorial"
              sub="Capture a coaching lesson Kevin uses on course"
              onPress={() => router.push('/swinglab/tutorial-upload' as never)}
            />
            <ToolRow
              icon="school-outline"
              label="Browse Tutorials"
              sub="Lessons available for Kevin to reference"
              onPress={() => router.push('/swinglab/tutorials' as never)}
            />
          </View>
        )}

        {/* Watch banner — kept inline since it's a status indicator, not a button. */}
        {watchConnected && (
          <View style={styles.watchBanner}>
            <AppIcon name="watch-outline" size={18} color="#60a5fa" />
            <Text style={styles.watchText}>
              Motion Tracking active — your watch will capture swing data during drills.
            </Text>
          </View>
        )}

        {/* Drills — entire list lives inside a single collapsible card so the
            SwingLab home reads as a tight stack, not a wall of buttons.
            Collapsed: header + count + chevron. Expanded: env filter +
            full drill cards. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setDrillsOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Drills</Text>
            <Text style={styles.drillsCardSub}>{visibleDrills.length} {visibleDrills.length === 1 ? 'drill' : 'drills'} · {ENV_FILTERS.find(f => f.key === activeEnv)?.label ?? 'All'}</Text>
          </View>
          <AppIcon name={drillsOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>

        {drillsOpen && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
              contentContainerStyle={styles.filterContent}
            >
              {ENV_FILTERS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterPill, activeEnv === f.key && styles.filterPillActive]}
                  onPress={() => setActiveEnv(f.key)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[styles.filterLabel, activeEnv === f.key && styles.filterLabelActive]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {visibleDrills.map(drill => (
              <DrillCard
                key={drill.id}
                drill={drill}
                expanded={expandedId === drill.id}
                onToggle={() => toggleDrill(drill.id)}
                // Drill CTA: 'cage' destinations route into the unified
                // Cage Mode WITH the drill pre-selected (drill-info strip
                // renders inside the camera surface). 'arena' still routes
                // to the dedicated Arena screen.
                onNavigate={(dest) => {
                  if (dest === 'cage') {
                    openCageWithDrill(drill);
                  } else {
                    router.push(`/${dest}` as never);
                  }
                }}
              />
            ))}

            {visibleDrills.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No drills for this environment yet.</Text>
              </View>
            )}
          </>
        )}

        {/* ARENA — own card. Target games + scoring. Distinct from Drills
            because it's a separate game mode, not a structured drill. */}
        <TouchableOpacity
          style={styles.drillsCardHeader}
          onPress={() => setArenaOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Arena</Text>
            <Text style={styles.drillsCardSub}>Target games + scoring</Text>
          </View>
          <AppIcon name={arenaOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#F5A623" />
        </TouchableOpacity>
        {arenaOpen && (
          <View style={styles.toolsList}>
            <ToolRow
              icon="trophy-outline"
              label="Open Arena"
              sub="Target games + scoring · alternate game modes"
              onPress={() => router.push('/arena' as never)}
              accent="#F5A623"
            />
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── PRACTICE TOOLS ROW ───────────────────

function ToolRow({
  icon, label, sub, onPress, accent = '#00C896',
}: { icon: import('../../components/AppIcon').IconName; label: string; sub: string; onPress: () => void; accent?: string }) {
  return (
    <TouchableOpacity style={styles.toolRow} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.toolRowIcon, accent !== '#00C896' && { backgroundColor: accent + '1A' }]}>
        <AppIcon name={icon} size={20} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toolRowLabel}>{label}</Text>
        <Text style={styles.toolRowSub}>{sub}</Text>
      </View>
      <AppIcon name="chevron-forward" size={18} color="#6b7280" />
    </TouchableOpacity>
  );
}

// ─── DRILL CARD ───────────────────────────

interface DrillCardProps {
  drill: Drill;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (dest: 'cage' | 'arena') => void;
}

function DrillCard({ drill, expanded, onToggle, onNavigate }: DrillCardProps) {
  return (
    <TouchableOpacity
      style={[styles.drillCard, expanded && styles.drillCardExpanded]}
      onPress={onToggle}
      activeOpacity={0.85}
    >
      {/* Card header */}
      <View style={styles.drillHeader}>
        <View style={styles.drillTitleRow}>
          <Text style={styles.drillTitle}>{drill.title}</Text>
          <Text style={styles.drillChevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
        <View style={styles.envBadgeRow}>
          {drill.environments.map(env => (
            <View
              key={env}
              style={[styles.envBadge, { backgroundColor: ENV_COLORS[env] + '33' }]}
            >
              <Text style={[styles.envBadgeText, { color: ENV_COLORS[env] }]}>
                {env}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.drillDesc}>{drill.description}</Text>
      </View>

      {/* Expanded content */}
      {expanded && (
        <View style={styles.drillBody}>
          <View style={styles.divider} />

          {/* Phase I — Coach voice walkthrough — authored per drill so each
               reads in its own rhythm. */}
          <KevinCoachBox body={drill.coach_voice} accent="coach" />

          <Text style={styles.stepsLabel}>Steps</Text>
          {drill.steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}

          <View style={styles.tipBox}>
            <AppIcon name="chatbubble-ellipses-outline" size={18} color="#00C896" />
            <View style={styles.tipContent}>
              <Text style={styles.tipLabel}>Kevin says</Text>
              <Text style={styles.tipText}>{drill.tip}</Text>
            </View>
          </View>

          {/* Curated coach demos — under 5-min YouTube videos from
              reputable instructors. Search-URL form so re-uploads /
              channel reorgs don't break the link; top result is
              reliably the named coach on this topic. */}
          {drill.videos && drill.videos.length > 0 && (
            <View style={styles.videosSection}>
              <Text style={styles.videosLabel}>Watch a coach (under 5 min)</Text>
              {drill.videos.map((v, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.videoRow}
                  onPress={() => { void Linking.openURL(v.url); }}
                  accessibilityRole="link"
                  accessibilityLabel={`Watch ${v.coach} on ${drill.title} on YouTube`}
                  activeOpacity={0.75}
                >
                  <AppIcon name="logo-youtube" size={18} color="#ef4444" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.videoCoach}>{v.coach}</Text>
                    <Text style={styles.videoSub}>{drill.title} drill on YouTube</Text>
                  </View>
                  <AppIcon name="open-outline" size={14} color="#9ca3af" />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {drill.navigateTo && (
            <TouchableOpacity
              style={[
                styles.tryBtn,
                drill.navigateTo === 'arena' && styles.tryBtnArena,
              ]}
              onPress={() => onNavigate(drill.navigateTo!)}
              activeOpacity={0.75}
            >
              <Text style={styles.tryBtnText}>
                {drill.navigateTo === 'cage' ? 'Open Cage Mode →' : 'Open Arena →'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── STYLES ───────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    // Phase AA — guarantee bottom cards aren't clipped behind the tab bar
    // and leave room for content to grow.
    paddingBottom: 32,
    flexGrow: 1,
  },

  // Header
  header: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: '#e8f5e9',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerSub: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 2,
  },

  // Cage Session CTA
  cageSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d1f3c',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#2563eb66',
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 16,
    gap: 12,
  },
  cageSessionIconWrap: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: 'rgba(0,200,150,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  cageSessionText: {
    flex: 1,
    gap: 3,
  },
  cageSessionLabel: {
    color: '#e8f5e9',
    fontSize: 16,
    fontWeight: '800',
  },
  cageSessionSub: {
    color: '#6b7280',
    fontSize: 12,
  },
  cageSessionArrow: {
    color: '#2563eb',
    fontSize: 22,
    fontWeight: '700',
  },

  // Phase R — Upload + Library row
  phaseRRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 12,
    gap: 10,
  },
  phaseRBtn: {
    flex: 1,
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
  },
  phaseRIcon: { fontSize: 22, marginBottom: 6 },
  phaseRLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  phaseRSub: { color: '#6b7280', fontSize: 11, marginTop: 2 },

  // Watch banner
  watchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a2a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#00C896',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  watchIcon: {
    fontSize: 20,
  },
  watchText: {
    flex: 1,
    color: '#a3b8a8',
    fontSize: 12,
    lineHeight: 17,
  },

  // Section headers
  sectionHeader: {
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#e8f5e9',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sectionSub: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },

  // Quick Access
  quickRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 4,
  },
  quickCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 4,
  },
  quickCage: {
    backgroundColor: '#0d1f3c',
    borderColor: '#2563eb44',
  },
  quickArena: {
    backgroundColor: '#1a1006',
    borderColor: '#b4530944',
  },
  quickIcon: {
    fontSize: 24,
  },
  quickLabel: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
  },
  quickDesc: {
    color: '#6b7280',
    fontSize: 11,
  },

  // Drills + Tools collapsible headers (shared visual style)
  drillsCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  toolsCardHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  toolsList: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#0d1a0d', borderColor: '#1e3a28', borderWidth: 1,
    borderRadius: 12, padding: 4,
  },
  toolRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 10, gap: 12,
    borderRadius: 8,
  },
  toolRowIcon: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: 'rgba(0,200,150,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  toolRowLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  toolRowSub: { color: '#6b7280', fontSize: 11, marginTop: 1 },
  cagePickerWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12,
  },
  cagePickerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,200,150,0.10)',
    borderColor: 'rgba(0,200,150,0.45)', borderWidth: 1,
    borderRadius: 16, paddingVertical: 7, paddingHorizontal: 12,
  },
  cagePickerChipText: { color: '#d1d5db', fontSize: 12, fontWeight: '700' },
  cagePickerChipPrimary: { backgroundColor: '#00C896', borderColor: '#00C896' },
  cagePickerChipPrimaryText: { color: '#0d1a0d', fontSize: 12, fontWeight: '900' },
  drillsCardTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  drillsCardSub: { color: '#6b7280', fontSize: 12, marginTop: 2 },

  // Filter
  filterScroll: {
    marginBottom: 12,
  },
  filterContent: {
    gap: 8,
    paddingRight: 16,
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#0d1f15',
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  filterPillActive: {
    backgroundColor: '#00C896',
    borderColor: '#00C896',
  },
  filterLabel: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '600',
  },
  filterLabelActive: {
    color: '#060f09',
  },

  // Drill card
  drillCard: {
    backgroundColor: '#0a1e12',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    marginBottom: 10,
    overflow: 'hidden',
  },
  drillCardExpanded: {
    borderColor: '#00C89644',
  },
  drillHeader: {
    padding: 14,
    gap: 6,
  },
  drillTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  drillTitle: {
    color: '#e8f5e9',
    fontSize: 15,
    fontWeight: '700',
  },
  drillChevron: {
    color: '#6b7280',
    fontSize: 10,
  },
  envBadgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  envBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  envBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  drillDesc: {
    color: '#a3b8a8',
    fontSize: 13,
    lineHeight: 18,
  },

  // Drill body (expanded)
  drillBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  divider: {
    height: 1,
    backgroundColor: '#1e3a28',
    marginBottom: 12,
  },
  stepsLabel: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1e3a28',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    color: '#a3b8a8',
    fontSize: 13,
    lineHeight: 19,
  },
  tipBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#0d2b1c',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#00C89622',
  },
  tipIcon: {
    fontSize: 20,
    flexShrink: 0,
  },
  tipContent: {
    flex: 1,
    gap: 2,
  },
  tipLabel: {
    color: '#00C896',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  tipText: {
    color: '#a3b8a8',
    fontSize: 13,
    lineHeight: 18,
  },
  videosSection: {
    marginTop: 14,
    gap: 8,
  },
  videosLabel: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  videoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0d1a0d',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
  },
  videoCoach: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  videoSub: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 1,
  },
  tryBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  tryBtnArena: {
    backgroundColor: '#b45309',
  },
  tryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  // Empty state
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 14,
  },

  // Setup Guide / Silhouettes
  silhouetteRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 8,
  },
  silhouetteCard: {
    flex: 1,
    backgroundColor: '#0a1e12',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a28',
    alignItems: 'center',
    padding: 14,
    gap: 8,
  },
  silhouetteLabel: {
    color: '#e8f5e9',
    fontSize: 13,
    fontWeight: '700',
  },
  silhouetteHint: {
    color: '#6b7280',
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
  },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 10, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, borderColor: '#1e3a28',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  demoBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  bottomPad: {
    height: 32,
  },
});
