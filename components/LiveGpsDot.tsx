/**
 * 2026-06-11 — Tiny, non-blocking on-course GPS quality dot.
 *
 * Wraps the existing GPSQuality indicator in its dot-only mode (no text) and
 * feeds it live from gpsManager, so it's a zero-prop drop-in for any header or
 * status corner. Deliberately minimal per the voice-first / minimal-distraction
 * philosophy — an 8px red/yellow/green dot, never a text pill that blocks the
 * on-course view. Tap handling is intentionally NOT here; the GpsHealthBanner
 * owns the "GPS unhealthy → tap to recalibrate" recovery affordance.
 *
 * Data source: subscribes to gpsManager for immediacy + a 5s re-eval so the
 * dot can flip to 'stale' even when fixes stop arriving (classifyAccuracy reads
 * staleness off the fix timestamp). Renders nothing until a round is active so
 * it doesn't show a dot on menus/off-course screens.
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribe, getLastFix } from '../services/gpsManager';
import { classifyAccuracy, type GPSQualityReading } from '../services/smartFinderService';
import { useRoundStore } from '../store/roundStore';
import GPSQuality from './smartfinder/GPSQuality';

function currentReading(): GPSQualityReading {
  const f = getLastFix();
  return classifyAccuracy(f?.accuracy_m ?? null, f?.timestamp ?? null);
}

export function LiveGpsDot({ showText = false }: { showText?: boolean }) {
  const isRoundActive = useRoundStore(s => s.isRoundActive);
  const [reading, setReading] = useState<GPSQualityReading>(currentReading);

  useEffect(() => {
    if (!isRoundActive) return;
    const update = () => setReading(currentReading());
    update();
    const unsub = subscribe(update);          // fires on every accepted fix
    const id = setInterval(update, 5_000);    // catches 'stale' when fixes stop
    return () => { unsub(); clearInterval(id); };
  }, [isRoundActive]);

  if (!isRoundActive) return null;
  return <GPSQuality reading={reading} showText={showText} />;
}

/**
 * Global non-blocking mount (Option A). A single root-level overlay that pins
 * the live GPS dot into the top-right status corner during a round, BELOW the
 * system status bar (insets.top) so it clears the owner ROUND-ACTIVE debug
 * badge that sits at the very top. pointerEvents="none" on the wrapper means it
 * can NEVER intercept a tap or block any control on any screen — it's purely a
 * visual status pip. Easy to relocate: change top/right here.
 */
export function GlobalGpsDotOverlay() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        right: 14,
        zIndex: 9998, // just under the owner debug badge (9999)
      }}
    >
      <LiveGpsDot />
    </View>
  );
}
