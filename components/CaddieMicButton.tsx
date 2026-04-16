/**
 * CaddieMicButton — Universal mic button used on EVERY screen.
 *
 * Reads voiceState from global voiceStore — so ALL instances across the app
 * pulse/change simultaneously when any one of them is active.
 *
 * Usage:
 *   import CaddieMicButton from '../components/CaddieMicButton';
 *   <CaddieMicButton context={{ hole: 3, distance: 165, club: '7 Iron' }} />
 *
 * The context prop passes round data to the AI so responses are hole-aware.
 */

import React from 'react';
import { Pressable, Image, Text, View, StyleSheet } from 'react-native';
import { useVoiceCaddie } from '../hooks/useVoiceCaddie';
import { useVoiceStore } from '../store/voiceStore';

const LOGO = require('../assets/images/logo.png');

interface CaddieMicButtonProps {
  /** Optional round context forwarded to the AI for contextual advice */
  context?: {
    hole?: number;
    distance?: number;
    club?: string;
    missPattern?: 'right' | 'left' | 'balanced';
    par?: number;
  };
  /** Size of the circular button — defaults to 64 */
  size?: number;
  /** Show the label below the button — defaults to true */
  showLabel?: boolean;
  /** Style override for the outer wrapper */
  style?: object;
}

export default function CaddieMicButton({
  context,
  size = 64,
  showLabel = true,
  style,
}: CaddieMicButtonProps) {
  const { triggerVoice, cancelVoice } = useVoiceCaddie();
  const voiceState    = useVoiceStore((s) => s.voiceState);
  const caddieResponse = useVoiceStore((s) => s.caddieResponse);

  const isActive = voiceState !== 'IDLE';
  const isListening = voiceState === 'LISTENING';
  const isSpeaking  = voiceState === 'SPEAKING';
  const isProcessing = voiceState === 'PROCESSING';

  // Ring color per state
  const ringColor = isSpeaking  ? '#facc15'
                  : isListening  ? '#4ade80'
                  : isProcessing ? '#60a5fa'
                  : '#4caf50';

  const label = isSpeaking   ? '🎙️ Speaking'
              : isListening   ? '🎤 Listening'
              : isProcessing  ? '⏳ Thinking'
              : 'Talk to Caddie';

  const handlePress = () => {
    if (isActive) {
      cancelVoice();
    } else {
      void triggerVoice(context);
    }
  };

  return (
    /* The tappable mic button */
    <View style={[styles.wrapper, style]}>
        <Pressable
          onPress={handlePress}
          style={({ pressed }) => [
            styles.btn,
            {
              width:  size,
              height: size,
              borderRadius: size / 2,
              borderColor: ringColor,
              backgroundColor: isActive ? '#1b5e20' : pressed ? '#1b5e20' : '#143d22',
              shadowColor: ringColor,
              shadowOpacity: isActive ? 0.9 : 0.45,
            },
          ]}
        >
          {isActive && !isSpeaking ? (
            // Stop icon during listening/processing
            <Text style={{ color: '#fff', fontSize: size * 0.35 }}>⏹</Text>
          ) : (
            <Image
              source={LOGO}
              style={{ width: size * 0.68, height: size * 0.68, borderRadius: 999 }}
              resizeMode="cover"
            />
          )}
        </Pressable>

        {showLabel && (
          <Text style={[styles.label, { color: isActive ? ringColor : '#4caf50' }]}>
            {label}
          </Text>
        )}
      </View>


const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
  },
  btn: {
    justifyContent:  'center',
    alignItems:      'center',
    borderWidth:     2.5,
    shadowRadius:    12,
    shadowOffset:    { width: 0, height: 2 },
    elevation:       8,
  },
  label: {
    fontSize:    9,
    fontWeight:  '700',
    marginTop:   3,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
