import { Redirect } from 'expo-router';
import { usePlayerProfileStore } from '../store/playerProfileStore';

export default function Index() {
  const { isSetupComplete } = usePlayerProfileStore();
  return (
    <Redirect href={isSetupComplete ? '/(tabs)/caddie' : '/intro'} />
  );
}
