/**
 * MY BAG — the bag itself, not a scanner. (2026-07-23 Bag Vision; rewritten 2026-09-14.)
 *
 * WHAT WAS WRONG, in Tim's words: "The bag setup in profile opens the camera, it actually scanned
 * most of my clubs but the clubs from that scan do not persist and update the bag everywhere… When
 * you go back to the bag in profile, it's the camera from the start again."
 *
 * Two separate defects, and the first one explains the second.
 *
 * 1. THE SAVE BUTTON WAS OFF THE BOTTOM OF THE SCREEN. The review list was a `<ScrollView>` with no
 *    `flex: 1`, followed by a footer holding the only control that wrote anything. React Native's
 *    `flexShrink` defaults to 0 (unlike CSS), so a ScrollView sized by its content pushes its
 *    siblings out of the viewport — and the MORE clubs the scan read, the further off-screen the
 *    button went. A scan that read three clubs saved; a scan that read the whole bag could not.
 *    Its sibling screen, app/arccos-import, never had this because its confirm button sits INSIDE
 *    the scroll. [[built-is-not-reachable]]
 *
 * 2. THE SCREEN HAD NO STATE BUT "CAMERA". Even a successful scan left nothing to come back to, so
 *    reopening looked identical to never having scanned — which is exactly how a working save and a
 *    broken one look the same.
 *
 * SO THE SCREEN IS NOW THE BAG. It opens on what you own, grouped like a rack. Scanning is an
 * action you take FROM the bag, and a scan MERGES — Tim: "If it persists the first time, then
 * anything it missed I can take a picture of." There is no confirm step to miss and no transient
 * review state to lose: a scan writes, and everything it wrote is editable in place, including
 * removal. Nothing can be typed into this screen and then evaporate.
 *
 * WHAT IT EDITS. One record per PHYSICAL club (store/clubBagStore variants): head brand/model/loft,
 * plus the shaft and grip that were the actual difference between his three drivers and existed
 * nowhere in the app. Shaft/grip values come from services/clubSpecOptions so they can be grouped
 * and compared rather than typed four ways.
 *
 * HONESTY: only clubs actually seen are listed (never padded to 14); brand/model stay blank when
 * not legible rather than guessed; a blank field from a scan never erases something you typed.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../contexts/ThemeContext';
import { safeBack } from '../services/safeBack';
import { useSettingsStore } from '../store/settingsStore';
import { scanBagFromVideo, scanBagFromPhotos, type ScannedBall, type BagScanResult } from '../services/bagScan';
import {
  useClubBagStore, specsOf, inPlayVariant, hasAnySpec, PUTTER_ID,
  type RegisteredClub, type ClubSpecs,
} from '../store/clubBagStore';
import { usePlayerProfileStore } from '../store/playerProfileStore';
import { CLUB_SNAP_ORDER, clubFamily } from '../services/clubBagReconcile';
import { SHAFT_BRANDS, GRIP_SIZES, shaftWeightsFor, hasShaftWeight } from '../services/clubSpecOptions';
import { STANDARD_SET } from '../services/standardBag';
import { SpecPicker } from '../components/SpecPicker';
import type { ClubId } from '../services/clubRecognition';
import { useTranslation } from 'react-i18next';

type Phase = 'bag' | 'scanning';

const VIDEO_MAX_SECONDS = 10;
const MAX_PHOTOS = 8;

/**
 * The rack, in the order a bag is actually laid out. Derived from the one catalog so a club added to
 * CLUB_SNAP_ORDER cannot quietly fail to appear on the only screen that edits it — the last section
 * takes everything the named ones did not claim, and is asserted non-silent below.
 */
const SECTIONS: readonly { key: string; families: readonly string[] }[] = [
  { key: 'woods', families: ['DR', 'W'] },
  { key: 'hybrids', families: ['H'] },
  { key: 'irons', families: ['I'] },
  { key: 'wedges', families: ['WEDGE'] },
  { key: 'putter', families: ['PT'] },
];

export default function BagScreen() {
  /**
   * 2026-09-13 — OFFERED ONCE, AND ONLY ONCE.
   *
   * decideFirstRunRoute sends a fresh install here when the registered bag is empty, so the caddie
   * does not start the first round with bagClubs: []. A first-run arrival has NO back stack, so
   * safeBack() lands on '/' and the router re-evaluates immediately — if this flag were set on
   * "done" instead of on arrival, skipping would put the player straight back here, forever. This
   * mirrors permissions.tsx, which sets its flag on every exit from the screen.
   */
  useEffect(() => {
    try { useSettingsStore.getState().markTutorialSeen('bag_setup_offered'); } catch { /* a flag we could not set is not a reason to block the bag */ }
  }, []);

  const { t } = useTranslation();
  const { colors } = useTheme();
  const clubs = useClubBagStore((s) => s.clubs);
  const currentBall = usePlayerProfileStore((s) => s.currentBall);
  const [phase, setPhase] = useState<Phase>('bag');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * 2026-09-18 (Tim) — "new registration forces photo or video. Give users option to skip for
   * later in profile."
   *
   * THE ONLY WAYS INTO THIS SCREEN WERE A CAMERA. Video pan, take a photo, pick photos — three
   * doors, one key. A player who will not point a camera at their clubs on the first launch of an
   * app they have owned for ninety seconds had no way to end up with a bag at all, and this screen
   * is the fourth step of first run, so that player was standing in front of a wall.
   *
   * So there is a typed path (`manualOpen`) and an explicit way out (`firstRunOffer`).
   */
  const [manualOpen, setManualOpen] = useState(false);
  /**
   * Was this screen OPENED BY FIRST RUN, or did the player walk here themselves?
   *
   * Read in a state INITIALISER, which runs during the first render — before the effect above
   * commits and sets `bag_setup_offered`. Same two facts decideFirstRunRoute used to send them
   * here, so "Skip for now" appears exactly when the app chose this screen for the player, and
   * never when the player chose it (they have a back arrow and a bag they came to edit).
   */
  const [firstRunOffer] = useState(() => {
    try {
      const offered = !!useSettingsStore.getState().tutorialsSeen?.['bag_setup_offered'];
      return !offered && useClubBagStore.getState().carriedList().length === 0;
    } catch { return false; }
  });
  /** What the last scan did, shown until the next one. Reads as a receipt, not as a pending action. */
  const [lastScan, setLastScan] = useState<{ added: string[]; updated: string[]; balls: ScannedBall[] } | null>(null);

  const owned = useMemo(() => Object.values(clubs), [clubs]);
  const ownedCount = owned.length;

  const bySection = useMemo(() => {
    const claimed = new Set<string>();
    const out = SECTIONS.map((sec) => {
      const list = CLUB_SNAP_ORDER
        .filter((id) => sec.families.includes(clubFamily(id)))
        .map((id) => { claimed.add(id); return clubs[id]; })
        .filter((c): c is RegisteredClub => !!c);
      return { key: sec.key, clubs: list };
    });
    /**
     * A catalog id belonging to no section would be owned and invisible — the exact shape of bug
     * this screen exists to end. Surfaced as a real section rather than swallowed.
     */
    const orphans = CLUB_SNAP_ORDER.filter((id) => !claimed.has(id) && clubs[id]);
    if (orphans.length > 0) out.push({ key: 'other', clubs: orphans.map((id) => clubs[id]) });
    return out.filter((s) => s.clubs.length > 0);
  }, [clubs]);

  /**
   * Fold a scan into the bag. The only writer on this screen, so "what a scan does" is one sentence
   * in one place: it adds what is new, sharpens what it recognises, and never deletes.
   */
  const applyScan = useCallback((result: BagScanResult) => {
    const store = useClubBagStore.getState();
    const before = new Set(Object.keys(store.clubs));
    const added: string[] = [];
    const updated: string[] = [];
    for (const c of result.clubs) {
      const isNew = !before.has(c.club_id);
      store.registerClub(c.club_id as ClubId, {
        source: 'camera',
        brand: c.brand || undefined,
        model: c.model || undefined,
        loft: c.loft || undefined,
      });
      (isNew ? added : updated).push(c.club_id);
    }
    setLastScan({ added, updated, balls: result.balls });
    return added.length + updated.length;
  }, []);

  const runScan = useCallback(async (run: () => Promise<BagScanResult>) => {
    setError(null);
    setPhase('scanning');
    const result = await run();
    setPhase('bag');
    if (result.clubs.length === 0 && result.balls.length === 0) {
      setError(t('bag.error.nothing_read'));
      return;
    }
    applyScan(result);
  }, [applyScan, t]);

  const recordAndScan = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError(t('bag.error.camera_permission')); return; }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: VIDEO_MAX_SECONDS,
        quality: 0.7,
        allowsEditing: false,
      });
    } catch {
      setError(t('bag.error.camera_open'));
      return;
    }
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    await runScan(() => scanBagFromVideo(uri));
  }, [runScan, t]);

  /**
   * 2026-09-14 (Tim) — "Add ability to add photos for review too." The repair pass: whatever the pan
   * missed, photograph it. Library rather than camera so a photo he already took counts, and
   * multi-select so the stragglers go in one call rather than one round trip each.
   */
  const pickPhotosAndScan = useCallback(async () => {
    setError(null);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        selectionLimit: MAX_PHOTOS,
        quality: 0.8,
      });
    } catch {
      setError(t('bag.error.photos_open'));
      return;
    }
    if (result.canceled || !result.assets?.length) return;
    const uris = result.assets.map((a) => a.uri).filter(Boolean);
    await runScan(() => scanBagFromPhotos(uris));
  }, [runScan, t]);

  const takePhotoAndScan = useCallback(async () => {
    setError(null);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setError(t('bag.error.camera_permission')); return; }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    } catch {
      setError(t('bag.error.camera_open'));
      return;
    }
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    await runScan(() => scanBagFromPhotos([uri]));
  }, [runScan, t]);

  const removeClub = useCallback((club_id: string, label: string) => {
    Alert.alert(
      t('bag.remove.title'),
      t('bag.remove.body', { club: label }),
      [
        { text: t('bag.remove.cancel'), style: 'cancel' },
        {
          text: t('bag.remove.confirm'),
          style: 'destructive',
          onPress: () => {
            useClubBagStore.getState().removeClub(club_id as ClubId);
            setExpanded(null);
          },
        },
      ],
    );
  }, [t]);

  /**
   * ADD A CLUB BY HAND. One tap, one slot, `source: 'manual'` — the same registration the scan and
   * the voice declaration make, written by the same store method, so a hand-typed bag is not a
   * second-class bag anywhere downstream. Brand, shaft and grip are then typed into the very same
   * row editor a scanned club uses: the manual path adds NO new place a club can live.
   * [[two-owners-is-the-root-cause]]
   */
  const addManually = useCallback((club_id: string) => {
    useClubBagStore.getState().registerClub(club_id as ClubId, { source: 'manual' });
  }, []);

  /**
   * 2026-09-18 (Tim) — "We have a default mid handicapper bag like an off the rack set would have."
   *
   * Fourteen taps is not a manual path, it is a chore, and the player most likely to need the typed
   * route is the one who just declined to film anything. So the off-the-rack set goes in in one
   * press and they take out what they do not carry — the same direction of travel as a scan, which
   * also puts clubs in and lets you remove them.
   *
   * ADDITIVE, like every other writer on this screen: a club already in the bag is left exactly as
   * it is, specs and variants and all, so pressing this on a half-filled bag can never overwrite
   * something that was scanned or typed. The receipt is the SAME receipt a scan writes, because
   * "what just went in" is one fact, not one per source.
   */
  const addStandardSet = useCallback(() => {
    const store = useClubBagStore.getState();
    const added: string[] = [];
    for (const id of STANDARD_SET) {
      if (store.clubs[id]) continue;
      store.registerClub(id, { source: 'manual' });
      added.push(id);
    }
    setLastScan({ added, updated: [], balls: [] });
  }, []);

  const s = makeStyles(colors);

  if (phase === 'scanning') {
    return (
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={s.dim}>{t('bag.scanning')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => safeBack()} style={s.headerBtn} accessibilityRole="button" accessibilityLabel={t('bag_scan.accessibility_label.back')}>
          <Ionicons name="chevron-back" size={24} color={colors.text_primary} />
        </TouchableOpacity>
        <Text style={s.title}>{t('bag.title')}</Text>
        <View style={s.headerBtn} />
      </View>

      {/* flex: 1 is not cosmetic — without it this ScrollView sizes to its content and pushes
          everything below it off the screen, which is the defect that lost every long scan. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        {ownedCount === 0 ? (
          <View style={s.emptyBlock}>
            <Ionicons name="golf-outline" size={44} color={colors.accent} />
            <Text style={s.pitch}>{t('bag.empty.title')}</Text>
            <Text style={s.dim}>{t('bag.empty.body')}</Text>
          </View>
        ) : (
          <Text style={s.countLine}>{t('bag.count', { count: ownedCount })}</Text>
        )}

        {error && <Text style={s.err}>{error}</Text>}

        {lastScan && (
          <View style={s.receipt}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accent} />
            <Text style={s.receiptText}>
              {lastScan.added.length > 0 ? t('bag.receipt.added', { count: lastScan.added.length }) : t('bag.receipt.nothing_new')}
              {lastScan.updated.length > 0 ? ` ${t('bag.receipt.updated', { count: lastScan.updated.length })}` : ''}
            </Text>
          </View>
        )}

        {/* A ball read out of the same frames. Never written silently — it is the ball every future
            round is stamped with and compared by, so it is offered, not assumed. */}
        {lastScan?.balls.map((b) => (
          <View key={`${b.brand}-${b.model}`} style={s.ballRow}>
            <Ionicons name="ellipse-outline" size={16} color={colors.accent_sky} />
            <View style={{ flex: 1 }}>
              <Text style={s.ballTitle}>{[b.brand, b.model].filter(Boolean).join(' ')}</Text>
              <Text style={s.ballSub}>{t('bag.ball.seen')}</Text>
            </View>
            {currentBall === b.model ? (
              <Text style={s.ballSet}>{t('bag.ball.in_play')}</Text>
            ) : (
              <TouchableOpacity
                onPress={() => usePlayerProfileStore.getState().setCurrentBall(b.model)}
                style={s.ballBtn}
                accessibilityRole="button"
              >
                <Text style={s.ballBtnText}>{t('bag.ball.play_this')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {bySection.map((sec) => (
          <View key={sec.key}>
            <Text style={s.sectionHead}>{t(`bag.section.${sec.key}`)}</Text>
            {sec.clubs.map((c) => (
              <ClubRow
                key={c.club_id}
                club={c}
                expanded={expanded === c.club_id}
                onToggle={() => setExpanded(expanded === c.club_id ? null : c.club_id)}
                onRemove={removeClub}
              />
            ))}
          </View>
        ))}

        {/* The actions live INSIDE the scroll, deliberately. Every control that writes is reachable
            at every bag size, which the footer they replaced was not. */}
        <Text style={s.sectionHead}>{t('bag.add.heading')}</Text>
        {/* FIRST, deliberately. The camera is the fast path, not the only path — and the player
            who is going to refuse the camera finds out before they have refused three times. */}
        <TouchableOpacity
          onPress={() => setManualOpen((v) => !v)}
          style={[s.actionBtn, manualOpen && s.actionBtnOpen]}
          accessibilityRole="button"
          accessibilityState={{ expanded: manualOpen }}
          accessibilityLabel={t('bag.add.manual_a11y')}
        >
          <Ionicons name="create-outline" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('bag.add.manual')}</Text>
            <Text style={s.actionSub}>{t('bag.add.manual_sub')}</Text>
          </View>
          <Ionicons name={manualOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text_muted} />
        </TouchableOpacity>

        {manualOpen && (
          <View style={s.manualPanel}>
            <Text style={s.manualHint}>{t('bag.manual.hint')}</Text>
            <TouchableOpacity
              onPress={addStandardSet}
              style={s.standardBtn}
              accessibilityRole="button"
              accessibilityLabel={t('bag.manual.standard_a11y')}
            >
              <Ionicons name="albums-outline" size={16} color={colors.accent_sky} />
              <View style={{ flex: 1 }}>
                <Text style={s.standardTitle}>{t('bag.manual.standard')}</Text>
                <Text style={s.standardSub}>{t('bag.manual.standard_sub')}</Text>
              </View>
            </TouchableOpacity>
            <View style={s.chipWrap}>
              {/* The one catalog, in bag order — so a club added to CLUB_SNAP_ORDER is typeable the
                  day it exists, and the hand path can never offer a club the scan cannot. */}
              {CLUB_SNAP_ORDER.map((id) => {
                const owned = !!clubs[id];
                const label = id === PUTTER_ID ? t('bag.putter') : id;
                return (
                  <TouchableOpacity
                    key={id}
                    onPress={() => (owned ? removeClub(id, label) : addManually(id))}
                    style={[s.clubChip, owned && s.clubChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: owned }}
                    accessibilityLabel={owned ? t('bag.manual.remove_a11y', { club: label }) : t('bag.manual.add_a11y', { club: label })}
                  >
                    {owned && <Ionicons name="checkmark" size={13} color={colors.accent} />}
                    <Text style={[s.clubChipText, owned && s.clubChipTextOn]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
        <TouchableOpacity onPress={recordAndScan} style={s.actionBtn} accessibilityRole="button" accessibilityLabel={t('bag.add.video_a11y')}>
          <Ionicons name="videocam-outline" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('bag.add.video')}</Text>
            <Text style={s.actionSub}>{t('bag.add.video_sub')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={takePhotoAndScan} style={s.actionBtn} accessibilityRole="button" accessibilityLabel={t('bag.add.photo_a11y')}>
          <Ionicons name="camera-outline" size={18} color={colors.accent_sky} />
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('bag.add.photo')}</Text>
            <Text style={s.actionSub}>{t('bag.add.photo_sub')}</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={pickPhotosAndScan} style={s.actionBtn} accessibilityRole="button" accessibilityLabel={t('bag.add.library_a11y')}>
          <Ionicons name="images-outline" size={18} color={colors.accent_sky} />
          <View style={{ flex: 1 }}>
            <Text style={s.actionTitle}>{t('bag.add.library')}</Text>
            <Text style={s.actionSub}>{t('bag.add.library_sub')}</Text>
          </View>
        </TouchableOpacity>

        {/**
          * SKIP, SAID OUT LOUD — and told where it went.
          *
          * Skipping was always POSSIBLE: the header chevron runs safeBack(), the flag is set on
          * mount, and nothing traps the player. But on a first-run arrival that chevron is a back
          * arrow pointing at nothing the player has seen, on a screen that has just asked them to
          * film their clubs. "Possible" and "offered" are not the same thing, and the difference
          * is whether a player who does not want to do this now believes they can come back.
          *
          * So it names the destination. Profile → My Bag is one row, it already exists, and it is
          * the same screen — the sentence is checkable rather than reassuring.
          */}
        {firstRunOffer && (
          <TouchableOpacity
            onPress={() => safeBack()}
            style={s.skipBtn}
            accessibilityRole="button"
            accessibilityLabel={t('bag.skip.a11y')}
          >
            <Ionicons name="time-outline" size={18} color={colors.text_muted} />
            <View style={{ flex: 1 }}>
              <Text style={s.skipTitle}>{t('bag.skip.title')}</Text>
              <Text style={s.skipBody}>{t('bag.skip.body')}</Text>
            </View>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One physical-club row: summary always, the full spec editor when expanded. */
function ClubRow({ club, expanded, onToggle, onRemove }: {
  club: RegisteredClub;
  expanded: boolean;
  onToggle: () => void;
  onRemove: (club_id: string, label: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const specs = specsOf(club);
  const active = inPlayVariant(club);
  const weights = shaftWeightsFor(club.club_id);

  /**
   * The summary line says what is KNOWN and nothing else. An unspecced club reads "tap to add specs"
   * rather than a row of dashes pretending to be data.
   *
   * "Unspecced" is `hasAnySpec`, not "the head line is empty" — a club whose shaft and grip are
   * recorded but whose head was never legible from a scan is a club we know things about, and
   * telling that player there is nothing here would be the screen contradicting its own next line.
   */
  const summary = [specs.brand, specs.model, specs.loft].filter(Boolean).join(' · ');
  const shaftLine = [specs.shaftBrand, specs.shaftWeight, specs.gripSize].filter(Boolean).join(' · ');
  const known = hasAnySpec(club);

  const edit = (patch: Partial<ClubSpecs>) => {
    if (active) useClubBagStore.getState().setVariantSpecs(club.club_id, active.variant_id, patch);
    else useClubBagStore.getState().setClubSpecs(club.club_id, patch);
  };

  return (
    <View style={s.card}>
      <TouchableOpacity onPress={onToggle} style={s.cardHead} accessibilityRole="button" accessibilityLabel={club.club_id}>
        <Text style={s.clubId}>{club.club_id === PUTTER_ID ? t('bag.putter') : club.club_id}</Text>
        <View style={{ flex: 1 }}>
          {summary ? <Text style={s.summary} numberOfLines={1}>{summary}</Text>
            : !known ? <Text style={s.summaryEmpty}>{t('bag.no_specs')}</Text> : null}
          {shaftLine ? <Text style={s.shaftLine} numberOfLines={1}>{shaftLine}</Text> : null}
        </View>
        {club.variants.length > 1 && (
          <View style={s.variantPill}><Text style={s.variantPillText}>{t('bag.variant_count', { count: club.variants.length })}</Text></View>
        )}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text_muted} />
      </TouchableOpacity>

      {expanded && (
        <View style={s.editor}>
          {/* Which physical club am I editing? Only shown when there is more than one, because a
              chooser over a single item is noise. */}
          {club.variants.length > 1 && (
            <View style={s.variantRow}>
              {club.variants.map((v) => (
                <TouchableOpacity
                  key={v.variant_id}
                  onPress={() => useClubBagStore.getState().setInPlayVariant(club.club_id, v.variant_id)}
                  style={[s.variantChip, v.variant_id === active?.variant_id && s.variantChipOn]}
                  accessibilityRole="button"
                >
                  <Text style={[s.variantChipText, v.variant_id === active?.variant_id && s.variantChipTextOn]}>{v.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={s.fieldRow}>
            <SpecInput label={t('bag.field.brand')} value={specs.brand} onChange={(v) => edit({ brand: v })} />
            <SpecInput label={t('bag.field.model')} value={specs.model} onChange={(v) => edit({ model: v })} />
            <SpecInput label={t('bag.field.loft')} value={specs.loft} onChange={(v) => edit({ loft: v })} flex={0.6} />
          </View>

          <SpecPicker
            label={t('bag.field.shaft_brand')}
            value={specs.shaftBrand}
            options={SHAFT_BRANDS}
            onChange={(v) => edit({ shaftBrand: v })}
          />
          <View style={s.fieldRow}>
            {/* The putter takes no shaft weight — an empty option list means no control at all,
                rather than a dropdown with nothing honest in it. */}
            {hasShaftWeight(club.club_id) && (
              <SpecPicker compact label={t('bag.field.shaft_weight')} value={specs.shaftWeight} options={weights} onChange={(v) => edit({ shaftWeight: v })} />
            )}
            <SpecPicker compact label={t('bag.field.grip_size')} value={specs.gripSize} options={GRIP_SIZES} onChange={(v) => edit({ gripSize: v })} />
          </View>

          <View style={s.editorActions}>
            <TouchableOpacity
              onPress={() => {
                const n = club.variants.length + 1;
                useClubBagStore.getState().addVariant(club.club_id, { label: t('bag.variant.default_label', { club: club.club_id, n }), source: 'manual' });
              }}
              style={s.ghostBtn}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={15} color={colors.accent} />
              <Text style={s.ghostText}>{t('bag.add_variant')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(club.club_id, club.club_id)} style={s.ghostBtn} accessibilityRole="button">
              <Ionicons name="trash-outline" size={15} color={colors.warning} />
              <Text style={[s.ghostText, { color: colors.warning }]}>{t('bag.remove_club')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

/** A labelled free-text spec. Brand / model / loft stay text: they are not closed sets. */
function SpecInput({ label, value, onChange, flex }: { label: string; value?: string; onChange: (v: string | undefined) => void; flex?: number }) {
  const { colors } = useTheme();
  const s = makeStyles(colors);
  return (
    <View style={{ flex: flex ?? 1, gap: 4 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.field}
        value={value ?? ''}
        onChangeText={(v) => onChange(v.trim() === '' ? undefined : v)}
        placeholderTextColor={colors.text_muted}
        accessibilityLabel={label}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
    headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text_primary, fontSize: 18, fontWeight: '800' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
    emptyBlock: { alignItems: 'center', gap: 10, paddingVertical: 28 },
    pitch: { color: colors.text_primary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    dim: { color: colors.text_muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    err: { color: '#F0803C', fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 10 },
    countLine: { color: colors.text_muted, fontSize: 13, fontWeight: '600', marginTop: 8 },
    receipt: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
      backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.accent,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    receiptText: { color: colors.text_primary, fontSize: 13, fontWeight: '600', flex: 1 },
    ballRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
      backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    ballTitle: { color: colors.text_primary, fontSize: 14, fontWeight: '800' },
    ballSub: { color: colors.text_muted, fontSize: 12 },
    ballSet: { color: colors.accent, fontSize: 12, fontWeight: '800' },
    ballBtn: { borderRadius: 14, borderWidth: 1, borderColor: colors.accent_sky, paddingHorizontal: 12, paddingVertical: 6 },
    ballBtnText: { color: colors.accent_sky, fontSize: 12, fontWeight: '800' },
    sectionHead: { color: colors.text_muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 20, marginBottom: 8 },
    card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
    clubId: { color: colors.text_primary, fontSize: 16, fontWeight: '900', minWidth: 48 },
    summary: { color: colors.text_primary, fontSize: 13, fontWeight: '600' },
    summaryEmpty: { color: colors.text_muted, fontSize: 13 },
    shaftLine: { color: colors.text_muted, fontSize: 12, marginTop: 1 },
    variantPill: { backgroundColor: colors.background, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
    variantPillText: { color: colors.accent_sky, fontSize: 11, fontWeight: '800' },
    editor: { paddingHorizontal: 12, paddingBottom: 12, gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
    variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    variantChip: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 5 },
    variantChipOn: { borderColor: colors.accent, backgroundColor: colors.background },
    variantChipText: { color: colors.text_muted, fontSize: 12, fontWeight: '700' },
    variantChipTextOn: { color: colors.accent },
    fieldRow: { flexDirection: 'row', gap: 8 },
    fieldLabel: { color: colors.text_muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
    field: {
      backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 10, paddingVertical: 9, color: colors.text_primary, fontSize: 13,
    },
    editorActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8 },
    ghostText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    actionBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
    },
    actionBtnOpen: { borderColor: colors.accent },
    actionTitle: { color: colors.text_primary, fontSize: 14, fontWeight: '800' },
    actionSub: { color: colors.text_muted, fontSize: 12, marginTop: 1 },
    manualPanel: { marginBottom: 8, paddingHorizontal: 2 },
    manualHint: { color: colors.text_muted, fontSize: 12, lineHeight: 17, marginBottom: 10 },
    standardBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
      backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.accent_sky,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    standardTitle: { color: colors.text_primary, fontSize: 13, fontWeight: '800' },
    standardSub: { color: colors.text_muted, fontSize: 12, marginTop: 1 },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    clubChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, paddingVertical: 9, minWidth: 54, justifyContent: 'center',
    },
    clubChipOn: { borderColor: colors.accent, backgroundColor: colors.background },
    clubChipText: { color: colors.text_muted, fontSize: 13, fontWeight: '800' },
    clubChipTextOn: { color: colors.accent },
    skipBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18,
      borderRadius: 12, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
      paddingHorizontal: 14, paddingVertical: 12,
    },
    skipTitle: { color: colors.text_primary, fontSize: 14, fontWeight: '800' },
    skipBody: { color: colors.text_muted, fontSize: 12, lineHeight: 17, marginTop: 1 },
  });
}
