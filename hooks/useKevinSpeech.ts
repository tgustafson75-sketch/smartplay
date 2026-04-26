import { useEffect, useState, useCallback } from 'react';
import { speak, stopSpeaking, subscribeToSpeaking } from '../services/voiceService';

export function useKevinSpeech() {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => subscribeToSpeaking(setIsSpeaking), []);

  return {
    isSpeaking,
    say: useCallback(speak, []),
    stop: useCallback(() => stopSpeaking(), []),
  };
}
