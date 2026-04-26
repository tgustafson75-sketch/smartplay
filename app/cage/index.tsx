import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function CageIndex() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Cage Mode — coming Day 11</Text>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#060f09',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  text: {
    color: '#6b7280',
    fontSize: 14,
  },
  back: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  backText: {
    color: '#00C896',
    fontSize: 14,
  },
});
