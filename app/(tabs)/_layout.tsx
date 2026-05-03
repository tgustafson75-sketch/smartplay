import { Tabs } from 'expo-router';
import { View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabIconProps {
  iconName: IoniconName;
  label: string;
  focused: boolean;
  showDot?: boolean;
}

function TabIcon({ iconName, label, focused, showDot }: TabIconProps) {
  return (
    <View style={styles.tabItem}>
      <Ionicons
        name={iconName}
        size={22}
        color={focused ? '#00C896' : '#6b7d72'}
      />
      <Text style={[styles.tabLabel, focused && styles.tabLabelFocused]}>
        {label}
      </Text>
      {showDot && (
        <View style={[styles.tabDot, focused ? styles.tabDotFocused : styles.tabDotLive]} />
      )}
    </View>
  );
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isRoundActive = useRoundStore(s => s.isRoundActive);

  const sharedTabBarStyle = {
    backgroundColor: '#0d1a0d',
    borderTopColor: '#1e3a28',
    borderTopWidth: 1,
    height: 60 + insets.bottom,
    paddingBottom: insets.bottom + 6,
    paddingTop: 6,
  };

  return (
    <Tabs
      // Phase AE — bottom tab bar restored on every route, including
      // Caddie home. Previously the tabBarStyle for route 'caddie' was
      // { display: 'none' }, which forced users into the Tool ••• menu
      // for any tab navigation from the default landing screen. Standing
      // UI rule: bottom navigation never iterates. Tab bar now renders
      // across all trust levels and all tabs.
      screenOptions={{
        headerShown: false,
        tabBarStyle: sharedTabBarStyle,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="caddie"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName="mic" label="Caddie" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="play"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName="golf" label="Play" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="scorecard"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon
              iconName="flag"
              label="Score"
              focused={focused}
              showDot={isRoundActive}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="swinglab"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName="golf" label="SwingLab" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName="stats-chart" label="Stats" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
    minWidth: 60,
  },
  tabLabel: {
    color: '#6b7d72',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  tabLabelFocused: {
    color: '#00C896',
  },
  tabDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 1,
  },
  tabDotFocused: {
    backgroundColor: '#00C896',
  },
  tabDotLive: {
    backgroundColor: '#4ade80',
  },
});
