import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '../store/userStore';

export default function WelcomeScreen() {
  const router = useRouter();
  const setGoal = useUserStore((s) => s.setGoal);

  const handleSelect = (goal: 'break100' | 'break90') => {
    setGoal(goal);
    router.push('/course');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>What's your goal?</Text>
      <Text style={styles.subtitle}>Choose your target for today's round.</Text>

      <TouchableOpacity style={styles.button} onPress={() => handleSelect('break100')}>
        <Text style={styles.buttonText}>Break 100</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.button, styles.buttonPrimary]} onPress={() => handleSelect('break90')}>
        <Text style={styles.buttonText}>Break 90</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#555555',
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    backgroundColor: '#2d6a4f',
    width: '100%',
    paddingVertical: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonPrimary: {
    backgroundColor: '#1a7a4a',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
});
