/**
 * 2026-09-14 (Tim — "double check user profile set up that it has all the data we need… and make
 * sure everything in it is ingested correctly", then "Make profile setup buttons where it can be
 * and only type when needed") — THE PROFILE FORM, WHERE THE PROFILE IS.
 *
 * It lived inside `app/settings.tsx`, and `app/profile.tsx` — the screen reached by tapping the
 * profile card on the Dashboard — showed five facts out of twenty-odd and then pointed at Settings.
 * Its own header said so: the detailed fields "still live in Settings, so we don't fork the edit
 * form". That was the right instinct and the wrong resting place: the form could not move because
 * its only control, `PillRow`, was declared inside the Settings component and closed over that
 * screen's colours and styles.
 *
 * So `PillRow` came out to `components/PillRow`, and the form came here. ONE form, rendered by the
 * screen named Profile. Settings keeps a slim card and a link — it does not keep a second copy,
 * which is the whole reason this file exists rather than a paste.
 *
 * Tim looked at Profile and reported there was no experience or level, only handicap. He was right
 * about the screen and wrong about the data: `experienceContext` has existed, been editable and
 * reached the brain since 2026-09-10. Everything he could not find is below.
 *
 * BUTTONS WHERE THERE IS A KNOWN SET OF ANSWERS. A typed answer is not just slower — `goal` reaches
 * the brain verbatim, so "brek 90", "Break 90!" and "break ninety" are three different goals to
 * anything that groups or compares them. The keyboard is for the genuinely open fields (name,
 * email, GHIN, the numbers) and for an explicit "Other".
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: importing history and recalculating the index. Those are
 * actions, not fields, and they already live on the Profile screen around this form.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import { usePlayerProfileStore, isOwnerEmail, MAX_HOME_COURSES } from '../../store/playerProfileStore';
import { useToastStore } from '../../store/toastStore';
import { PillRow } from '../PillRow';
import { goToTab } from '../../services/safeBack';

/**
 * Sentinels for the two pickers that keep an escape hatch. They exist only in this component's
 * selection state — what reaches the store is always the player's own words, never a magic string.
 */
const OTHER = '__other__';
const NONE = '__none__';
const GOAL_PRESETS = ['Break 100', 'Break 90', 'Break 80', 'Lower my handicap', 'More consistent', 'Enjoy it more'];
const LIMITATION_PRESETS = ['Back', 'Shoulder', 'Knee', 'Hip', 'Wrist / elbow'];

/**
 * A labelled text field.
 *
 * DECLARED AT MODULE LEVEL, and that is not a style preference. Defined inside `ProfileForm` it
 * would be a NEW component type on every render, so React would unmount and remount the TextInput
 * on each keystroke — the keyboard closes after every character and the caret jumps. Caught before
 * this shipped; it is the kind of defect that reads as "the app is broken" rather than as a bug.
 */
function Field({ label, styles: fs, muted, ...rest }: {
  label: string;
  styles: { inputLabel: object; input: object };
  muted: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <>
      <Text style={fs.inputLabel}>{label}</Text>
      <TextInput style={fs.input} placeholderTextColor={muted} accessibilityLabel={label} {...rest} />
    </>
  );
}

export function ProfileForm() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const p = usePlayerProfileStore();

  // Text fields commit on Save (or on blur where the store is the only copy).
  const [editName, setEditName] = useState(p.name ?? '');
  const [editBest, setEditBest] = useState(p.personalBest != null ? String(p.personalBest) : '');
  const [editLongestDrive, setEditLongestDrive] = useState(p.longestDrive != null ? String(p.longestDrive) : '');
  const [editLongestPutt, setEditLongestPutt] = useState(p.longestPuttFeet != null ? String(p.longestPuttFeet) : '');
  const [editIndex, setEditIndex] = useState(p.handicap_index != null ? String(p.handicap_index) : '');
  const [editGhin, setEditGhin] = useState(p.ghin_number ?? '');
  const [editEmail, setEditEmail] = useState(p.email ?? '');
  const [editCreds, setEditCreds] = useState(p.coachCredentials ?? '');
  const [editGoal, setEditGoal] = useState(p.goal ?? '');
  const [editLimitation, setEditLimitation] = useState(p.physicalLimitation ?? '');
  const [goalOtherOpen, setGoalOtherOpen] = useState(false);
  const [limitationOtherOpen, setLimitationOtherOpen] = useState(false);

  const goalIsPreset = GOAL_PRESETS.includes(editGoal.trim());
  const limitationIsPreset = LIMITATION_PRESETS.includes(editLimitation.trim());

  /**
   * ONE EDITABLE HANDICAP, AND IT IS THE INDEX (2026-09-13). `handicap` is a mirror that
   * `setHandicapIndex` keeps in step; a second box wired to `setHandicap` left the index stale and
   * the two disagreed for good. [[two-owners-is-the-root-cause]]
   */
  const save = () => {
    if (editName.trim()) p.setName(editName.trim());
    p.setGoal(editGoal.trim() || null);
    p.setPhysicalLimitation(editLimitation.trim() || null);
    const best = parseInt(editBest, 10);
    p.setPersonalBest(Number.isFinite(best) ? best : null);
    const drv = parseInt(editLongestDrive, 10);
    p.setLongestDrive(Number.isFinite(drv) && drv > 0 ? drv : null);
    const putt = parseInt(editLongestPutt, 10);
    p.setLongestPuttFeet(Number.isFinite(putt) && putt > 0 ? putt : null);
    p.setCoachCredentials(editCreds.trim() || null);
    useToastStore.getState().show(t('profile.form.saved'));
  };

  return (
    <View style={s.card}>
      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.name')}
        value={editName}
        onChangeText={setEditName}
        placeholder={t('settings.placeholder.your_name')}
        autoCapitalize="words"
      />

      <PillRow
        label={t('profile.form.im_a')}
        options={[
          { label: 'Golfer', value: 'golfer' },
          { label: 'Instructor', value: 'instructor' },
          { label: 'Student', value: 'student' },
        ]}
        value={p.role}
        onSelect={(v) => p.setRole(v as 'golfer' | 'instructor' | 'student')}
      />

      {p.role === 'instructor' && (
        <Field
          styles={s}
          muted={colors.text_muted}
          label={t('settings.text.credentials_shown_on_swing_reports')}
          value={editCreds}
          onChangeText={setEditCreds}
          onBlur={() => p.setCoachCredentials(editCreds.trim() || null)}
          placeholder={t('settings.placeholder.e_g_lpga_class_a')}
        />
      )}

      {/* ── WHERE YOU'RE AT ─────────────────────────────────────────────────
          The one Tim could not find. It drives coachingAdaptation's tone and complexity and
          api/kevin's coaching depth — it has never been missing, only buried. */}
      <PillRow
        label={t('settings.label.where_you_re_at')}
        options={[
          { label: 'Starting', value: 'starting' },
          { label: 'Improving', value: 'improving' },
          { label: 'Returning', value: 'returning' },
          { label: 'Competitive', value: 'competitive' },
        ]}
        value={p.experienceContext ?? ''}
        onSelect={(v) => p.setExperienceContext(v as 'starting' | 'improving' | 'returning' | 'competitive')}
      />

      <PillRow
        label={t('settings.text.goal')}
        options={[
          ...GOAL_PRESETS.map((g) => ({ label: g, value: g })),
          { label: 'Other', value: OTHER },
        ]}
        value={goalIsPreset ? editGoal.trim() : (editGoal.trim() ? OTHER : '')}
        onSelect={(v) => { setGoalOtherOpen(v === OTHER); setEditGoal(v === OTHER ? '' : v); }}
      />
      {!goalIsPreset && (editGoal.trim().length > 0 || goalOtherOpen) && (
        <TextInput
          style={s.input}
          value={editGoal}
          onChangeText={setEditGoal}
          placeholder={t('settings.placeholder.e_g_break_90')}
          placeholderTextColor={colors.text_muted}
          accessibilityLabel={t('settings.text.goal')}
        />
      )}

      <PillRow
        label={t('settings.label.handedness')}
        options={[{ label: 'Right', value: 'right' }, { label: 'Left', value: 'left' }]}
        value={p.handedness}
        onSelect={(v) => p.setHandedness(v as 'right' | 'left')}
      />

      <PillRow
        label={t('settings.label.dominant_miss')}
        options={[
          { label: 'Left', value: 'left' },
          { label: 'Right', value: 'right' },
          { label: 'Straight', value: 'straight' },
        ]}
        value={p.dominantMiss ?? ''}
        onSelect={(v) => p.setDominantMiss(v as 'left' | 'right' | 'straight')}
      />

      {/* Richer than dominantMiss (direction only); the setter DERIVES dominantMiss from it, so
          setting this keeps the two in step rather than splitting them. Read by ball-fit. */}
      <PillRow
        label={t('settings.label.typical_miss')}
        options={[
          { label: 'Slice', value: 'slice' }, { label: 'Hook', value: 'hook' },
          { label: 'Pull', value: 'pull' }, { label: 'Push', value: 'push' },
          { label: 'Thin', value: 'thin' }, { label: 'Fat', value: 'fat' },
          { label: 'Varies', value: 'varies' },
        ]}
        value={p.missType ?? ''}
        onSelect={(v) => p.setMissType(v as 'slice' | 'hook' | 'thin' | 'fat' | 'pull' | 'push' | 'varies')}
      />

      {/**
        * 2026-09-11 (Tim) — "all I do right now is full swing and not good with dialing down
        * yardages". Three features branch on this (cnsShotRead's club gapping, the override
        * adjustment, the hole plan) and every player was silently treated as 'some_partials'.
        */}
      <PillRow
        label={t('settings.label.how_you_cover_a_number')}
        options={[
          { label: 'Full swings', value: 'full_swings' },
          { label: 'Some partials', value: 'some_partials' },
          { label: 'I dial down', value: 'dial_down' },
        ]}
        value={p.distanceControl ?? ''}
        onSelect={(v) => p.setDistanceControl(v as 'full_swings' | 'some_partials' | 'dial_down')}
      />

      <PillRow
        label={t('settings.label.preferred_tee')}
        options={[
          { label: 'Front', value: 'front' }, { label: 'Middle', value: 'middle' }, { label: 'Back', value: 'back' },
        ]}
        value={p.preferredTee}
        onSelect={(v) => p.setPreferredTee(v as 'front' | 'middle' | 'back')}
      />

      <PillRow
        label={t('settings.label.default_round_mode')}
        options={[
          { label: 'Break 100', value: 'break_100' }, { label: 'Break 90', value: 'break_90' },
          { label: 'Break 80', value: 'break_80' }, { label: 'Just play', value: 'free_play' },
        ]}
        value={p.default_mode ?? ''}
        onSelect={(v) => p.setDefaultMode(v as 'break_100' | 'break_90' | 'break_80' | 'free_play')}
      />

      <PillRow
        label={t('settings.text.physical_note')}
        options={[
          { label: 'None', value: NONE },
          ...LIMITATION_PRESETS.map((l) => ({ label: l, value: l })),
          { label: 'Other', value: OTHER },
        ]}
        value={limitationIsPreset ? editLimitation.trim() : (editLimitation.trim() ? OTHER : NONE)}
        onSelect={(v) => { setLimitationOtherOpen(v === OTHER); setEditLimitation(v === OTHER || v === NONE ? '' : v); }}
      />
      {!limitationIsPreset && (editLimitation.trim().length > 0 || limitationOtherOpen) && (
        <TextInput
          style={s.input}
          value={editLimitation}
          onChangeText={setEditLimitation}
          placeholder={t('settings.placeholder.e_g_bad_left_knee')}
          placeholderTextColor={colors.text_muted}
          accessibilityLabel={t('settings.text.physical_note')}
        />
      )}

      {/* ── HOME COURSES ────────────────────────────────────────────────────
          Shown and removed here; CHOSEN on the Play tab, which already has search, GPS-nearest
          ordering and every course card. A second course list would be one to keep in step. */}
      <Text style={s.inputLabel}>{t('settings.label.home_courses', { max: MAX_HOME_COURSES })}</Text>
      {p.homeCourses.length === 0 ? (
        <Text style={s.helper}>{t('settings.text.no_home_courses_yet')}</Text>
      ) : (
        <View style={s.chipWrap}>
          {p.homeCourses.map((hc) => (
            <TouchableOpacity
              key={hc.id || hc.name}
              onPress={() => p.setHomeCourses(p.homeCourses.filter((x) => (x.id || x.name) !== (hc.id || hc.name)))}
              style={s.chip}
              accessibilityRole="button"
              accessibilityLabel={t('settings.accessibility_label.remove_home_course', { course: hc.name })}
            >
              <Text style={s.chipText}>{hc.name}</Text>
              <Ionicons name="close" size={14} color={colors.accent} />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity
        onPress={() => goToTab('play')}
        style={s.ghostBtn}
        accessibilityRole="button"
        accessibilityLabel={t('settings.text.choose_home_courses')}
      >
        <Ionicons name="golf-outline" size={16} color={colors.text_primary} />
        <Text style={s.ghostBtnText}>{t('settings.text.choose_home_courses')}</Text>
      </TouchableOpacity>

      {/* ── NUMBERS ─────────────────────────────────────────────────────────
          Genuinely open values. A picker of every handicap from +4 to 54 would be worse than a
          keyboard, which is the line "buttons where it can be" draws. */}
      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.handicap_index_usga')}
        value={editIndex}
        onChangeText={(v: string) => {
          setEditIndex(v);
          const n = parseFloat(v);
          if (Number.isFinite(n)) p.setHandicapIndex(n);
          else if (v === '') p.setHandicapIndex(null);
        }}
        keyboardType="decimal-pad"
        placeholder="e.g. 18.0"
      />

      {/* Which rating set the course handicap comes from. Courses are rated twice and the two sets
          share yardages, so reading the wrong one hands out a wrong stroke allowance on a scorecard
          that looks perfectly right. Unset means we hold to one internally consistent set. */}
      <PillRow
        label={t('settings.label.course_rating_set')}
        options={[{ label: "Men's", value: 'm' }, { label: "Women's", value: 'f' }, { label: 'Not set', value: 'x' }]}
        value={p.handicap_gender}
        onSelect={(v) => p.setHandicapGender(v as 'm' | 'f' | 'x')}
      />

      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.ghin_number')}
        value={editGhin}
        onChangeText={(v: string) => { setEditGhin(v); p.setGhinNumber(v); }}
        keyboardType="numbers-and-punctuation"
        placeholder="e.g. 1234567"
      />
      <Text style={s.helper}>{t('settings.text.optional_we_ll_pull_your')}</Text>

      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.personal_best')}
        value={editBest}
        onChangeText={setEditBest}
        keyboardType="numeric"
        placeholder={t('settings.placeholder.best_round_score')}
      />

      {/* longestDrive auto-updates from logShot when a Driver beats the record; longestPuttFeet is
          manual and in FEET — putts are counted per hole, not measured, so nothing can derive it. */}
      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.longest_drive_yards')}
        value={editLongestDrive}
        onChangeText={setEditLongestDrive}
        keyboardType="numeric"
        placeholder="e.g. 280"
      />
      <Text style={s.helper}>{t('settings.text.updated_automatically_as_you_log')}</Text>

      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.longest_putt_feet')}
        value={editLongestPutt}
        onChangeText={setEditLongestPutt}
        keyboardType="numeric"
        placeholder="e.g. 38"
      />
      <Text style={s.helper}>{t('settings.text.manual_entry_for_now')}</Text>

      <Field
        styles={s}
        muted={colors.text_muted}
        label={t('settings.text.account_email')}
        value={editEmail}
        onChangeText={(v: string) => { setEditEmail(v); p.setEmail(v.trim() || null); }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={t('settings.placeholder.you_email_com')}
      />
      <Text style={s.helper}>
        {isOwnerEmail(editEmail) ? t('settings.text.optional_owner_tools_unlocked') : t('settings.text.optional_owner_devices_enter_your')}
      </Text>

      <TouchableOpacity style={s.saveBtn} onPress={save} accessibilityRole="button">
        <Text style={s.saveBtnText}>{t('settings.text.save_profile')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    card: {
      marginHorizontal: 16, marginTop: 10, borderRadius: 14, borderWidth: 1,
      borderColor: colors.border, backgroundColor: colors.surface, padding: 16,
    },
    inputLabel: { color: colors.text_secondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10, color: colors.text_primary, fontSize: 15,
    },
    helper: { color: colors.text_muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1,
      borderColor: colors.accent, paddingHorizontal: 12, paddingVertical: 7,
    },
    chipText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
    ghostBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      borderRadius: 20, borderWidth: 1, borderColor: colors.border, paddingVertical: 11, marginTop: 6,
    },
    ghostBtnText: { color: colors.text_primary, fontWeight: '700', fontSize: 14 },
    saveBtn: {
      marginTop: 22, borderRadius: 22, backgroundColor: colors.accent,
      paddingVertical: 13, alignItems: 'center',
    },
    saveBtnText: { color: '#0d1a0d', fontWeight: '800', fontSize: 15 },
  });
}

export default ProfileForm;
