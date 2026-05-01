import React from 'react';
import { View, Text, ImageBackground, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  courseName: string;
  location?: string | null;
  imageUrl?: string | null;
};

/**
 * Hero image with course name + location overlaid bottom-left.
 * Falls back to a gradient placeholder when no image is available — never
 * shows a broken image or a stark empty rectangle.
 */
export default function CourseHero({ courseName, location, imageUrl }: Props) {
  const { width } = useWindowDimensions();
  const height = Math.round(width * 9 / 16);

  const Body = (
    <View style={styles.body}>
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.85)']}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>{courseName}</Text>
        {location ? <Text style={styles.location} numberOfLines={1}>{location}</Text> : null}
      </View>
    </View>
  );

  if (imageUrl) {
    return (
      <ImageBackground source={{ uri: imageUrl }} style={[styles.wrap, { height }]}>
        {Body}
      </ImageBackground>
    );
  }
  return (
    <View style={[styles.wrap, styles.placeholder, { height }]}>
      {Body}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  placeholder: { backgroundColor: '#0d2418' },
  body: { flex: 1, justifyContent: 'flex-end' },
  text: { paddingHorizontal: 16, paddingBottom: 14 },
  name: { color: '#ffffff', fontSize: 22, fontWeight: '900', letterSpacing: 0.2 },
  location: { color: '#cbd5e1', fontSize: 13, fontWeight: '600', marginTop: 4 },
});
