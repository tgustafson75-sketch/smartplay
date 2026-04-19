import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Palette } from '../constants/theme';
import { RoundReplay } from '../features/replay/RoundReplay';

export default function RoundReplayScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.brand }} edges={['top']}>
      <RoundReplay onClose={() => router.back()} />
    </SafeAreaView>
  );
}
