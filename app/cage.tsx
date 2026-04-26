import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';

export default function CageMode() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ animation: 'slide_from_right' }} />
      <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.body}>
        <Text style={styles.icon}>🎯</Text>
        <Text style={styles.title}>Cage Mode</Text>
        <Text style={styles.sub}>Shot analysis, video capture, and contact feedback</Text>
        <Text style={styles.coming}>Coming soon</Text>
      </View>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
  },
  back: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backText: {
    color: '#00C896',
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  icon: {
    fontSize: 48,
    marginBottom: 4,
  },
  title: {
    color: '#e8f5e9',
    fontSize: 24,
    fontWeight: '700',
  },
  sub: {
    color: '#6b7280',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  coming: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
});
