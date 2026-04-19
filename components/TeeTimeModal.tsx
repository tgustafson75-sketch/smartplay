/**
 * components/TeeTimeModal.tsx
 *
 * Full-screen in-app WebView for tee time booking.
 * Wraps the course booking page so the user never leaves the app.
 */

import React, { useState } from 'react';
import {
  Modal, View, Text, Pressable, ActivityIndicator,
  SafeAreaView, StyleSheet,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Palette } from '../constants/theme';

interface Props {
  visible:  boolean;
  url:      string;
  title?:   string;
  onClose:  () => void;
}

export default function TeeTimeModal({ visible, url, title = 'Book Tee Time', onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const handleClose = () => {
    setLoading(true);
    setErrored(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable onPress={handleClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* Progress bar overlay while loading */}
        {loading && !errored && (
          <View style={styles.loadingBar}>
            <ActivityIndicator color={Palette.positive} size="small" />
            <Text style={styles.loadingText}>Loading booking page…</Text>
          </View>
        )}

        {/* Error state */}
        {errored && (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Couldn't load booking page</Text>
            <Text style={styles.errorSub}>{url}</Text>
            <Pressable style={styles.retryBtn} onPress={() => setErrored(false)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* WebView */}
        {!errored && (
          <WebView
            source={{ uri: url }}
            style={styles.webview}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setErrored(true); }}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState={false}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    paddingHorizontal: 16,
    paddingVertical:  12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
    backgroundColor:   '#071E16',
  },
  title: {
    color:      Palette.positive,
    fontSize:   16,
    fontWeight: '700',
    flex:       1,
  },
  closeBtn: {
    paddingHorizontal: 8,
    paddingVertical:   4,
  },
  closeText: {
    color:    'rgba(255,255,255,0.6)',
    fontSize: 18,
  },
  loadingBar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             10,
    paddingVertical: 14,
    backgroundColor: '#0e2a21',
    borderBottomWidth: 1,
    borderBottomColor: '#1e3a28',
  },
  loadingText: {
    color:    'rgba(255,255,255,0.5)',
    fontSize: 13,
  },
  webview: {
    flex: 1,
  },
  errorBox: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 32,
    gap:             12,
  },
  errorTitle: {
    color:      '#fff',
    fontSize:   17,
    fontWeight: '600',
    textAlign:  'center',
  },
  errorSub: {
    color:     'rgba(255,255,255,0.4)',
    fontSize:  12,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop:       8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius:    20,
    backgroundColor: Palette.positive,
  },
  retryText: {
    color:      '#071E16',
    fontWeight: '700',
    fontSize:   14,
  },
});
