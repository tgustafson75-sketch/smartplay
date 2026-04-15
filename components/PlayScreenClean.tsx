import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function PlayScreenClean() {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>

      {/* HEADER */}
      <View style={styles.card}>
        <Text style={styles.courseName}>Torrey Pines</Text>
        <Text style={styles.holeInfo}>Hole 1 • Par 4 • Score 0</Text>
      </View>

      {/* DISTANCE */}
      <View style={styles.card}>
        <Text style={styles.distance}>165 yds</Text>
        <Text style={styles.club}>Club: 7 Iron</Text>
      </View>

      {/* ACTION */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Select Shot Result</Text>
        <View style={styles.buttonRow}>
          <View style={[styles.button, { backgroundColor: '#d35400' }]}>
            <Text style={styles.buttonText}>Left</Text>
          </View>
          <View style={[styles.button, { backgroundColor: '#1a7a4a' }]}>
            <Text style={styles.buttonText}>Straight</Text>
          </View>
          <View style={[styles.button, { backgroundColor: '#1a6fa8' }]}>
            <Text style={styles.buttonText}>Right</Text>
          </View>
        </View>
      </View>

      {/* MENTAL */}
      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Mental State</Text>
        <View style={styles.buttonRow}>
          <View style={styles.optionButton}>
            <Text style={styles.optionText}>Confident</Text>
          </View>
          <View style={styles.optionButton}>
            <Text style={styles.optionText}>Nervous</Text>
          </View>
          <View style={styles.optionButton}>
            <Text style={styles.optionText}>Aggressive</Text>
          </View>
        </View>
      </View>

      {/* INSIGHT */}
      <View style={styles.card}>
        <Text style={styles.insightText}>Strategy: Aim center of green</Text>
        <Text style={styles.insightText}>Caddie: Smooth swing</Text>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#0B3D2E',
  },
  container: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 40,
    gap: 12,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  courseName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  holeInfo: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
  },
  distance: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
  },
  club: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: 'rgba(255,255,255,0.6)',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  optionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  insightText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 26,
  },
});
