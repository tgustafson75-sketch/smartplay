/**
 * features/smartCaddie/components/CaddieCard.tsx
 *
 * Primary SmartCaddie UI card — shows yardage, caddie advice, and a
 * tappable club selector that pre-populates from the recommender engine.
 * Calls logShot when the user overrides the recommended club so the
 * adaptation engine can learn from repeated preferences.
 *
 * Usage:
 *   <CaddieCard advice={caddie.advice} distance={caddie.distance}
 *               recommendedClub={caddie.recommendedClub} logShot={logShot} />
 */

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
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
  good:  '#4ADE80',
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
  /** Called when user records the outcome of the last shot */
  recordResult?:   (timestamp: number, result: ShotResult) => void;
  /** Best target yardage from TargetSelector */
  target?:         number;
  /** Risk score from RiskEngine */
  risk?:           number;
  /** Today swing status label from TodaySwing (e.g. 'Hitting short') */
  todayStatus?:    string;
  /** Confidence level from ConfidenceEngine */
  confidence?:     ConfidenceLevel;
  /** Pressure level from PressureEngine */
  pressure?:       PressureLevel;
  /** Play style from DecisionModifier */
  style?:          PlayStyle;
  /** Predicted most likely miss direction from dispersion model */
  predictedMiss?:  PredictedMiss;
}

export const CaddieCard = ({ advice, distance, recommendedClub, logShot, recordResult, target, risk, todayStatus, confidence, pressure, style, predictedMiss }: Props) => {
  const { addRoundShot } = useRoundStore();
  const [selectedClub, setSelectedClub] = useState<ClubName>(recommendedClub);
  const [open, setOpen] = useState(false);
  const [lastTimestamp, setLastTimestamp] = useState<number | null>(null);
  const [resultRecorded, setResultRecorded] = useState(false);

  // Sync recommendation when distance (and thus recommendedClub) changes.
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

  return (
    <View style={{
      backgroundColor: '#0B3D2E',
      padding: 16,
      borderRadius: 12,
      marginTop: 10,
    }}>
      {todayStatus && todayStatus !== 'Neutral' && (
        <View style={{
          backgroundColor: '#1A3A2A',
          borderRadius: 6,
          paddingHorizontal: 10,
          paddingVertical: 4,
          marginBottom: 8,
          alignSelf: 'flex-start',
          borderLeftWidth: 3,
          borderLeftColor: todayStatus === 'Hitting long' ? '#FACC15' : '#F87171',
        }}>
          <Text style={{ color: '#D1FAE5', fontSize: 12 }}>
            Today: {todayStatus}
          </Text>
        </View>
      )}

      <Text style={{ color: '#fff', fontSize: 18 }}>
        {distance} yds
      </Text>

      <Text style={{ color: '#A5F3C7', fontSize: 16, marginTop: 8 }}>
        {advice}
      </Text>

      {target !== undefined && (
        <Text style={{ color: '#4ADE80', fontSize: 15, marginTop: 8 }}>
          Target: {target} yds
        </Text>
      )}

      {predictedMiss && predictedMiss !== 'center' && (
        <Text style={{ color: '#FACC15', fontSize: 13, marginTop: 4 }}>
          Likely miss: {predictedMiss}
        </Text>
      )}

      {risk !== undefined && (
        <Text style={{ color: getRiskColor(risk), fontSize: 14, marginTop: 4 }}>
          Risk: {getRiskLabel(risk)}
        </Text>
      )}

      {/* ── Confidence + Pressure badges ── */}
      {(confidence || pressure || style) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {confidence && confidence !== 'neutral' && (
            <View style={{
              backgroundColor: confidence === 'high' ? '#14532D' : '#3B1F1F',
              borderRadius: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}>
              <Text style={{
                color: confidence === 'high' ? '#4ADE80' : '#F87171',
                fontSize: 11,
              }}>
                Confidence: {confidence}
              </Text>
            </View>
          )}
          {pressure && (
            <View style={{
              backgroundColor: pressure === 'high' ? '#3B2A0A' : '#1A3A2A',
              borderRadius: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}>
              <Text style={{
                color: pressure === 'high' ? '#FACC15' : '#9CA3AF',
                fontSize: 11,
              }}>
                Pressure: {pressure}
              </Text>
            </View>
          )}
          {style && style !== 'normal' && (
            <View style={{
              backgroundColor: '#1E293B',
              borderRadius: 5,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}>
              <Text style={{ color: '#93C5FD', fontSize: 11 }}>
                {style}
              </Text>
            </View>
          )}
        </View>
      )}

      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        style={{
          marginTop: 12,
          padding: 10,
          backgroundColor: '#14532D',
          borderRadius: 8,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 16 }}>
          Club: {selectedClub}
        </Text>
      </TouchableOpacity>

      {open && (
        <FlatList
          data={CLUBS as unknown as ClubName[]}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => handleClubSelect(item)}
              style={{ padding: 8 }}
            >
              <Text style={{
                color: item === recommendedClub ? '#4ADE80' : '#fff',
                fontSize: 15,
              }}>
                {item}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Shot result recording ── */}
      {recordResult && lastTimestamp !== null && !resultRecorded && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 6 }}>
            How did that shot go?
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
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  backgroundColor: '#1A4731',
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: RESULT_COLORS[r],
                }}
              >
                <Text style={{ color: RESULT_COLORS[r], fontSize: 13 }}>
                  {r}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {resultRecorded && (
        <Text style={{ color: '#4ADE80', fontSize: 12, marginTop: 8 }}>
          ✓ Shot logged
        </Text>
      )}
    </View>
  );
};



