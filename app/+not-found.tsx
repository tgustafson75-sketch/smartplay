/**
 * Catch-all "not found" route for Expo Router.
 *
 * Web export needs an explicit +not-found page to satisfy the static
 * renderer (the build was failing on Vercel with
 * "ENOENT: no such file or directory, open '.../dist/server/+not-found.html'").
 * Native flows shouldn't ever land here — every screen routes through
 * known paths — but if one slips through, a clean message + a one-tap
 * route home beats a blank screen.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Link, Stack } from 'expo-router';

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Page not found.</Text>
        <Link href="/(tabs)/caddie" style={styles.link}>
          Back to Caddie
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#060f09',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#e8f5e9',
    marginBottom: 16,
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00C896',
  },
});
