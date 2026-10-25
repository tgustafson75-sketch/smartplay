/**
 * 2026-10-24 — one full-screen host for our own web apps inside Caddie (SmartBay AI, SmartPlay Golf).
 * A thin back bar, then the page edge to edge. The camera is asked for here, natively, before the page
 * ever calls getUserMedia: a browser's "camera blocked" help is the wrong advice inside an app, so a
 * denied camera gets the app's own Settings link instead. Links off our origin open in the browser.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, AppState, BackHandler, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { safeBack } from '../services/safeBack';
import { isHostedOrigin } from '../services/smartBayHost';

const BG = '#050806';
const TEXT = '#ffffff';
const MUTED = '#c2cad4';
const ACCENT = '#88F700';

interface Props {
  title: string;
  /** null while the URL is still being built (e.g. the player file). */
  url: string | null;
  /** Our site; navigation inside it stays in the app. */
  origin: string;
  /** The page needs the camera before it can do anything useful. */
  needsCamera?: boolean;
  /**
   * A window event the page needs before it is torn down (SmartBay: 'smartbay:leave' posts the lesson
   * in progress), and the message that says it is done ('smartbay:left'). Every way out — back button,
   * Android back, iOS swipe — fires the event and closes on the reply, or after LEAVE_MAX_MS.
   */
  leave?: { event: string; done: (data: string) => boolean };
  onMessage?: (data: string) => void;
}

const LEAVE_MAX_MS = 1200;

export function HostedWebApp({ title, url, origin, needsCamera = false, leave, onMessage }: Props) {
  useKeepAwake();
  const { t } = useTranslation();
  const ref = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [cam, requestCam, getCam] = useCameraPermissions();
  // Back from the Settings app with the camera switched on: re-read it, or the panel never clears.
  useEffect(() => {
    if (!needsCamera) return;
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void getCam(); });
    return () => sub.remove();
  }, [needsCamera, getCam]);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Ask once on open. A "no" shows the blocked panel; asking again is the player's tap, never a loop.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (!needsCamera || asked || !cam || cam.granted || !cam.canAskAgain) return;
    setAsked(true);
    void requestCam();
  }, [needsCamera, asked, cam, requestCam]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        ref.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const navigation = useNavigation();
  // usePreventRemove (not a raw beforeRemove listener) so the iOS swipe is held natively too.
  const [left, setLeft] = useState(false);
  const pendingLeave = useRef<(() => void) | null>(null);
  const leaveAction = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  // Dispatched only once the render with the prevent dropped has committed, or it is held again.
  useEffect(() => {
    if (left && leaveAction.current) navigation.dispatch(leaveAction.current);
  }, [left, navigation]);
  usePreventRemove(!!leave && !!url && !left, ({ data }) => {
    if (pendingLeave.current) return;
    const go = () => {
      pendingLeave.current = null;
      leaveAction.current = data.action;
      setLeft(true);
    };
    const timer = setTimeout(go, LEAVE_MAX_MS);
    pendingLeave.current = () => { clearTimeout(timer); go(); };
    if (ref.current) ref.current.injectJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(leave!.event)}));true;`);
    else pendingLeave.current();
  });

  const onNav = useCallback((n: WebViewNavigation) => {
    canGoBack.current = n.canGoBack;
  }, []);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    // Frames inside our page (embeds, analytics) are the page's business; only top-level navigation leaves.
    if (req.isTopFrame === false) return true;
    if (isHostedOrigin(req.url, origin) || req.url.startsWith('about:') || req.url.startsWith('blob:') || req.url.startsWith('data:')) return true;
    void Linking.openURL(req.url).catch(() => undefined);
    return false;
  }, [origin]);

  const onMsg = useCallback((e: WebViewMessageEvent) => {
    const data = e.nativeEvent.data;
    onMessage?.(data);
    if (pendingLeave.current && leave?.done(data)) pendingLeave.current();
  }, [onMessage, leave]);

  const camPending = needsCamera && (cam == null || (!cam.granted && cam.canAskAgain && !asked) || (asked && cam.status === 'undetermined'));
  const camBlocked = needsCamera && !camPending && cam != null && !cam.granted;

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.bar}>
        <TouchableOpacity onPress={() => safeBack('/(tabs)/swinglab')} style={s.back} accessibilityRole="button" accessibilityLabel={t('hosted_web.back')} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={TEXT} />
        </TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        <View style={s.back} />
      </View>
      {camBlocked ? (
        <View style={s.center}>
          <Ionicons name="videocam-off-outline" size={40} color={MUTED} />
          <Text style={s.msg}>{t('hosted_web.camera_off', { title })}</Text>
          <TouchableOpacity style={s.btn} onPress={() => void (cam?.canAskAgain ? requestCam() : Linking.openSettings())} accessibilityRole="button">
            <Text style={s.btnText}>{t(cam?.canAskAgain ? 'hosted_web.allow_camera' : 'hosted_web.open_settings')}</Text>
          </TouchableOpacity>
        </View>
      ) : camPending || !url ? (
        <View style={s.center}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : failed ? (
        <View style={s.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={MUTED} />
          <Text style={s.msg}>{t('hosted_web.offline', { title })}</Text>
          <TouchableOpacity style={s.btn} onPress={() => { setFailed(false); setNonce((n) => n + 1); }} accessibilityRole="button">
            <Text style={s.btnText}>{t('hosted_web.try_again')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          key={nonce}
          ref={ref}
          source={{ uri: url }}
          style={s.web}
          originWhitelist={['https://*']}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          allowsBackForwardNavigationGestures
          applicationNameForUserAgent="SmartPlayCaddie"
          setSupportMultipleWindows={false}
          overScrollMode="never"
          bounces={false}
          startInLoadingState
          renderLoading={() => <View style={[s.center, StyleSheet.absoluteFill]}><ActivityIndicator color={ACCENT} /></View>}
          onShouldStartLoadWithRequest={onShouldStart}
          onNavigationStateChange={onNav}
          onMessage={onMsg}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
          // Android: the WebView process can die under memory pressure (MediaPipe + video); reload, never a blank screen.
          onRenderProcessGone={() => setNonce((n) => n + 1)}
          onContentProcessDidTerminate={() => ref.current?.reload()}
          {...(Platform.OS === 'android' ? { androidLayerType: 'hardware' as const } : null)}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: TEXT, fontSize: 16, fontWeight: '800' },
  web: { flex: 1, backgroundColor: BG },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: BG },
  msg: { color: MUTED, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  btn: { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12 },
  btnText: { color: '#0d1a0d', fontSize: 15, fontWeight: '800' },
});
