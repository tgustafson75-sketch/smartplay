import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Palette } from '../constants/theme';
import { HighlightReel } from '../features/replay/HighlightReel';

export default function HighlightReelScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.brand }} edges={['top']}>
      <HighlightReel onClose={() => router.back()} />
    </SafeAreaView>
  );
}
