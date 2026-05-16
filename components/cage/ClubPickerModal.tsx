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

export default function ClubPickerModal() {
  const clubMenuOpen = useCageStore(s => s.clubMenuOpen);
  const setClubMenuOpen = useCageStore(s => s.setClubMenuOpen);
  const setActiveClub = useCageStore(s => s.setActiveClub);
  const currentClub = useCageStore(s => s.activeSession?.currentClub ?? s.activeSession?.club);

  const onPick = (value: ClubId) => {
    setActiveClub(value, 'manual', 'high');
    setClubMenuOpen(false);
  };

  return (
    <Modal
      visible={clubMenuOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setClubMenuOpen(false)}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Pick a club</Text>
            <TouchableOpacity
              onPress={() => setClubMenuOpen(false)}
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
