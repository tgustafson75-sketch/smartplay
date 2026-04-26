import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Dashboard() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.text}>Dashboard — coming Day 12</Text>
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
