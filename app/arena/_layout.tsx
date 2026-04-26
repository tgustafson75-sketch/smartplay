import { Stack } from 'expo-router';

export default function ArenaLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#060f09' },
        animation: 'slide_from_right',
      }}
    />
  );
}
