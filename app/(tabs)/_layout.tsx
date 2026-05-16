import { Tabs } from 'expo-router';
import { View, Image, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoundStore } from '../../store/roundStore';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type MCIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface TabIconProps {
  iconName?: IoniconName;
  mcIconName?: MCIconName;
  label: string;
  focused: boolean;
  showDot?: boolean;
}

function TabIcon({ iconName, mcIconName, label: _label, focused, showDot }: TabIconProps) {
  const color = focused ? '#00C896' : '#6b7d72';
  return (
    <View style={styles.tabItem} accessibilityLabel={_label}>
      {iconName && <Ionicons name={iconName} size={26} color={color} />}
      {mcIconName && <MaterialCommunityIcons name={mcIconName} size={26} color={color} />}
      {showDot && (
        <View style={[styles.tabDot, focused ? styles.tabDotFocused : styles.tabDotLive]} />
      )}
    </View>
  );
}

// Caddie tab uses the brand badge silhouette instead of a stock icon
// per Tim 2026-05-15: "Caddie tab icon ... center caddie silhouette
// very cleanly." Image is the same asset BrandHeaderRow uses; tinted
// here only via opacity/saturation when unfocused.
function CaddieTabIcon({ focused, label }: { focused: boolean; label: string }) {
  return (
    <View style={styles.tabItem} accessibilityLabel={label}>
      <Image
        source={require('../../assets/avatars/smartplay_caddie_badge.png')}
        style={[styles.brandTabIcon, { opacity: focused ? 1 : 0.55 }]}
        resizeMode="contain"
      />
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
          // Phase AE follow-up — distinct icons per tab so users can read
          // them at a glance. Outlined when inactive, filled when focused
          // (the focused color flip to accent green is what makes the
          // active tab obvious). Previously Play and SwingLab both used
          // 'golf' which made the row read as duplicates.
          tabBarIcon: ({ focused }) => (
            <CaddieTabIcon focused={focused} label="Caddie" />
          ),
        }}
      />
      <Tabs.Screen
        name="play"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName={focused ? 'golf' : 'golf-outline'} label="Play" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="scorecard"
        options={{
          tabBarIcon: ({ focused }) => (
            // list = lined-paper scorecard look, more literal than 'flag'
            <TabIcon
              iconName={focused ? 'list' : 'list-outline'}
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
            // Phase 401 follow-up — Tim 2026-05-15: previous MCI "golf"
            // (swinging golfer) read too similar to the Play tab's golf
            // flag at 26px. "bullseye-arrow" is silhouette-distinct
            // (concentric circles + arrow) and reads as "practice /
            // precision work" — matches SwingLab's cage + drill theme.
            // A custom branded asset can replace this later.
            <TabIcon mcIconName="bullseye-arrow" label="Swing" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon iconName={focused ? 'stats-chart' : 'stats-chart-outline'} label="Stats" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  brandTabIcon: {
    width: 30,
    height: 30,
  },
  tabItem: {
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
    // Phase AE follow-up — minWidth removed. 5 tabs × 60 = 300px overflowed
    // Galaxy Fold closed (~285px) and pushed the rightmost tabs off-screen.
    // Letting the tab system distribute children evenly via flex keeps
    // every tab visible on narrow aspects.
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
