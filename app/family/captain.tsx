/**
 * 2026-05-22 — Team Captain screen.
 *
 * For a high-school golf-team captain (e.g. Heritage HS, Romoland CA)
 * to manage teammates and coaches alongside their personal swing
 * tracking. Shares the FamilyMember data model — teammate / coach
 * relationships are filtered onto this screen; family-only relations
 * (child / partner / etc) stay on the Family Coaching screen.
 *
 * Surfaces:
 *   - Team name header + edit
 *   - Coaches section (with tap-to-call / text / email)
 *   - Teammates section (tap → per-member library + recent-trend pill)
 *   - "Coach <name>'s swing" quick action per row (same voice intent
 *     reused; just primed by tap)
 *   - Add teammate / Add coach CTAs
 *
 * Privacy: same local-only persistence as the Family roster. Tapping
 * a coach's phone or email uses the OS handler (tel:/sms:/mailto:);
 * we never ship contact data off the device.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useFamilyStore,
  ageBand,
  type FamilyMember,
  type FamilyRelationship,
  type SkillLevel,
  type AgeBand,
} from '../../store/familyStore';
import JuniorSwingTrendChart from '../../components/JuniorSwingTrendChart';
import {
  getMemberSwingHistory,
  realGradedHistory,
  type JuniorSwingAnalysis,
} from '../../services/juniorSwingAnalyzer';

type CaptainRoleId = 'teammate' | 'coach';

const SKILL_LEVELS: { id: SkillLevel; label: string }[] = [
  { id: 'first_swings', label: 'First swings' },
  { id: 'learning', label: 'Learning' },
  { id: 'developing', label: 'Developing' },
  { id: 'competitive', label: 'Competitive' },
];

const HANDEDNESS: { id: FamilyMember['handedness']; label: string }[] = [
  { id: 'right', label: 'Right' },
  { id: 'left', label: 'Left' },
  { id: 'unknown', label: 'Not sure' },
];

const EMOJI_PALETTE = ['🏌️‍♀️', '🏌️‍♂️', '⛳️', '👧', '👦', '🧑', '👨‍🏫', '👩‍🏫', '🌟', '🦅', '🐺', '🔥'];

const BAND_LABEL: Record<AgeBand, string> = {
  tiny: 'Tiny', junior: 'Junior', teen: 'Teen', adult: 'Adult',
};

export default function CaptainScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const teamName = useFamilyStore((s) => s.team_name);
  const setTeamName = useFamilyStore((s) => s.setTeamName);
  // 2026-06-10 — useShallow: teamRoster() returns a FRESH array each call
  // (filter+sort), so a plain selector saw a new reference every render →
  // forceStoreRerender loop → "Maximum update depth exceeded". Shallow-comparing
  // the array's (stable) member refs breaks the loop.
  const teamRoster = useFamilyStore(useShallow((s) => s.teamRoster(teamName || undefined)));
  const addMember = useFamilyStore((s) => s.addMember);
  const updateMember = useFamilyStore((s) => s.updateMember);
  const archiveMember = useFamilyStore((s) => s.archiveMember);
  const removeMember = useFamilyStore((s) => s.removeMember);

  const [editingTeam, setEditingTeam] = useState(false);
  const [draftTeam, setDraftTeam] = useState(teamName);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableDraft>(emptyDraft('teammate'));

  const coaches = useMemo(() => teamRoster.filter((m) => m.relationship === 'coach'), [teamRoster]);
  const teammates = useMemo(() => teamRoster.filter((m) => m.relationship === 'teammate'), [teamRoster]);

  const openAdd = (kind: CaptainRoleId) => {
    setEditingId(null);
    setDraft(emptyDraft(kind, teamName));
    setEditorOpen(true);
  };

  const openEdit = (m: FamilyMember) => {
    setEditingId(m.id);
    setDraft({
      firstName: m.firstName,
      nickname: m.nickname ?? '',
      relationship: m.relationship,
      age: m.age != null ? String(m.age) : '',
      skillLevel: m.skillLevel,
      handedness: m.handedness,
      avatar_emoji: m.avatar_emoji,
      team: m.team ?? teamName,
      team_role: m.team_role ?? '',
      phone: m.contact?.phone ?? '',
      email: m.contact?.email ?? '',
    });
    setEditorOpen(true);
  };

  const onSave = () => {
    const trimmed = draft.firstName.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a first name before saving.');
      return;
    }
    const ageNum = draft.age.trim() ? Math.max(1, Math.min(120, parseInt(draft.age, 10))) : null;
    const payload = {
      firstName: trimmed,
      nickname: draft.nickname.trim() || null,
      relationship: draft.relationship,
      age: Number.isFinite(ageNum as number) ? (ageNum as number) : null,
      skillLevel: draft.skillLevel,
      handedness: draft.handedness,
      approximate_handicap: null,
      avatar_emoji: draft.avatar_emoji,
      team: draft.team.trim() || null,
      team_role: draft.team_role.trim() || null,
      contact: {
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
      },
    };
    if (editingId) {
      updateMember(editingId, payload);
    } else {
      addMember(payload);
    }
    setEditorOpen(false);
  };

  const onRemove = () => {
    if (!editingId) return;
    Alert.alert(
      'Remove from team?',
      `${draft.firstName} will be removed. Their swing history stays on device but won't be tagged anymore.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { removeMember(editingId); setEditorOpen(false); } },
      ],
    );
  };

  const onArchive = () => {
    if (!editingId) return;
    archiveMember(editingId);
    setEditorOpen(false);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
          <Text style={[styles.headerBackText, { color: colors.accent }]}>← Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text_primary }]}>Team Captain</Text>
        <View style={styles.headerBack} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Team name */}
        <View style={[styles.teamCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.teamLabel, { color: colors.text_muted }]}>TEAM</Text>
          {editingTeam ? (
            <View style={styles.teamEditRow}>
              <TextInput
                value={draftTeam}
                onChangeText={setDraftTeam}
                placeholder="Heritage HS Varsity Girls"
                placeholderTextColor={colors.text_muted}
                style={[
                  styles.teamInput,
                  { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary },
                ]}
                autoFocus
              />
              <Pressable
                onPress={() => { setTeamName(draftTeam.trim()); setEditingTeam(false); }}
                style={[styles.smallBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.smallBtnText}>Save</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setDraftTeam(teamName); setEditingTeam(true); }}>
              <Text style={[styles.teamName, { color: colors.text_primary }]} numberOfLines={2}>
                {teamName || 'Tap to name your team'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Coaches section */}
        <SectionHeader title="Coaches" onAdd={() => openAdd('coach')} colors={colors} />
        {coaches.length === 0 ? (
          <EmptyRow message="Add coach contacts so you can reach them with one tap." colors={colors} />
        ) : (
          coaches.map((c) => (
            <CoachRow
              key={c.id}
              member={c}
              colors={colors}
              onEdit={() => openEdit(c)}
              onOpen={() => router.push(`/family/${c.id}` as never)}
            />
          ))
        )}

        {/* Teammates section */}
        <SectionHeader title="Teammates" onAdd={() => openAdd('teammate')} colors={colors} />
        {teammates.length === 0 ? (
          <EmptyRow
            message="Add teammates to track their swings + send hands-free coaching during practice."
            colors={colors}
          />
        ) : (
          teammates.map((m) => (
            <TeammateRow
              key={m.id}
              member={m}
              colors={colors}
              onEdit={() => openEdit(m)}
              onOpen={() => router.push(`/family/${m.id}` as never)}
            />
          ))
        )}

        {/* Team broadcast — opens system SMS composer with every team
            phone number pre-filled. We never send messages from the app
            ourselves; the OS handles delivery, so contact lists stay
            device-local. */}
        <BroadcastCard
          recipients={teamRoster
            .map((m) => m.contact?.phone)
            .filter((p): p is string => !!p && p.trim().length > 0)}
          teamName={teamName}
          colors={colors}
        />

        {/* Captain voice tips */}
        <View style={[styles.tipCard, { borderColor: colors.border }]}>
          <Text style={[styles.tipTitle, { color: colors.text_primary }]}>Captain voice flow</Text>
          <Text style={[styles.tipBody, { color: colors.text_muted }]}>
            • &quot;Coach Mia&apos;s swing&quot; — starts a tagged recording for Mia
            {'\n'}• &quot;Analyze Mia&apos;s swing&quot; — runs analysis + speaks feedback
            {'\n'}• &quot;How&apos;s the team doing?&quot; (TBD) — team-wide trend roll-up
            {'\n'}• &quot;Stop recording&quot; — ends the session
          </Text>
        </View>
      </ScrollView>

      {editorOpen && (
        <EditorModal
          draft={draft}
          setDraft={setDraft}
          isEdit={!!editingId}
          onSave={onSave}
          onArchive={onArchive}
          onRemove={onRemove}
          onClose={() => setEditorOpen(false)}
          colors={colors}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Broadcast card ─────────────────────────────────────────────────────

function BroadcastCard({
  recipients, teamName, colors,
}: {
  recipients: string[];
  teamName: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const [message, setMessage] = useState('');

  if (recipients.length === 0) {
    return (
      <View style={[styles.broadcastEmpty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.broadcastTitle, { color: colors.text_primary }]}>Team Broadcast</Text>
        <Text style={[styles.broadcastHint, { color: colors.text_muted }]}>
          Add phone numbers to coaches or teammates to enable one-tap SMS to the team.
        </Text>
      </View>
    );
  }

  const send = () => {
    const text = message.trim();
    if (!text) {
      Alert.alert('Empty message', 'Type a message before sending.');
      return;
    }
    // SMS URI format: sms:[phones,joined]?body=[encoded]. iOS + Android
    // accept comma- or semicolon-joined numbers in the address slot.
    // We strip non-digit chars per number (defensive — users type "(555) 123-4567").
    const cleaned = recipients.map((r) => r.replace(/[^0-9+]/g, '')).filter((r) => r.length > 0);
    const addr = cleaned.join(',');
    const body = encodeURIComponent(text);
    const url = `sms:${addr}?body=${body}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open Messages", 'Try copying the message manually.');
    });
  };

  // 2026-05-22 — Pre-built broadcast templates. Tap to populate the
  // input. Captains type the same handful of messages every week
  // (practice notice / match alert / tee time / weather call-off);
  // this turns them into one-tap drafts. Free edit afterwards.
  const templates: { label: string; build: () => string }[] = [
    {
      label: '🏌️ Practice',
      build: () => `Practice tomorrow 3pm — ${teamName || 'team'} range. Bring rangefinder + 18 balls minimum.`,
    },
    {
      label: '🏆 Match',
      build: () => `Match this week — bus rolls 2:30pm. Match polos + clean shoes. Show up early to warm up.`,
    },
    {
      label: '⛳ Tee time',
      build: () => `Tee times posted. Check the group text. Be on the range 45 min before your block.`,
    },
    {
      label: '🌧️ Weather call',
      build: () => `Practice cancelled — weather. Indoor putting drills at home tonight. We're back Thursday.`,
    },
    {
      label: '💯 Tournament prep',
      build: () => `Tournament next weekend. Two course-prep rounds this week. Lock in your warmup routine.`,
    },
  ];

  return (
    <View style={[styles.broadcastCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.broadcastHeader}>
        <Text style={[styles.broadcastTitle, { color: colors.text_primary }]}>Team Broadcast</Text>
        <Text style={[styles.broadcastCount, { color: colors.text_muted }]}>
          {recipients.length} number{recipients.length === 1 ? '' : 's'}
        </Text>
      </View>
      <Text style={[styles.broadcastHint, { color: colors.text_muted }]}>
        Sends through your phone&apos;s Messages app to {teamName || 'the team'}. No data leaves the device.
      </Text>
      {/* Template pills — tap to draft. Edit before send. */}
      <View style={styles.templateRow}>
        {templates.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => setMessage(t.build())}
            style={[styles.templatePill, { borderColor: colors.border, backgroundColor: colors.surface_elevated }]}
          >
            <Text style={[styles.templatePillText, { color: colors.text_primary }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Practice tomorrow 3pm — Heritage range. Wear team polos."
        placeholderTextColor={colors.text_muted}
        multiline
        style={[styles.broadcastInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
      />
      <View style={styles.broadcastButtonRow}>
        <Pressable
          onPress={send}
          style={[styles.primaryBtn, { backgroundColor: colors.accent, flex: 1 }]}
        >
          <Text style={styles.primaryBtnText}>📨 Open Messages</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Section header ─────────────────────────────────────────────────────

function SectionHeader({
  title, onAdd, colors,
}: {
  title: string; onAdd: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text_muted }]}>{title.toUpperCase()}</Text>
      <Pressable onPress={onAdd} hitSlop={10}>
        <Text style={[styles.sectionAdd, { color: colors.accent }]}>＋ Add</Text>
      </Pressable>
    </View>
  );
}

function EmptyRow({
  message, colors,
}: { message: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <View style={[styles.emptyRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.emptyText, { color: colors.text_muted }]}>{message}</Text>
    </View>
  );
}

// ─── Row variants ───────────────────────────────────────────────────────

function CoachRow({
  member, colors, onEdit, onOpen,
}: {
  member: FamilyMember; colors: ReturnType<typeof useTheme>['colors'];
  onEdit: () => void; onOpen: () => void;
}) {
  const phone = member.contact?.phone ?? null;
  const email = member.contact?.email ?? null;

  const callPhone = (mode: 'call' | 'text') => {
    if (!phone) return;
    const cleaned = phone.replace(/[^0-9+]/g, '');
    const url = mode === 'call' ? `tel:${cleaned}` : `sms:${cleaned}`;
    Linking.openURL(url).catch(() => undefined);
  };
  const openEmail = () => {
    if (!email) return;
    Linking.openURL(`mailto:${email}`).catch(() => undefined);
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <Text style={styles.rowAvatar}>{member.avatar_emoji}</Text>
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: colors.text_primary }]} numberOfLines={1}>
            {member.firstName}
            {member.team_role ? (
              <Text style={[styles.rowRole, { color: colors.text_muted }]}>{`  ·  ${member.team_role}`}</Text>
            ) : null}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
            Coach{member.team ? `  ·  ${member.team}` : ''}
          </Text>
        </View>
      </Pressable>
      <View style={styles.contactRow}>
        {phone && (
          <>
            <ContactBtn label="Call" onPress={() => callPhone('call')} colors={colors} />
            <ContactBtn label="Text" onPress={() => callPhone('text')} colors={colors} />
          </>
        )}
        {email && <ContactBtn label="Email" onPress={openEmail} colors={colors} />}
        <ContactBtn label="Edit" onPress={onEdit} colors={colors} muted />
      </View>
    </View>
  );
}

function TeammateRow({
  member, colors, onEdit, onOpen,
}: {
  member: FamilyMember; colors: ReturnType<typeof useTheme>['colors'];
  onEdit: () => void; onOpen: () => void;
}) {
  const band = ageBand(member.age);
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable style={styles.rowMain} onPress={onOpen}>
        <Text style={styles.rowAvatar}>{member.avatar_emoji}</Text>
        <View style={styles.rowText}>
          <Text style={[styles.rowName, { color: colors.text_primary }]} numberOfLines={1}>
            {member.firstName}
            {member.team_role ? (
              <Text style={[styles.rowRole, { color: colors.text_muted }]}>{`  ·  ${member.team_role}`}</Text>
            ) : null}
          </Text>
          <Text style={[styles.rowMeta, { color: colors.text_muted }]} numberOfLines={1}>
            {member.age != null ? `${member.age}y · ${BAND_LABEL[band]}` : 'Teammate'}
            {' · '}
            {member.skillLevel.replace(/_/g, ' ')}
            {member.team ? `  ·  ${member.team}` : ''}
          </Text>
        </View>
        <Text style={[styles.rowChevron, { color: colors.text_muted }]}>›</Text>
      </Pressable>
      {/* 2026-05-22 — Inline trend strip. Fetches per-teammate junior
          history on mount; renders the sparkline + last/avg score
          summary so the captain can scan the team at a glance without
          tapping into each member. */}
      <TeammateTrendStrip memberId={member.id} colors={colors} />
      <Pressable
        onPress={onEdit}
        hitSlop={8}
        style={[styles.rowEdit, { borderColor: colors.border }]}
      >
        <Text style={[styles.rowEditText, { color: colors.text_muted }]}>Edit</Text>
      </Pressable>
    </View>
  );
}

function TeammateTrendStrip({
  memberId, colors,
}: { memberId: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  const [history, setHistory] = useState<JuniorSwingAnalysis[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const h = await getMemberSwingHistory(memberId);
      if (!cancelled) setHistory(h);
    })();
    return () => { cancelled = true; };
  }, [memberId]);

  if (!history) return null;

  // 2026-06-23 (honesty) — base the latest/delta numbers on REAL graded swings
  // only (shared realGradedHistory), matching the sparkline. Placeholder/estimated
  // scores never feed a fabricated delta. Need ≥2 real grades to show a trend.
  const graded = realGradedHistory(history);
  if (graded.length < 2) return null;

  const latest = graded[graded.length - 1]?.overallScore ?? 0;
  const prior = graded[graded.length - 2]?.overallScore ?? latest;
  const delta = latest - prior;

  return (
    <View style={[styles.trendStrip, { borderColor: colors.border }]}>
      <View style={styles.trendChart}>
        <JuniorSwingTrendChart
          history={history}
          width={170}
          height={36}
          color={colors.accent}
        />
      </View>
      <View style={styles.trendNumbers}>
        <Text style={[styles.trendLatest, { color: colors.text_primary }]}>{latest}</Text>
        <Text
          style={[
            styles.trendDelta,
            { color: delta >= 3 ? '#86efac' : delta <= -3 ? '#f87171' : colors.text_muted },
          ]}
        >
          {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${delta}`}
        </Text>
      </View>
    </View>
  );
}

function ContactBtn({
  label, onPress, colors, muted,
}: {
  label: string; onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.contactBtn,
        { borderColor: muted ? colors.border : colors.accent, backgroundColor: muted ? colors.surface_elevated : 'rgba(0,200,150,0.10)' },
      ]}
    >
      <Text style={[styles.contactBtnText, { color: muted ? colors.text_muted : colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Editor modal ───────────────────────────────────────────────────────

interface EditableDraft {
  firstName: string;
  nickname: string;
  relationship: FamilyRelationship;
  age: string;
  skillLevel: SkillLevel;
  handedness: FamilyMember['handedness'];
  avatar_emoji: string;
  team: string;
  team_role: string;
  phone: string;
  email: string;
}

function emptyDraft(kind: CaptainRoleId, defaultTeam = ''): EditableDraft {
  return {
    firstName: '',
    nickname: '',
    relationship: kind,
    age: '',
    skillLevel: kind === 'coach' ? 'competitive' : 'developing',
    handedness: 'right',
    avatar_emoji: kind === 'coach' ? '👨‍🏫' : '🏌️‍♀️',
    team: defaultTeam,
    team_role: kind === 'coach' ? 'Head Coach' : '',
    phone: '',
    email: '',
  };
}

function EditorModal({
  draft, setDraft, isEdit, onSave, onArchive, onRemove, onClose, colors,
}: {
  draft: EditableDraft;
  setDraft: (next: EditableDraft) => void;
  isEdit: boolean;
  onSave: () => void; onArchive: () => void; onRemove: () => void; onClose: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const update = <K extends keyof EditableDraft>(k: K, v: EditableDraft[K]) => setDraft({ ...draft, [k]: v });
  const isCoach = draft.relationship === 'coach';

  return (
    <View style={styles.modalScrim}>
      <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.modalHeader}>
          <Text style={[styles.modalTitle, { color: colors.text_primary }]}>
            {isEdit ? 'Edit' : 'Add'} {isCoach ? 'coach' : 'teammate'}
          </Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={[styles.modalClose, { color: colors.text_muted }]}>Close</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <DraftField label="First name" value={draft.firstName} onChange={(v) => update('firstName', v)} placeholder="Mia" colors={colors} />
          <DraftField label="Nickname (optional)" value={draft.nickname} onChange={(v) => update('nickname', v)} placeholder="Mimi / Killer" colors={colors} />
          <DraftField label="Team role" value={draft.team_role} onChange={(v) => update('team_role', v)} placeholder={isCoach ? 'Head Coach' : 'Senior · #1'} colors={colors} />
          <DraftField label="Team" value={draft.team} onChange={(v) => update('team', v)} placeholder="Heritage HS Varsity Girls" colors={colors} />

          {!isCoach && (
            <DraftField label="Age" value={draft.age} onChange={(v) => update('age', v.replace(/[^0-9]/g, '').slice(0, 3))} placeholder="16" keyboardType="number-pad" colors={colors} />
          )}

          {!isCoach && (
            <DraftPicker
              label="Skill"
              value={draft.skillLevel}
              options={SKILL_LEVELS.map((s) => ({ id: s.id, label: s.label }))}
              onChange={(v) => update('skillLevel', v as SkillLevel)}
              colors={colors}
            />
          )}

          {!isCoach && (
            <DraftPicker
              label="Handedness"
              value={draft.handedness}
              options={HANDEDNESS.map((h) => ({ id: h.id, label: h.label }))}
              onChange={(v) => update('handedness', v as FamilyMember['handedness'])}
              colors={colors}
            />
          )}

          {isCoach && (
            <>
              <DraftField label="Phone" value={draft.phone} onChange={(v) => update('phone', v)} placeholder="(555) 123-4567" keyboardType="number-pad" colors={colors} />
              <DraftField label="Email" value={draft.email} onChange={(v) => update('email', v)} placeholder="coach@heritagehs.edu" colors={colors} />
            </>
          )}

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>Avatar</Text>
            <View style={styles.emojiRow}>
              {EMOJI_PALETTE.map((e) => {
                const active = e === draft.avatar_emoji;
                return (
                  <Pressable
                    key={e}
                    onPress={() => update('avatar_emoji', e)}
                    style={[styles.emojiPill, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : colors.surface_elevated }]}
                  >
                    <Text style={styles.emojiPillText}>{e}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable onPress={onSave} style={[styles.primaryBtn, { backgroundColor: colors.accent, marginTop: 18 }]}>
            <Text style={styles.primaryBtnText}>{isEdit ? 'Save changes' : `Add ${isCoach ? 'coach' : 'teammate'}`}</Text>
          </Pressable>
          {isEdit && (
            <View style={styles.dangerRow}>
              <Pressable onPress={onArchive} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={[styles.secondaryBtnText, { color: colors.text_muted }]}>Archive</Text>
              </Pressable>
              <Pressable onPress={onRemove} style={[styles.secondaryBtn, { borderColor: '#7f1d1d' }]}>
                <Text style={[styles.secondaryBtnText, { color: '#f87171' }]}>Remove…</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function DraftField({
  label, value, onChange, placeholder, keyboardType, colors,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'number-pad';
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text_primary }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text_muted}
        keyboardType={keyboardType ?? 'default'}
      />
    </View>
  );
}

function DraftPicker({
  label, value, options, onChange, colors,
}: {
  label: string; value: string;
  options: { id: string; label: string }[]; onChange: (v: string) => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.text_muted }]}>{label}</Text>
      <View style={styles.pickerRow}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => onChange(o.id)}
              style={[styles.pill, { borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accent_muted : colors.surface_elevated }]}
            >
              <Text style={[styles.pillText, { color: active ? colors.accent : colors.text_muted, fontWeight: active ? '700' : '500' }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  headerBack: { flex: 1 },
  headerBackText: { fontSize: 14, fontWeight: '600' },
  headerTitle: { flex: 2, textAlign: 'center', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  scroll: { padding: 16, gap: 12 },

  teamCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  teamLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  teamName: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  teamEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  teamInput: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, fontWeight: '700' },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  smallBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 12, letterSpacing: 0.5 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 2, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  sectionAdd: { fontSize: 13, fontWeight: '800' },

  emptyRow: { borderWidth: 1, borderRadius: 12, padding: 14 },
  emptyText: { fontSize: 12, fontStyle: 'italic' },

  row: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowAvatar: { fontSize: 28 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '800' },
  rowRole: { fontSize: 12, fontWeight: '600' },
  rowMeta: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  rowChevron: { fontSize: 22, fontWeight: '300' },
  rowEdit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-end' },
  rowEditText: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  contactBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  contactBtnText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  tipCard: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 6, marginTop: 4 },
  tipTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  tipBody: { fontSize: 12, lineHeight: 18 },

  primaryBtn: { paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, alignItems: 'center' },
  primaryBtnText: { color: '#0a1410', fontWeight: '900', fontSize: 14, letterSpacing: 0.6 },
  secondaryBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  secondaryBtnText: { fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  dangerRow: { flexDirection: 'row', gap: 10, marginTop: 12 },

  modalScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', paddingTop: 80, paddingHorizontal: 16 },
  modalCard: { borderRadius: 18, borderWidth: 1, padding: 18, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalClose: { fontSize: 13, fontWeight: '700' },
  modalBody: { gap: 12, paddingBottom: 24 },

  field: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  fieldInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  pillText: { fontSize: 12, letterSpacing: 0.3 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojiPill: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  emojiPillText: { fontSize: 22 },

  broadcastCard: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginTop: 8 },
  broadcastEmpty: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6, marginTop: 8 },
  broadcastHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  broadcastTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  broadcastCount: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  broadcastHint: { fontSize: 12, lineHeight: 18 },
  broadcastInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 96, textAlignVertical: 'top',
  },
  broadcastButtonRow: { flexDirection: 'row', gap: 10 },

  trendStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingTop: 8, paddingHorizontal: 4,
    borderTopWidth: 1, marginTop: 4,
  },
  trendChart: { flex: 1 },
  trendNumbers: { alignItems: 'flex-end', minWidth: 56 },
  trendLatest: { fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  trendDelta: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },

  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: -2 },
  templatePill: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1,
  },
  templatePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});
