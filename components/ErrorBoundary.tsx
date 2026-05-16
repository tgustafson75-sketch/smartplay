/**
 * Top-level React error boundary.
 *
 * Beta tester white-screens are the worst kind of bug — the app boots,
 * something inside the render tree throws, React tears down the tree,
 * and the user sees a blank screen with no clue what happened. With
 * this boundary wrapped around <AppNavigator />, any thrown error
 * during render shows the user (and us) the message + component
 * stack on-screen instead of a white void.
 *
 * Why a class component: React error boundaries MUST be classes —
 * componentDidCatch and getDerivedStateFromError have no hook
 * equivalents. Don't refactor this into a function component.
 *
 * What it catches: render errors, lifecycle errors, constructor
 * errors in any descendant. Does NOT catch: async errors, event
 * handlers, errors in itself. Most "white screen post-permissions"
 * bugs are render errors, which this catches.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform } from 'react-native';

type Props = { children: React.ReactNode };
type State = { error: Error | null; info: React.ErrorInfo | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.log('[ErrorBoundary] caught:', error.message);
    console.log('[ErrorBoundary] component stack:', info.componentStack);
    this.setState({ info });
  }

  private handleReset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): React.ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const message = error.message || 'Unknown error';
    const stack = error.stack ?? '';
    const componentStack = info?.componentStack ?? '';

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.heading}>Something broke during render.</Text>
          <Text style={styles.subheading}>
            Screenshot this and send it. The app is paused so we can see what threw.
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>ERROR</Text>
            <Text style={styles.errorText}>{message}</Text>
          </View>

          {stack.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.label}>STACK</Text>
              <Text style={styles.codeText}>{stack}</Text>
            </View>
          )}

          {componentStack.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.label}>COMPONENT TREE</Text>
              <Text style={styles.codeText}>{componentStack}</Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.label}>RUNTIME</Text>
            <Text style={styles.codeText}>
              platform: {Platform.OS} {Platform.Version}
            </Text>
          </View>

          <TouchableOpacity style={styles.btn} onPress={this.handleReset} accessibilityRole="button">
            <Text style={styles.btnText}>Try to recover</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060f09' },
  scroll: { padding: 20, paddingTop: 60, gap: 12 },
  heading: { color: '#ef4444', fontSize: 18, fontWeight: '900' },
  subheading: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 6 },
  card: {
    backgroundColor: '#0d1a0d',
    borderColor: '#1e3a28',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  label: { color: '#6b7280', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  errorText: { color: '#fca5a5', fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  codeText: { color: '#d1d5db', fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  btn: {
    backgroundColor: '#00C896',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  btnText: { color: '#0d1a0d', fontSize: 14, fontWeight: '900' },
});
