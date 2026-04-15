import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useUserStore } from '../store/userStore';

const COURSES = ['Menifee Lakes', 'Canyon Lake', 'Bear Creek'];

export default function CourseScreen() {
  const router = useRouter();
  const setCourse = useUserStore((s) => s.setCourse);

  const handleSelect = (course: string) => {
    setCourse(course);
    router.push('/(tabs)/play');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select Course</Text>

      {COURSES.map((course) => (
        <TouchableOpacity key={course} style={styles.button} onPress={() => handleSelect(course)}>
          <Text style={styles.buttonText}>{course}</Text>
        </TouchableOpacity>
      ))}
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
    fontSize: 30,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#1a7a4a',
    width: '100%',
    paddingVertical: 20,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
});
