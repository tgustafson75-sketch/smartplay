/**
 * 2026-05-24 — Bluetooth media-button bridge (iOS).
 *
 * Captures BT headset play/pause taps via MPRemoteCommandCenter and
 * surfaces them to JS via DeviceEventEmitter under the "onRemoteControl"
 * event name (matches the Android module). JS-side consumer is
 * services/voiceTriggers.ts → initVoiceTriggers().
 *
 * Why MPRemoteCommandCenter:
 *   AppDelegate.remoteControlReceivedWithEvent is deprecated and only
 *   fires when the app is the "now playing" target — fragile. MPRemote
 *   is the modern (iOS 7.1+) supported API and dispatches BT button
 *   taps reliably as long as an AVAudioSession is active with the
 *   right category.
 *
 * Audio session category:
 *   .playback with .mixWithOthers — claims the remote control target
 *   without preventing Spotify / podcast playback. No audio is played
 *   by this module; the session activation is purely to make the
 *   togglePlayPauseCommand receive headset events.
 *
 * Conflict with voiceService.ts:
 *   voiceService.ts uses expo-av's setAudioModeAsync, which on iOS
 *   manipulates AVAudioSession. The conflict surface is minor because:
 *     1. expo-av and this module both end up writing to the same
 *        AVAudioSession singleton — last-write-wins.
 *     2. We activate the session only when listening should be on
 *        (foregrounded, not in cage swing capture, etc. — gated by
 *        the JS bridge).
 *     3. When TTS speaks, expo-av re-configures the session in
 *        DuckOthers mode; on completion the session returns to
 *        whatever the OS chose (often inactive). We accept that the
 *        first BT tap after a long TTS run might miss — JS layer
 *        re-activates on app foreground to recover.
 */

import Foundation
import MediaPlayer
import AVFoundation

@objc(BluetoothMediaButton)
class BluetoothMediaButton: RCTEventEmitter {

    private var isActive = false
    private var hasListeners = false
    private var routeWatching = false

    override static func requiresMainQueueSetup() -> Bool { return true }

    override func supportedEvents() -> [String]! {
        // Two event surfaces, mirrored exactly on the Android module.
        return ["onRemoteControl", "onAudioRouteChanged"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// Activate the remote-control session. Idempotent.
    @objc(activate:rejecter:)
    func activate(_ resolve: @escaping RCTPromiseResolveBlock,
                  rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            do {
                if !self.isActive {
                    // Configure audio session — playback + mixWithOthers so
                    // we don't interrupt the user's music / podcast.
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
                    try session.setActive(true, options: [])
                }

                let cc = MPRemoteCommandCenter.shared()

                // Enable + register handlers. We treat play, pause, and
                // togglePlayPause as a single "tap" signal — emit the
                // matching `type` string so JS can dedup if it wants.
                cc.playCommand.isEnabled = true
                cc.pauseCommand.isEnabled = true
                cc.togglePlayPauseCommand.isEnabled = true

                // Remove any prior targets defensively so a second
                // activate() doesn't stack duplicate handlers.
                cc.playCommand.removeTarget(nil)
                cc.pauseCommand.removeTarget(nil)
                cc.togglePlayPauseCommand.removeTarget(nil)

                cc.playCommand.addTarget { [weak self] _ in
                    self?.emitTap(type: "play")
                    return .success
                }
                cc.pauseCommand.addTarget { [weak self] _ in
                    self?.emitTap(type: "pause")
                    return .success
                }
                cc.togglePlayPauseCommand.addTarget { [weak self] _ in
                    self?.emitTap(type: "playPause")
                    return .success
                }

                self.isActive = true
                resolve(["active": true, "sessionTag": "SmartPlayBTButton"])
            } catch {
                NSLog("[BTMediaButton] activate failed: \(error)")
                reject("BT_MEDIA_ACTIVATE_FAILED",
                       "activate failed: \(error.localizedDescription)",
                       error)
            }
        }
    }

    /// Deactivate the remote-control session. Idempotent.
    @objc(deactivate:rejecter:)
    func deactivate(_ resolve: @escaping RCTPromiseResolveBlock,
                    rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            let cc = MPRemoteCommandCenter.shared()
            cc.playCommand.removeTarget(nil)
            cc.pauseCommand.removeTarget(nil)
            cc.togglePlayPauseCommand.removeTarget(nil)
            cc.playCommand.isEnabled = false
            cc.pauseCommand.isEnabled = false
            cc.togglePlayPauseCommand.isEnabled = false

            // Don't tear down AVAudioSession globally — expo-av and other
            // RN audio modules share it. Just release our claim.
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            } catch {
                // Non-fatal — session may already be inactive.
                NSLog("[BTMediaButton] session.setActive(false) note: \(error)")
            }

            self.isActive = false
            resolve(["active": false, "sessionTag": ""])
        }
    }

    @objc(getStatus:rejecter:)
    func getStatus(_ resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(["active": self.isActive, "sessionTag": self.isActive ? "SmartPlayBTButton" : ""])
    }

    /**
     * 2026-08-25 — IS A HEADSET ACTUALLY CONNECTED? (iOS half; mirrors the Android getAudioRoute.)
     *
     * Parked since 08-21. services/audioRoutingService.detectRoute() detects nothing — it
     * configures the audio mode and returns, leaving the manual Settings toggle as the only writer
     * of the route. AVAudioSession has always known the answer; nothing asked it.
     *
     * Reports the ROUTE rather than a bare boolean because the cases behave differently: wired can
     * be spoken through freely, Bluetooth is the hands-free case, and the phone speaker is the one
     * where talking out loud might embarrass someone on a quiet tee.
     *
     * Never rejects. An unknown route degrades to "speaker", which is the conservative answer —
     * do not start talking out loud on an assumption.
     */
    /// The route right now, in the shape both platforms return.
    private func currentRouteBody() -> [String: Any] {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        var bluetooth = false
        var wired = false
        for o in outputs {
            switch o.portType {
            case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE:
                bluetooth = true
            case .headphones, .usbAudio:
                wired = true
            default:
                break   // built-in speaker / receiver / HDMI — not a headset
            }
        }
        return [
            "route": bluetooth ? "bluetooth" : (wired ? "wired" : "speaker"),
            "headsetConnected": bluetooth || wired,
        ]
    }

    @objc(getAudioRoute:rejecter:)
    func getAudioRoute(_ resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
        resolve(currentRouteBody())
    }

    /**
     * 2026-08-29 — WATCH THE ROUTE, DO NOT JUST READ IT ONCE.
     *
     * getAudioRoute (08-25) answered the question, and services/audioRoutingService asked it exactly
     * once, on first subscribe. So the app learned the route at app start and never again: a player
     * who puts earbuds in on the first tee — which is when people actually put earbuds in — kept
     * whatever answer was true in the car park, and the caddie went on deciding whether to talk out
     * loud from stale information.
     *
     * AVAudioSession posts routeChangeNotification for exactly this. Idempotent; safe to call on
     * every subscribe.
     */
    @objc(startRouteWatch:rejecter:)
    func startRouteWatch(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        if routeWatching {
            resolve(true)
            return
        }
        routeWatching = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange(_:)),
            name: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance()
        )
        resolve(true)
    }

    @objc private func handleRouteChange(_ note: Notification) {
        // Same listener guard emitTap uses — RCTEventEmitter warns on an emit with no subscriber.
        guard hasListeners else { return }
        sendEvent(withName: "onAudioRouteChanged", body: currentRouteBody())
    }

    private func emitTap(type: String) {
        // Guard against emit before JS subscribes — RCTEventEmitter
        // warns otherwise.
        guard hasListeners else { return }
        let payload: [String: Any] = [
            "type": type,
            "at": Date().timeIntervalSince1970 * 1000.0,
        ]
        sendEvent(withName: "onRemoteControl", body: payload)
    }
}
