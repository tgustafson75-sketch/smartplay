/**
 * features/smartCaddie/components/CaddieCard.tsx
 *
 * Consolidated Hole Strategy + Caddie Advice card.
 * Shows: yardage, caddie advice text, tappable club selector (logs overrides),
 * pressure/miss bias badges, confidence/style, shot result recording, commit CTA.
 * All shot data is persisted via logShot + addRoundShot.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, Pressable } from 'react-native';
import { Palette, Radius } from '../../../constants/theme';
import { CLUBS } from '../types/club';
import type { ClubName } from '../types/club';
import type { TrackedShot, ShotResult } from '../hooks/useShotTracking';
import { getRiskLabel, getRiskColor } from '../engine/RiskEngine';
import { useRoundStore } from '../hooks/useRoundStore';
import type { ConfidenceLevel } from '../engine/ConfidenceEngine';
import type { PressureLevel } from '../engine/PressureEngine';
import type { PlayStyle } from '../engine/DecisionModifier';
import type { PredictedMiss } from '../engine/ShotPrediction';

const RESULTS: ShotResult[] = ['good', 'short', 'long', 'left', 'right'];

const RESULT_COLORS: Record<ShotResult, string> = {
  good:  Palette.positive,
  short: '#FACC15',
  long:  '#FACC15',
  left:  '#F87171',
  right: '#F87171',
};

interface Props {
  advice:          string;
  distance:        number;
  recommendedClub: ClubName;
  logShot:         (shot: Omit<TrackedShot, 'timestamp'>) => void;
  recordResult?:   (timestamp: number, result: ShotResult) => void;
  target?:         number;
  risk?:           number;
  todayStatus?:    string;
  confidence?:     ConfidenceLevel;
  pressure?:       PressureLevel;
  style?:          PlayStyle;
  predictedMiss?:  PredictedMiss;
  onCyclePressure?: () => void;
  effectivePressure?: PressureLevel;
  miss?: 'right' | 'left' | 'balanced';
  missLabel?: string;
  onCycleMiss?: () => void;
  /** Pass true while the voice caddie is speaking */
  isSpeaking?: boolean;
}

export const CaddieCard = ({
  advice, distance, recommendedClub, logShot, recordResult,
  target, risk, todayStatus, confidence, pressure, style, predictedMiss,
  onCyclePressure, effectivePressure, miss, missLabel, onCycleMiss, isSpeaking,
}: Props) => {
  const { addRoundShot } = useRoundStore();
  const [selectedClub, setSelectedClub] = useState<ClubName>(recommendedClub);
  const [open, setOpen] = useState(false);
  const [lastTimestamp, setLastTimestamp] = useState<number | null>(null);
  const [resultRecorded, setResultRecorded] = useState(false);

  useEffect(() => {
    setSelectedClub(recommendedClub);
    setLastTimestamp(null);
    setResultRecorded(false);
  }, [recommendedClub]);

  const handleClubSelect = (item: ClubName) => {
    setSelectedClub(item);
    setOpen(false);
    const ts = Date.now();
    setLastTimestamp(ts);
    setResultRecorded(false);
    logShot({ recommended: recommendedClub, selected: item, distance });
  };

  const activePressure = effectivePressure ?? pressure;

  return (
    <View style={{
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: 'rgba(46,204,113,0.20)',
      borderLeftWidth: 3,
      borderLeftColor: Palette.positive,
      backgroundColor: 'rgba(6,15,10,0.92)',
      padding: 14,
      marginTop: 8,
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <Text style={{ color: Palette.muted, fontSize: 9, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' }}>
          HOLE STRATEGY
        </Text>
        {isSpeaking && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: Palette.positive }} />
            <Text style={{ color: Palette.positive, fontSize: 11, fontWeight: '600' }}>Speaking</Text>
          </View>
        )}
      </View>

      {/* ── Distance + today status badge ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <Text style={{ color: Palette.textPrimary, fontSize: 20, fontWeight: '800' }}>
          {distance} yds
        </Text>
        {todayStatus && todayStatus !== 'Neutral' && (
          <View style={{
            borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3,
            backgroundColor: 'rgba(250,204,21,0.08)',
            borderWidth: 1, borderColor: 'rgba(250,204,21,0.28)',
          }}>
            <Text style={{ color: '#FACC15', fontSize: 11, fontWeight: '600' }}>
              Today: {todayStatus}
            </Text>
          </View>
        )}
      </View>

      {/* ── Caddie advice text ── */}
      <Text
        numberOfLines={3}
        ellipsizeMode="tail"
        style={{ color: Palette.positive, fontSize: 13, fontWeight: '600', lineHeight: 20, marginBottom: 9 }}
      >
        {advice}
      </Text>

      {/* ── Target / risk / predicted miss ── */}
      {(target !== undefined || (predictedMiss && predictedMiss !== 'center') || risk !== undefined) && (
        <View style={{ gap: 2, marginBottom: 9 }}>
          {target !== undefined && (
            <Text style={{ color: Palette.accent, fontSize: 12 }}>Target: {target} yds</Text>
          )}
          {predictedMiss && predictedMiss !== 'center' && (
            <Text style={{ color: '#FACC15', fontSize: 12 }}>Likely miss: {predictedMiss}</Text>
          )}
          {risk !== undefined && (
            <Text style={{ color: getRiskColor(risk), fontSize: 12 }}>Risk: {getRiskLabel(risk)}</Text>
          )}
        </View>
      )}

      {/* ── Pressure / Miss / Confidence / Style badges ── */}
      <View style={{ flexDirection: 'row', gap: 7, marginBottom: 11, flexWrap: 'wrap' }}>
        {/* Pressure */}
        <Pressable
          onPress={onCyclePressure}
          disabled={!onCyclePressure}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: activePressure === 'high' ? 'rgba(59,42,10,0.85)' : Palette.cardBg,
            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
            borderWidth: 1,
            borderColor: activePressure === 'high' ? '#FACC15' : Palette.border,
          }}
        >
          <Text style={{ fontSize: 12 }}>
            {activePressure === 'high' ? '🌡️' : '😌'}
          </Text>
          <Text style={{ color: activePressure === 'high' ? '#FACC15' : Palette.muted, fontSize: 11, fontWeight: '600' }}>
            {activePressure === 'high' ? 'High Pressure' : 'Normal'}
          </Text>
        </Pressable>

        {/* Miss bias */}
        <Pressable
          onPress={onCycleMiss}
          disabled={!onCycleMiss}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: (miss === 'right' || miss === 'left') ? 'rgba(44,31,10,0.85)' : Palette.cardBg,
            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
            borderWidth: 1,
            borderColor: (miss === 'right' || miss === 'left') ? '#FACC15' : Palette.border,
          }}
        >
          <Text style={{ fontSize: 12 }}>
            {miss === 'right' ? '➡️' : miss === 'left' ? '⬅️' : '⚖️'}
          </Text>
          <Text style={{ color: (miss === 'right' || miss === 'left') ? '#FACC15' : Palette.muted, fontSize: 11, fontWeight: '600' }}>
            {missLabel ?? (miss === 'right' ? 'Tends Right' : miss === 'left' ? 'Tends Left' : 'Balanced')}
          </Text>
        </Pressable>

        {/* Confidence */}
        {confidence && confidence !== 'neutral' && (
          <View style={{
            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: confidence === 'high' ? 'rgba(20,83,45,0.8)' : 'rgba(59,31,31,0.8)',
            borderWidth: 1,
            borderColor: confidence === 'high' ? 'rgba(46,204,113,0.35)' : 'rgba(248,113,113,0.35)',
          }}>
            <Text style={{ color: confidence === 'high' ? Palette.positive : '#F87171', fontSize: 11, fontWeight: '600' }}>
              {confidence === 'high' ? 'High Conf' : confidence === 'low' ? 'Low Conf' : 'Med Conf'}
            </Text>
          </View>
        )}

        {/* Play style */}
        {style && style !== 'normal' && (
          <View style={{
            borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
            backgroundColor: 'rgba(30,41,59,0.8)',
            borderWidth: 1, borderColor: 'rgba(147,197,253,0.28)',
          }}>
            <Text style={{ color: '#93C5FD', fontSize: 11, fontWeight: '600' }}>{style}</Text>
          </View>
        )}
      </View>

      {/* ── Club selector ── */}
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: 'rgba(46,204,113,0.09)',
          borderRadius: Radius.sm,
          paddingHorizontal: 13, paddingVertical: 10,
          borderWidth: 1, borderColor: 'rgba(46,204,113,0.28)',
        }}
      >
        <Text style={{ color: Palette.textPrimary, fontSize: 15, fontWeight: '700' }}>
          {selectedClub}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {selectedClub !== recommendedClub && (
            <Text style={{ color: Palette.muted, fontSize: 11 }}>rec: {recommendedClub}</Text>
          )}
          <Text style={{ color: Palette.muted, fontSize: 12 }}>{open ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <FlatList
          data={CLUBS as unknown as ClubName[]}
          keyExtractor={(item) => item}
          style={{ maxHeight: 200, marginTop: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: Palette.border }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleClubSelect(item)}
              style={{
                paddingHorizontal: 13, paddingVertical: 9,
                borderBottomWidth: 1, borderBottomColor: Palette.borderSubtle,
                backgroundColor: item === selectedClub ? Palette.bgActive : 'transparent',
              }}
            >
              <Text style={{
                color: item === recommendedClub ? Palette.positive : Palette.textPrimary,
                fontSize: 14,
                fontWeight: item === selectedClub ? '700' : '400',
              }}>
                {item}{item === recommendedClub ? '  ✓ rec' : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Shot result recording (appears after club is selected) ── */}
      {recordResult && lastTimestamp !== null && !resultRecorded && (
        <View style={{ marginTop: 10 }}>
          <Text style={{ color: Palette.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 7 }}>
            HOW DID THAT GO?
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {RESULTS.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => {
                  recordResult(lastTimestamp, r);
                  addRoundShot({
                    recommended: recommendedClub,
                    selected:    selectedClub,
                    distance,
                    result:      r,
                    timestamp:   lastTimestamp,
                  });
                  setResultRecorded(true);
                }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7,
                  borderRadius: 7,
                  borderWidth: 1,
                  borderColor: RESULT_COLORS[r],
                  backgroundColor: 'rgba(0,0,0,0.25)',
                }}
              >
                <Text style={{ color: RESULT_COLORS[r], fontSize: 13, fontWeight: '600' }}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {resultRecorded && (
        <Text style={{ color: Palette.positive, fontSize: 12, marginTop: 8, fontWeight: '600' }}>
          ✓ Shot logged
        </Text>
      )}

      {/* ── Commit CTA ── */}
      <Text style={{ color: Palette.muted, fontSize: 11, marginTop: 11, fontStyle: 'italic', letterSpacing: 0.2 }}>
        Commit to your shot. Trust your swing.
      </Text>
    </View>
  );
};



