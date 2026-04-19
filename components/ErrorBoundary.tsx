/**
 * ErrorBoundary — catches render-phase JS errors anywhere in the subtree.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourScreen />
 *   </ErrorBoundary>
 *
 * On error the fallback UI is shown.  The user can tap "Try again" to reset
 * the boundary and attempt to remount the subtree.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Custom fallback element; receives reset callback */
  fallback?: (reset: () => void) => React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: unknown): State {
    const msg =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.';
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Silent in production — do not crash or log PII
    if (__DEV__) {
      console.warn('[ErrorBoundary] caught:', error, info.componentStack);
    }
  }

  reset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return <>{this.props.fallback(this.reset)}</>;
      }
      return (
        <View style={s.container}>
          <Text style={s.icon}>⛳</Text>
          <Text style={s.title}>Something went wrong</Text>
          <Text style={s.body}>
            {__DEV__ ? this.state.errorMessage : "We hit a snag. Your round data is safe — tap below to continue."}
          </Text>
          <Pressable style={s.btn} onPress={this.reset}>
            <Text style={s.btnText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B3D2E',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon:  { fontSize: 48, marginBottom: 16 },
  title: { color: '#A7F3D0', fontSize: 20, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  body:  { color: '#4a7c5e', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  btn: {
    backgroundColor: '#143d22',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#4ade80',
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  btnText: { color: '#4ade80', fontSize: 15, fontWeight: '700' },
});
