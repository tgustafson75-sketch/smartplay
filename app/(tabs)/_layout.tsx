import { Tabs } from 'expo-router';
import { Text, View, StyleSheet } from 'react-native';

interface TabIconProps {
  emoji: string;
  label: string;
  focused: boolean;
}

function TabIcon({ emoji, label, focused }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Text style={styles.tabEmoji}>{emoji}</Text>
      <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>
        {label}
      </Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#060f09',
          borderTopColor: '#1e3a28',
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="caddie"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="🎙" label="Caddie" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="scorecard"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="📋" label="Score" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="swinglab"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="🏌️" label="SwingLab" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon emoji="📊" label="Stats" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    gap: 2,
    paddingTop: 6,
  },
  tabEmoji: {
    fontSize: 20,
  },
  tabLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
  },
  tabLabelFocused: {
    color: '#00C896',
  },
});
