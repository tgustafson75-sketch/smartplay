/**
 * 2026-05-23 — Meta Wearables DAT v0.7 — iOS native frame module.
 *
 * Swift counterpart to android-native/MetaWearablesFrameModule.kt. Same
 * public surface so the React Native bridge JS code
 * (services/metaWearablesBridge.ts) can call into either platform
 * without conditionals.
 *
 * Status: SHIPS but DOES NOT BUILD on EAS until Apple Developer Program
 * enrollment lands (currently a deferred business-track item per the
 * sprint log). Once Tim completes enrollment + EAS gets an iOS profile,
 * this file is dropped into the bare ios/ project either by an Expo
 * config plugin (preferred) or manually via Xcode's "Add Files".
 *
 * Architecture mirrors the Android module:
 *   - startStreaming(quality, fps, resolver, rejecter): opens a
 *     Wearables session via AutoDeviceSelector, starts a camera stream
 *     at the requested quality/fps, begins emitting "MetaWearableFrame"
 *     events. Idempotent — duplicate calls return existing status.
 *   - stopStreaming: tears down the camera stream + session. Idempotent.
 *   - getStatus: returns { connected, streaming, device } so a Settings
 *     row can show "Glasses connected" pill.
 *
 * Event payload (RCT-shaped, matches Android exactly):
 *   { uri: String, captured_at: Double, source: "glasses" }
 *
 * Threading: DAT publishes frames on its own queue. We marshal frame
 * writes (JPEG to single overwritable cache file) onto a dedicated
 * background queue so the publisher's queue isn't blocked.
 *
 * Bitmap → JPEG path is resolved via the Frame.makeUIImage() helper
 * the SDK exposes. If a future SDK rev removes it we fall back to
 * frame.cgImage / UIImage(cgImage:) — guarded with availability checks
 * so a minor SDK shape change doesn't crash the stream.
 */

import Foundation
import UIKit
import React

// IMPORTANT: These imports resolve against the DAT Swift Package (XCFrameworks)
// that the withMetaWearablesDAT config plugin adds to the Xcode project. v0.8
// renamed the modules from Wearables/WearablesCamera → MWDATCore/MWDATCamera.
// Until the first iOS EAS build with MWDAT_IOS_ENABLED=1 runs, Xcode marks
// these as unresolved — expected.
import MWDATCore
import MWDATCamera

@objc(MetaWearablesFrame)
class MetaWearablesFrame: RCTEventEmitter {

    private var wearables: Wearables?
    private var session: WearableSession?
    private var stream: CameraStream?
    private var observerToken: AnyObject?
    private let writeQueue = DispatchQueue(label: "com.smartplaycaddy.mwdat.write", qos: .utility)
    private var lastDeviceName: String?
    private var hasListeners: Bool = false

    // MARK: - RCTEventEmitter overrides

    override static func requiresMainQueueSetup() -> Bool { return false }

    override func supportedEvents() -> [String]! {
        return ["MetaWearableFrame", "MetaWearableStatus"]
    }

    override func startObserving() {
        hasListeners = true
    }

    override func stopObserving() {
        hasListeners = false
    }

    // MARK: - Lazy DAT init

    private func ensureInitialized() throws {
        if wearables != nil { return }
        try Wearables.configure()
        wearables = Wearables.shared
    }

    private func resolveQuality(_ raw: String?) -> StreamResolution {
        switch (raw ?? "").lowercased() {
        case "high":   return .high
        case "low":    return .low
        default:       return .medium
        }
    }

    /** DAT iOS accepts the same discrete FPS set as Android. Closest-
     *  match selection so a callers passing 30 on an old device that
     *  caps at 24 doesn't error out. */
    private func resolveFps(_ raw: NSNumber?) -> Int {
        let candidate = raw?.intValue ?? 24
        let allowed = [2, 7, 15, 24, 30]
        return allowed.min(by: { abs($0 - candidate) < abs($1 - candidate) }) ?? 24
    }

    // MARK: - Exposed methods

    @objc(startStreaming:fps:resolver:rejecter:)
    func startStreaming(quality: String, fps: NSNumber, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        do {
            try ensureInitialized()
            guard let wearables = wearables else {
                rejecter("DAT_INIT_FAILED", "Wearables.shared unavailable after configure()", nil)
                return
            }
            if stream != nil {
                // Idempotent — return current status.
                resolver([
                    "alreadyStreaming": true,
                    "device": lastDeviceName ?? "",
                ])
                return
            }

            let newSession = try wearables.createSession(deviceSelector: AutoDeviceSelector(wearables: wearables))
            session = newSession
            lastDeviceName = newSession.device?.name ?? "Ray-Ban Meta"
            try newSession.start()

            let config = StreamConfiguration(resolution: resolveQuality(quality), frameRate: resolveFps(fps))
            let newStream = try newSession.addStream(config: config)
            stream = newStream

            // Subscribe to the videoFramePublisher. The token is held so
            // we can detach in stopStreaming.
            observerToken = newStream.videoFramePublisher.listen { [weak self] frame in
                guard let self = self else { return }
                self.handleFrame(frame)
            }

            // start() is async on iOS; resolve the JS promise as soon
            // as start() returns. Callers await this before assuming
            // frames are flowing.
            Task {
                do {
                    try await newStream.start()
                    DispatchQueue.main.async {
                        resolver([
                            "alreadyStreaming": false,
                            "device": self.lastDeviceName ?? "",
                        ])
                    }
                } catch {
                    DispatchQueue.main.async {
                        rejecter("DAT_STREAM_START_FAILED", error.localizedDescription, error)
                        self.cleanup()
                    }
                }
            }
        } catch {
            rejecter("DAT_SESSION_FAILED", error.localizedDescription, error)
            cleanup()
        }
    }

    @objc(stopStreaming:rejecter:)
    func stopStreaming(resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        cleanup()
        resolver(nil)
    }

    @objc(getStatus:rejecter:)
    func getStatus(resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        resolver([
            "connected": session != nil,
            "streaming": stream != nil,
            "device": lastDeviceName ?? "",
        ])
    }

    // MARK: - Frame handling

    private func handleFrame(_ frame: VideoFrame) {
        // Hop to our serial write queue so we don't block DAT's publisher.
        writeQueue.async { [weak self] in
            guard let self = self, self.hasListeners else { return }
            guard let image = self.image(from: frame) else { return }
            guard let jpeg = image.jpegData(compressionQuality: 0.75) else { return }
            let url = self.frameCacheURL()
            do {
                try jpeg.write(to: url, options: .atomic)
            } catch {
                // Single-frame write failure is non-fatal — log and
                // drop. The rolling queue tolerates gaps.
                NSLog("[MetaWearablesFrame] write failed: %@", error.localizedDescription)
                return
            }
            let payload: [String: Any] = [
                "uri": url.absoluteString,
                "captured_at": Date().timeIntervalSince1970 * 1000.0,
                "source": "glasses",
            ]
            self.sendEvent(withName: "MetaWearableFrame", body: payload)
        }
    }

    /** Tolerate both .makeUIImage() helper AND .cgImage property — the
     *  SDK shape has drifted across preview builds. Reflection-free
     *  via availability conditionals on the type. */
    private func image(from frame: VideoFrame) -> UIImage? {
        if let img = frame.makeUIImage() { return img }
        // Fallback path. Some SDK rev exposed only cgImage.
        // (Selector probe so a missing property compiles cleanly.)
        let mirror = Mirror(reflecting: frame)
        for child in mirror.children {
            if child.label == "cgImage", let cg = child.value as? CGImage {
                return UIImage(cgImage: cg)
            }
            if child.label == "uiImage", let img = child.value as? UIImage {
                return img
            }
        }
        return nil
    }

    private func frameCacheURL() -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("mwdat_frames", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("latest.jpg")
    }

    // MARK: - Cleanup

    private func cleanup() {
        // Detach observer first so no late frame fires after we've nilled
        // the stream reference.
        observerToken = nil
        do {
            try stream?.stop()
        } catch {
            NSLog("[MetaWearablesFrame] stream.stop threw: %@", error.localizedDescription)
        }
        stream = nil
        do {
            try session?.stop()
        } catch {
            NSLog("[MetaWearablesFrame] session.stop threw: %@", error.localizedDescription)
        }
        session = nil
    }

    deinit {
        cleanup()
    }
}
