/**
 * Phase 402 — manual club picker modal.
 *
 * Renders as a centered sheet when cageStore.clubMenuOpen is true.
 * Triggered by:
 *   - the club_menu voice intent (services/intents/clubHandler.ts)
 *   - tapping the current-club chip in the cage session header
 *   - the vision-capture flow falling through on low confidence
 *
 * Tapping a club calls cageStore.setActiveClub(id, 'manual', 'high')
 * which closes the prior ClubSegment and opens a new one. Cancel just
 * closes the modal without changing the active club.
 *
 * Catalog mirrors app/cage/index.tsx's CLUBS array — kept here so the
 * modal can mount inside CageSessionOverlay without pulling a screen
 * import. When the bag-onboarding flow lands, this list will be
 * replaced by the user's actual configured bag.
 */

import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCageStore } from '../../store/cageStore';
import type { ClubId } from '../../services/clubRecognition';

type ClubOption = { label: string; value: ClubId };

const CLUB_OPTIONS: ClubOption[] = [
  { label: 'Driver', value: 'DR' },
  { label: '3W', value: '3W' },
  { label: '5W', value: '5W' },
  { label: '7W', value: '7W' },
  { label: '3H', value: '3H' },
  { label: '4H', value: '4H' },
  { label: '5H', value: '5H' },
  { label: '3I', value: '3I' },
  { label: '4I', value: '4I' },
  { label: '5I', value: '5I' },
  { label: '6I', value: '6I' },
  { label: '7I', value: '7I' },
  { label: '8I', value: '8I' },
  { label: '9I', value: '9I' },
  { label: 'PW', value: 'PW' },
  { label: 'GW', value: 'GW' },
  { label: 'SW', value: 'SW' },
  { label: 'LW', value: 'LW' },
  { label: 'Putter', value: 'PT' },
];

/**
 * 2026-05-24 — Props-overridable refactor. Default (no props) preserves
 * the cage-store-driven behavior the cage UI relies on. Passing
 * `open` / `onClose` / `onPick` flips the modal into standalone mode so
 * other surfaces (SmartMotion, Quick Record) can reuse it without
 * mutating the active cage session. Cage call site is unchanged
 * (renders `<ClubPickerModal />` with no props).
 */
interface ClubPickerModalProps {
  /** Override the cage-store-driven visibility. When undefined, falls
   *  back to cageStore.clubMenuOpen (legacy cage behavior). */
  open?: boolean;
  /** Override the cage-store close action. */
  onClose?: () => void;
  /** Override the cage-store setActiveClub mutation. When provided,
   *  the picker calls this instead of writing into cageStore. */
  onPick?: (club: ClubId) => void;
  /** Override the "currently selected" highlight. When provided, used
   *  instead of cageStore.activeSession.currentClub. */
  selected?: ClubId | null;
}

export default function ClubPickerModal(props: ClubPickerModalProps = {}) {
  const clubMenuOpen = useCageStore(s => s.clubMenuOpen);
  const setClubMenuOpen = useCageStore(s => s.setClubMenuOpen);
  const setActiveClub = useCageStore(s => s.setActiveClub);
  const cageCurrentClub = useCageStore(s => s.activeSession?.currentClub ?? s.activeSession?.club);

  const visible = props.open !== undefined ? props.open : clubMenuOpen;
  const handleClose = props.onClose ?? (() => setClubMenuOpen(false));
  const currentClub = props.selected ?? cageCurrentClub;

  const onPick = (value: ClubId) => {
    if (props.onPick) {
      props.onPick(value);
    } else {
      setActiveClub(value, 'manual', 'high');
      setClubMenuOpen(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pick a club</Text>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close club picker"
            >
              <Ionicons name="close" size={22} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.grid}>
            {CLUB_OPTIONS.map(opt => {
              const isActive = currentClub === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => onPick(opt.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${opt.label}`}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * 2026-05-24 — Map ClubId (the UI / picker / sole-recognition canonical
 * form) to the lowercase key used by services/swingMetricsService.ts's
 * TYPICAL_SMASH_BY_CLUB table. Honest fallbacks for clubs not in the
 * smash table ('AW' → 'gw' approximation; 'PT' / hybrids → 'unknown'
 * since the smash heuristic doesn't model them). Exported so callers
 * can pass the right key into the synthesizer.
 */
export function clubIdToSmashKey(id: ClubId | null | undefined): string {
  if (!id) return 'unknown';
  switch (id) {
    case 'DR': return 'driver';
    case '3W': return '3w';
    case '5W': return '5w';
    case '7W': return '5w';
    case '2H':
    case '3H':
    case '4H':
    case '5H': return 'hybrid';
    case '3I': return '4i';
    case '4I': return '4i';
    case '5I': return '5i';
    case '6I': return '6i';
    case '7I': return '7i';
    case '8I': return '8i';
    case '9I': return '9i';
    case 'PW': return 'pw';
    case 'GW': return 'gw';
    case 'AW': return 'gw';
    case 'SW': return 'sw';
    case 'LW': return 'lw';
    case 'PT': return 'unknown';
    case 'unknown': return 'unknown';
    default: return 'unknown';
  }
}

/**
 * 2026-06-09 — Map ClubId to the key used by the server's acoustic
 * ball-speed table (api/acoustic-detect.ts CLUB_TYPICAL: D / 3W / 5W / H /
 * 3I…9I / PW / GW / SW / LW). Clubs the table doesn't model (putter,
 * unknown) return 'unknown' so the server honestly returns a null ball
 * speed rather than scaling to a wrong club.
 */
export function clubIdToServerKey(id: ClubId | null | undefined): string {
  if (!id) return 'unknown';
  switch (id) {
    case 'DR': return 'D';
    case '3W': return '3W';
    case '5W': return '5W';
    case '7W': return '5W';
    case '2H':
    case '3H':
    case '4H':
    case '5H': return 'H';
    case '3I': return '3I';
    case '4I': return '4I';
    case '5I': return '5I';
    case '6I': return '6I';
    case '7I': return '7I';
    case '8I': return '8I';
    case '9I': return '9I';
    case 'PW': return 'PW';
    case 'GW':
    case 'AW': return 'GW';
    case 'SW': return 'SW';
    case 'LW': return 'LW';
    default: return 'unknown';
  }
}

/** Human-readable club label for surfacing on metric cards. */
export function clubIdLabel(id: ClubId | null | undefined): string {
  if (!id || id === 'unknown') return 'Untagged';
  return CLUB_OPTIONS.find(o => o.value === id)?.label ?? String(id);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-start',
  },
  chip: {
    minWidth: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f1620',
    alignItems: 'center',
  },
  chipActive: {
    borderColor: '#00C896',
    backgroundColor: 'rgba(0, 200, 150, 0.15)',
  },
  chipText: {
    color: '#e8f5e9',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  chipTextActive: {
    color: '#00C896',
  },
});
