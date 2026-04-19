import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import ShotVideoPlayer from "./ShotVideoPlayer";
import ShotVisionOverlay from "./ShotVisionOverlay";
import { speakWithCaddie } from "../services/caddieController";
import { useCaddie } from "../context/CaddieContext";

interface ShotVisionPlayerProps {
  uri: string;
  insight?: string;
  width?: number;
  height?: number;
}

const ShotVisionPlayer = memo(function ShotVisionPlayer({
  uri,
  insight,
  width = 360,
  height = 300,
}: ShotVisionPlayerProps) {
  const [triggerKey, setTriggerKey] = useState(0);
  const [playbackDone, setPlaybackDone] = useState(false);
  const { setState } = useCaddie() ?? {};
  const spokenRef = useRef(false);

  useEffect(() => {
    spokenRef.current = false;
    setPlaybackDone(false);
  }, [uri, insight]);

  const handleVideoReady = useCallback(() => {
    if (spokenRef.current) return;
    spokenRef.current = true;
    setTriggerKey((k) => k + 1);
    if (insight && setState) {
      setTimeout(() => void speakWithCaddie(insight, { setState }), 500);
    }
  }, [insight, setState]);

  return (
    <View style={{ width, height, position: "relative" }}>
      <ShotVideoPlayer uri={uri} onReadyForDisplay={handleVideoReady} onFinished={() => setPlaybackDone(true)} />
      <ShotVisionOverlay width={width} height={height} triggerKey={triggerKey} />
      <Text style={{ position: "absolute", top: 10, right: 12, color: "rgba(255,255,255,0.28)", fontSize: 11, fontWeight: "700", letterSpacing: 2 }}>CADDIE</Text>
      {playbackDone ? (
        <Pressable
          onPress={() => void Sharing.shareAsync(uri)}
          style={{ position: "absolute", bottom: 10, right: 10, paddingVertical: 6, paddingHorizontal: 14, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 8 }}
        >
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>Share Shot</Text>
        </Pressable>
      ) : null}
    </View>
  );
});

export default ShotVisionPlayer;
