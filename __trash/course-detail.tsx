import { StyleSheet, View, Text } from 'react-native';

export default function CourseDetail() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Course Details</Text>
      <Text style={styles.body}>Select a course from the main menu to view hole-by-hole information, yardages, and caddie notes.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f9f6', padding: 24 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#0B3D2E', marginBottom: 12 },
  body: { fontSize: 15, color: '#444', textAlign: 'center', lineHeight: 22 },
});