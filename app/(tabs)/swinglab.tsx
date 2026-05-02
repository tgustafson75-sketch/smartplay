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
import AddressSilhouette from '../../components/AddressSilhouette';
import CageSessionOverlay from '../../components/CageSessionOverlay';
import KevinCoachBox from '../../components/swinglab/KevinCoachBox';
import AppIcon from '../../components/AppIcon';
import { getDialog } from '../../services/dialogEngine';
import { useRelationshipStore } from '../../store/relationshipStore';
import { useRoundStore } from '../../store/roundStore';
import { generatePatternInsights } from '../../services/patternDetection';

// ─── DRILL DATA ────────────────────────────

type DrillEnv = 'range' | 'cage' | 'indoor' | 'arena';

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
  // Phase R polish — drill list + practice tools collapsed by default.
  const [drillsOpen, setDrillsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [cageActive, setCageActive] = useState(false);

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

  // Cage mode: replace entire screen with the overlay
  if (cageActive) {
    return (
      <CageSessionOverlay
        onComplete={(sessionId) => {
          setCageActive(false);
          router.push({
            pathname: '/cage-debug',
            params: { sessionId },
          } as never);
        }}
        onCancel={() => setCageActive(false)}
      />
    );
  }

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

        {/* Practice Tools — single collapsible card holds the 5 actions
            (Cage Session / Upload / Library / Cage Mode / Arena). Default
            collapsed so SwingLab reads as a clean stack on small screens.
            Expanded: compact icon-row list. */}
        <TouchableOpacity
          style={styles.toolsCardHeader}
          onPress={() => setToolsOpen(o => !o)}
          activeOpacity={0.85}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.drillsCardTitle}>Practice Tools</Text>
            <Text style={styles.drillsCardSub}>Cage · Upload · Library · Arena</Text>
          </View>
          <AppIcon name={toolsOpen ? 'chevron-up' : 'chevron-down'} size={20} color="#00C896" />
        </TouchableOpacity>

        {toolsOpen && (
          <View style={styles.toolsList}>
            <ToolRow
              icon="videocam"
              label="Start Cage Session"
              sub="Record · auto-detect · review"
              onPress={() => setCageActive(true)}
            />
            <ToolRow
              icon="cloud-upload-outline"
              label="Upload Swing"
              sub="From phone library"
              onPress={() => router.push('/swinglab/upload' as never)}
            />
            <ToolRow
              icon="library-outline"
              label="My Swing Library"
              sub="Browse + replay"
              onPress={() => router.push('/swinglab/library' as never)}
            />
            <ToolRow
              icon="golf-outline"
              label="Cage Mode"
              sub="Shot analysis + video"
              onPress={() => router.push('/cage' as never)}
            />
            <ToolRow
              icon="trophy-outline"
              label="Arena"
              sub="Target games + scoring"
              onPress={() => router.push('/arena' as never)}
              accent="#F5A623"
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
                onNavigate={(dest) => router.push(`/${dest}`)}
              />
            ))}

            {visibleDrills.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No drills for this environment yet.</Text>
              </View>
            )}
          </>
        )}

        {/* Setup Guide */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Setup Guide</Text>
          <Text style={styles.sectionSub}>Address positions for common shots</Text>
        </View>
        <View style={styles.silhouetteRow}>
          <View style={styles.silhouetteCard}>
            <AddressSilhouette type="face-on" size={140} />
            <Text style={styles.silhouetteLabel}>Full Swing</Text>
            <Text style={styles.silhouetteHint}>
              Feet shoulder-width apart{'\n'}Slight knee flex{'\n'}Spine tilt away from target
            </Text>
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={() => {
                // YouTube search surfaces top-ranked short instructional videos.
                // Tim picks from the results — keeps the link evergreen, no
                // hardcoded URL that can rot.
                const q = encodeURIComponent('golf full swing setup tutorial 2 minutes');
                Linking.openURL(`https://www.youtube.com/results?search_query=${q}`).catch(() => {});
              }}
            >
              <AppIcon name="logo-youtube" size={14} color="#ef4444" />
              <Text style={styles.demoBtnText}>Watch Demo</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.silhouetteCard}>
            <AddressSilhouette type="putting" size={140} />
            <Text style={styles.silhouetteLabel}>Putting</Text>
            <Text style={styles.silhouetteHint}>
              Feet narrower, even{'\n'}Eyes over ball{'\n'}Arms form a triangle
            </Text>
            <TouchableOpacity
              style={styles.demoBtn}
              onPress={() => {
                const q = encodeURIComponent('golf putting setup tutorial 2 minutes');
                Linking.openURL(`https://www.youtube.com/results?search_query=${q}`).catch(() => {});
              }}
            >
              <AppIcon name="logo-youtube" size={14} color="#ef4444" />
              <Text style={styles.demoBtnText}>Watch Demo</Text>
            </TouchableOpacity>
          </View>
        </View>

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
