import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Palette } from '../constants/theme';
import { ProfileScreen } from '../features/profile/ProfileScreen';

export default function ProfileRoute() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.brand }} edges={[]}>
      <ProfileScreen onClose={() => router.back()} />
    </SafeAreaView>
  );
}
