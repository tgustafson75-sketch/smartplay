import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function HoleView3D() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={styles.text}>3D Hole View — coming soon</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    top: 60,
    left: 20,
  },
  backText: {
    color: '#00C896',
    fontSize: 16,
  },
  text: {
    color: '#6b7280',
    fontSize: 14,
  },
});
