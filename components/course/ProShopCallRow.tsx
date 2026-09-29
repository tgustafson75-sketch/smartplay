/**
 * 2026-09-29 (Tim — "I still use GolfNow only for tee times") — CALL THE PRO SHOP.
 *
 * The pro-shop number has been fetched (api/course-places) and saved into the course book
 * (caddieMemoryStore) since June, and no screen ever showed it. This is that half: a call button and
 * the one-line script of what to ask for, beside the tee-time buttons on Course Detail and the Play
 * tab. Renders NOTHING when the course book has no dialable number — no dead button.
 *
 * The number and the script come from services/teeTimeLink, the same owner the find_tee_time tool
 * uses, so the screen and the caddie say the same thing.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { buildTeeTimeCallScript, callProShop, telUrl, type TeeTimeRequest } from '../../services/teeTimeLink';

/** The course book's pro-shop number for this course, live (it lands after the Places lookup). */
export function useProShopPhone(courseId: string | null | undefined): string | null {
  const phone = useCaddieMemoryStore((s) => (courseId ? s.courseBook?.[courseId]?.phone ?? null : null));
  return telUrl(phone) ? (phone as string).trim() : null;
}

export function ProShopCallRow({ courseId, request, style }: {
  courseId: string | null | undefined;
  style?: StyleProp<ViewStyle>;
  /** What the player is after, when the screen knows it. The profile's rate category is always added. */
  request?: Omit<TeeTimeRequest, 'rateCategory'>;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const phone = useProShopPhone(courseId);
  const rateCategory = usePlayerProfileStore((s) => s.rateCategory);
  if (!phone) return null;
  const script = buildTeeTimeCallScript({ ...(request ?? {}), rateCategory });
  return (
    <View style={[s.wrap, style]}>
      <TouchableOpacity
        style={[s.callBtn, { borderColor: colors.border }]}
        onPress={() => { void callProShop(phone); }}
        accessibilityRole="button"
        accessibilityLabel={t('course.pro_shop.call_a11y', { phone })}
      >
        <Ionicons name="call-outline" size={16} color={colors.accent} style={{ marginRight: 6 }} />
        <Text style={[s.callText, { color: colors.text_primary }]}>{t('course.pro_shop.call')}</Text>
        <Text style={[s.phone, { color: colors.text_muted }]} numberOfLines={1}>{phone}</Text>
      </TouchableOpacity>
      {script ? (
        <Text style={[s.script, { color: colors.text_muted }]} selectable>
          {t('course.pro_shop.ask_for', { script })}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginBottom: 10 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  callText: { fontSize: 14, fontWeight: '800' },
  phone: { fontSize: 13, fontWeight: '600', marginLeft: 8, flexShrink: 1 },
  script: { fontSize: 12, lineHeight: 17, marginTop: 6, textAlign: 'center' },
});

export default ProShopCallRow;
