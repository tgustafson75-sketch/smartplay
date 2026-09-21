/**
 * ADDED PLAYERS — tabs at the top, editable names, their own handicap, and an export.
 *
 * 2026-09-20 (Tim, from Echo Hills). He tapped the Competition chip expecting to add a card for his
 * daughter, and said what this should be:
 *
 *   "Dont want add player hidden behind tournament. OG version had tabs at the top and I could edit
 *    names and we could add putting the players hdcp and an export button but we dont inject the
 *    data from that card to the primary user data."
 *
 * So it is rebuilt from the V3 original (reference-builds/legacy-freeze scorecard): a tab row with
 * the owner first badged YOU, guests beside him with tap-to-edit names, a per-hole +/- card, and
 * totals. What the OG did NOT have and he asked for: a per-player Handicap Index, and an export.
 *
 * THE ISOLATION IS THE POINT. Every score here lives in guestCardStore, never roundStore. A guest's
 * number cannot reach the owner's card, his handicap posting, his recap or the caddie payload,
 * because it is not in the structure any of those read. See that file's header.
 *
 * NET IS SHOWN ONLY WHEN AN INDEX WAS TYPED. No Index means gross only — the app does not invent a
 * handicap for a guest to make a column look full. [[illustration-data-points]]
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView, Share, Alert,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import AppIcon from '../AppIcon';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import {
  useGuestCardStore, grossTotal, holesPlayed, netTotal, MAX_GUEST_CARDS, type GuestCard,
} from '../../store/guestCardStore';

interface Props {
  /** Holes of the round being scored, so the card matches the course the player is on. */
  holes: { hole: number; par: number }[];
  courseName: string | null;
  /** The owner's name for the first tab. Read-only here — this screen never edits his profile. */
  ownerName: string;
  /** The owner's own scores, for the export only. Never written to. */
  ownerScores: Record<number, number>;
}

export function AddedPlayerCards({ holes, courseName, ownerName, ownerScores }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const cards = useGuestCardStore((s) => s.cards);
  const addCard = useGuestCardStore((s) => s.addCard);
  const removeCard = useGuestCardStore((s) => s.removeCard);
  const setName = useGuestCardStore((s) => s.setName);
  const setHandicap = useGuestCardStore((s) => s.setHandicap);
  const bumpScore = useGuestCardStore((s) => s.bumpScore);
  const clearAll = useGuestCardStore((s) => s.clearAll);

  /** 0 = the owner's tab (read-only summary); 1..n = guest cards. */
  const [activeTab, setActiveTab] = useState(0);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [hcpDraft, setHcpDraft] = useState<string | null>(null);

  const nineHole = holes.length <= 9;
  const active: GuestCard | null = activeTab > 0 ? (cards[activeTab - 1] ?? null) : null;

  const label = useCallback(
    (card: GuestCard, idx: number) => card.name.trim() || `Player ${idx + 2}`,
    [],
  );

  const onAdd = useCallback(() => {
    const made = addCard('');
    if (!made) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(useGuestCardStore.getState().cards.length);
  }, [addCard]);

  /**
   * The export Tim asked for, plus the read he wants to promote: "Would be good promo to be able to
   * export a caddies read on the guest /added players own round."
   *
   * Every line is computed from the scores on the card — pars, birdies, the best and worst holes,
   * the run of the round. Nothing is inferred about a swing we never saw, because this player never
   * put a swing through SmartMotion; claiming otherwise would be the fabrication the whole app is
   * built against. [[illustration-data-points]] [[honesty-ethos-came-from-the-backyard-net]]
   */
  const buildExport = useCallback((card: GuestCard): string => {
    const name = card.name.trim() || 'Player';
    const played = holes.filter((h) => (card.scores[h.hole] ?? 0) > 0);
    const gross = grossTotal(card);
    const par = played.reduce((a, h) => a + h.par, 0);
    const vs = gross - par;
    const net = netTotal(card, 113, nineHole ? 9 : 18);

    const lines: string[] = [];
    lines.push(`${name} — ${courseName ?? 'Round'}`);
    lines.push(`${played.length} hole${played.length === 1 ? '' : 's'} · ${gross || '—'} gross` +
      (played.length ? ` (${vs === 0 ? 'level' : vs > 0 ? `+${vs}` : vs} vs par)` : ''));
    if (net != null) lines.push(`Net ${net} (Index ${card.handicapIndex})`);
    lines.push('');

    const row = (l: string, vals: (string | number)[]) =>
      l.padEnd(4, ' ') + ' ' + vals.map((v) => String(v).padStart(3, ' ')).join(' ');
    lines.push(row('HOLE', holes.map((h) => h.hole)));
    lines.push(row('PAR', holes.map((h) => h.par)));
    lines.push(row('SCR', holes.map((h) => card.scores[h.hole] ?? '—')));
    lines.push('');

    if (played.length >= 3) {
      lines.push("Caddie's read");
      const byVs = played
        .map((h) => ({ hole: h.hole, par: h.par, vs: (card.scores[h.hole] ?? 0) - h.par }))
        .sort((a, b) => a.vs - b.vs);
      const best = byVs[0];
      const worst = byVs[byVs.length - 1];
      const counts = { under: 0, level: 0, bogey: 0, worse: 0 };
      for (const h of byVs) {
        if (h.vs < 0) counts.under++;
        else if (h.vs === 0) counts.level++;
        else if (h.vs === 1) counts.bogey++;
        else counts.worse++;
      }
      lines.push(`· ${counts.under} under, ${counts.level} at par, ${counts.bogey} bogey, ${counts.worse} worse`);
      lines.push(`· Best: hole ${best.hole} (par ${best.par}, ${best.vs === 0 ? 'par' : best.vs > 0 ? `+${best.vs}` : best.vs})`);
      if (worst.vs >= 2) lines.push(`· Cost the most: hole ${worst.hole} at +${worst.vs}`);
      const par3 = played.filter((h) => h.par === 3);
      const par5 = played.filter((h) => h.par === 5);
      const avgVs = (set: typeof played) =>
        set.length ? set.reduce((a, h) => a + ((card.scores[h.hole] ?? 0) - h.par), 0) / set.length : null;
      const p3 = avgVs(par3);
      const p5 = avgVs(par5);
      if (p3 != null && par3.length >= 2) lines.push(`· Par 3s: ${p3 >= 0 ? '+' : ''}${p3.toFixed(1)} a hole`);
      if (p5 != null && par5.length >= 2) lines.push(`· Par 5s: ${p5 >= 0 ? '+' : ''}${p5.toFixed(1)} a hole`);
      if (counts.worse === 0 && played.length >= 6) lines.push('· No blow-ups — the card held together all the way round.');
      lines.push('');
    }
    lines.push('Kept on SmartPlay Caddie');
    return lines.join('\n');
  }, [holes, courseName, nineHole]);

  const onExport = useCallback(async (card: GuestCard) => {
    if (holesPlayed(card) === 0) {
      Alert.alert(t('scorecard_added_players.nothing_to_export'), t('scorecard_added_players.put_a_score_first'));
      return;
    }
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await Share.share({ message: buildExport(card) });
    } catch { /* the share sheet being dismissed is not an error */ }
  }, [buildExport]);

  const ownerSummary = useMemo(() => {
    const played = holes.filter((h) => (ownerScores[h.hole] ?? 0) > 0);
    const gross = played.reduce((a, h) => a + (ownerScores[h.hole] ?? 0), 0);
    const par = played.reduce((a, h) => a + h.par, 0);
    return { played: played.length, gross, vs: gross - par };
  }, [holes, ownerScores]);

  const s = styles(c);

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        <Text style={s.title}>{t('scorecard_added_players.players')}</Text>
        {cards.length > 0 && (
          <Pressable
            onPress={() => Alert.alert(
              t('scorecard_added_players.clear_added_players_q'),
              t('scorecard_added_players.clear_explains'),
              [{ text: t('scorecard_added_players.keep') }, { text: t('scorecard_added_players.clear'), style: 'destructive', onPress: () => { clearAll(); setActiveTab(0); } }],
            )}
            accessibilityRole="button"
            accessibilityLabel={t('scorecard_added_players.clear_a11y')}
          >
            <Text style={s.clear}>{t('scorecard_added_players.clear')}</Text>
          </Pressable>
        )}
      </View>

      {/* ── Tabs at the top: the owner, then each added player, then Add ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
        <Pressable
          onPress={() => setActiveTab(0)}
          style={[s.tab, activeTab === 0 && s.tabActive]}
          accessibilityRole="button"
          accessibilityLabel={`${ownerName}, your own card`}
        >
          <Text style={[s.tabText, activeTab === 0 && s.tabTextActive]} numberOfLines={1}>{ownerName}</Text>
          <View style={s.youPill}><Text style={s.youPillText}>{t('scorecard_added_players.you')}</Text></View>
        </Pressable>

        {cards.map((card, i) => (
          <Pressable
            key={card.id}
            onPress={() => setActiveTab(i + 1)}
            style={[s.tab, activeTab === i + 1 && s.tabActive]}
            accessibilityRole="button"
            accessibilityLabel={`${label(card, i)}'s card`}
          >
            <Text style={[s.tabText, activeTab === i + 1 && s.tabTextActive]} numberOfLines={1}>
              {label(card, i)}
            </Text>
          </Pressable>
        ))}

        {cards.length < MAX_GUEST_CARDS && (
          <Pressable onPress={onAdd} style={[s.tab, s.tabAdd]} accessibilityRole="button" accessibilityLabel={t('scorecard_added_players.add_a_player_a11y')}>
            <AppIcon name="add" size={13} color={c.accent_lime} />
            <Text style={[s.tabText, { color: c.accent_lime, marginLeft: 4 }]}>{t('scorecard_added_players.add_player')}</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* ── The owner's tab is a read-only summary: his card is the screen above this one ── */}
      {activeTab === 0 && (
        <View style={s.ownerBox}>
          <Text style={s.ownerLine}>
            {ownerSummary.played > 0
              ? `${ownerSummary.gross} through ${ownerSummary.played} (${ownerSummary.vs === 0 ? 'level' : ownerSummary.vs > 0 ? `+${ownerSummary.vs}` : ownerSummary.vs} vs par)`
              : 'Your card is above — scores you enter on the round land there.'}
          </Text>
          <Text style={s.ownerHint}>
            {cards.length === 0
              ? 'Add a player to keep a card for your partner, your kid, or a guest. Their scores stay on their own card and never touch yours or your handicap.'
              : 'Added players keep their own cards. Nothing they score affects your round or your handicap.'}
          </Text>
        </View>
      )}

      {/* ── A guest's card ── */}
      {active && (
        <View>
          <View style={s.nameRow}>
            {editingName === active.id ? (
              <TextInput
                value={active.name}
                onChangeText={(v) => setName(active.id, v)}
                onBlur={() => setEditingName(null)}
                autoFocus
                placeholder={t('scorecard_added_players.enter_player_name')}
                placeholderTextColor={c.text_muted}
                maxLength={20}
                style={s.nameInput}
                accessibilityLabel={t('scorecard_added_players.player_name_a11y')}
              />
            ) : (
              <Pressable
                onPress={() => setEditingName(active.id)}
                style={s.nameTap}
                accessibilityRole="button"
                accessibilityLabel={`Edit name, currently ${label(active, activeTab - 1)}`}
              >
                <Text style={s.nameText}>{label(active, activeTab - 1)}</Text>
                <Text style={s.nameEdit}>{t('scorecard_added_players.tap_to_edit')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                removeCard(active.id);
                setActiveTab(0);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${label(active, activeTab - 1)}`}
            >
              <Text style={s.remove}>{t('scorecard_added_players.remove')}</Text>
            </Pressable>
          </View>

          {/* Their own Index — typed, never borrowed from the owner's profile. */}
          <View style={s.hcpRow}>
            <Text style={s.hcpLabel}>{t('scorecard_added_players.handicap_index')}</Text>
            <TextInput
              value={hcpDraft !== null && editingName === null ? hcpDraft : (active.handicapIndex?.toString() ?? '')}
              onChangeText={setHcpDraft}
              onFocus={() => setHcpDraft(active.handicapIndex?.toString() ?? '')}
              onBlur={() => {
                const n = parseFloat((hcpDraft ?? '').replace(',', '.'));
                setHandicap(active.id, Number.isFinite(n) ? n : null);
                setHcpDraft(null);
              }}
              placeholder="—"
              placeholderTextColor={c.text_muted}
              keyboardType="decimal-pad"
              maxLength={5}
              style={s.hcpInput}
              accessibilityLabel={t('scorecard_added_players.their_index_a11y')}
            />
          </View>

          {/* Per-hole card */}
          <View style={s.card}>
            {holes.map((h) => {
              const score = active.scores[h.hole] ?? 0;
              const vs = score > 0 ? score - h.par : null;
              return (
                <View key={h.hole} style={s.holeRow}>
                  <Text style={s.holeNum}>H{h.hole}</Text>
                  <Text style={s.holePar}>P{h.par}</Text>
                  <Pressable
                    onPress={() => bumpScore(active.id, h.hole, -1)}
                    style={s.step}
                    accessibilityRole="button"
                    accessibilityLabel={`One less on hole ${h.hole}`}
                  >
                    <Text style={s.stepText}>−</Text>
                  </Pressable>
                  <Text style={[s.score, score === 0 && s.scoreEmpty]}>{score === 0 ? '—' : score}</Text>
                  <Pressable
                    onPress={() => bumpScore(active.id, h.hole, 1)}
                    style={s.step}
                    accessibilityRole="button"
                    accessibilityLabel={`One more on hole ${h.hole}`}
                  >
                    <Text style={s.stepText}>+</Text>
                  </Pressable>
                  {vs !== null && (
                    <Text style={[s.vs, { color: vs < 0 ? c.accent_lime : vs === 0 ? c.text_muted : c.text_secondary }]}>
                      {vs === 0 ? 'E' : vs > 0 ? `+${vs}` : vs}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          {/* Totals */}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>
              {holesPlayed(active)} of {holes.length} {t('scorecard_added_players.gross_suffix')}
            </Text>
            <Text style={s.totalValue}>{grossTotal(active) || '—'}</Text>
          </View>
          {netTotal(active, 113, nineHole ? 9 : 18) != null ? (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>{t('scorecard_added_players.net')}</Text>
              <Text style={s.totalValue}>{netTotal(active, 113, nineHole ? 9 : 18)}</Text>
            </View>
          ) : (
            <Text style={s.netHint}>{t('scorecard_added_players.net_hint')}</Text>
          )}

          <Pressable
            onPress={() => void onExport(active)}
            style={s.exportBtn}
            accessibilityRole="button"
            accessibilityLabel={`Export ${label(active, activeTab - 1)}'s card`}
          >
            <AppIcon name="share-outline" size={14} color="#04140c" />
            <Text style={s.exportText}>{t('scorecard_added_players.export_card')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

type Colors = ReturnType<typeof useTheme>['colors'];

const styles = (c: Colors) => StyleSheet.create({
  wrap: { marginTop: 18 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: c.text_primary, fontSize: 16, fontWeight: '700' },
  clear: { color: c.text_muted, fontSize: 13, fontWeight: '600' },
  tabRow: { gap: 8, paddingRight: 8, paddingBottom: 2 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
  },
  tabActive: { backgroundColor: c.surface_elevated, borderColor: c.accent_lime },
  tabAdd: { borderStyle: 'dashed' },
  tabText: { color: c.text_secondary, fontSize: 14, fontWeight: '600', maxWidth: 130 },
  tabTextActive: { color: c.text_primary, fontWeight: '700' },
  youPill: { backgroundColor: c.surface_elevated, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  youPillText: { color: c.accent_lime, fontSize: 10, fontWeight: '800' },
  ownerBox: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: c.surface },
  ownerLine: { color: c.text_primary, fontSize: 14, fontWeight: '600' },
  ownerHint: { color: c.text_muted, fontSize: 13, lineHeight: 19, marginTop: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  nameTap: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  nameText: { color: c.text_primary, fontSize: 16, fontWeight: '700' },
  nameEdit: { color: c.text_muted, fontSize: 12 },
  nameInput: {
    flex: 1, marginRight: 10, backgroundColor: c.surface, color: c.text_primary,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15,
    borderWidth: 1, borderColor: c.accent_lime,
  },
  remove: { color: c.text_muted, fontSize: 13, fontWeight: '600' },
  hcpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  hcpLabel: { color: c.text_secondary, fontSize: 14, fontWeight: '600' },
  hcpInput: {
    minWidth: 76, textAlign: 'center', backgroundColor: c.surface, color: c.text_primary,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15,
    borderWidth: 1, borderColor: c.border,
  },
  card: { marginTop: 12, borderRadius: 12, backgroundColor: c.surface, paddingVertical: 4 },
  holeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  holeNum: { color: c.text_primary, fontSize: 14, fontWeight: '700', width: 34 },
  holePar: { color: c.text_muted, fontSize: 13, width: 30 },
  step: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.surface_elevated,
  },
  stepText: { color: c.text_primary, fontSize: 19, fontWeight: '700', lineHeight: 22 },
  score: { color: c.text_primary, fontSize: 16, fontWeight: '700', width: 32, textAlign: 'center' },
  scoreEmpty: { color: c.text_muted, fontWeight: '500' },
  vs: { fontSize: 13, fontWeight: '700', width: 30 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  totalLabel: { color: c.text_secondary, fontSize: 14, fontWeight: '600' },
  totalValue: { color: c.text_primary, fontSize: 18, fontWeight: '800' },
  netHint: { color: c.text_muted, fontSize: 13, marginTop: 8, lineHeight: 18 },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: c.accent_lime,
  },
  exportText: { color: '#04140c', fontSize: 15, fontWeight: '800' },
});
