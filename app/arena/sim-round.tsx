import { useEffect } from 'react';
import { Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useRoundStore } from '../../store/roundStore';
import { getCourse } from '../../data/courses';

export default function SimRound() {
  const router = useRouter();
  const { startRound, isRoundActive } = useRoundStore();

  useEffect(() => {
    if (!isRoundActive) {
      const course = getCourse('palms');
      if (course) {
        startRound(course.name, course.holes, {
          nineHole: true,
          isCompetition: false,
          notes: 'Sim round',
          goal: null,
        });
      }
    }
    router.replace('/(tabs)/caddie' as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Starting sim round...</Text>
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
  text: {
    color: '#6b7280',
    fontSize: 14,
  },
});
