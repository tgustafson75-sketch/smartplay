/**
 * 2026-05-23 — MediaPipe Pose Landmarker — iOS native module.
 *
 * Swift counterpart to android-native/MediaPipePoseModule.kt. Same
 * public surface; the JS bridge (services/mediaPipePoseService.ts)
 * calls into either platform identically.
 *
 * Status: SHIPS now but doesn't build on EAS until Apple Developer
 * Program enrollment lands. Once enrolled + the next EAS iOS build
 * runs, the withMediaPipePose config plugin copies this file into
 * ios/SmartPlayCaddie/MediaPipe/ and the pod 'MediaPipeTasksVision'
 * dependency resolves at pod install time.
 *
 * MediaPipe Tasks Vision iOS uses the same model file format as
 * Android (.task), so the bundled assets/mediapipe/pose_landmarker_full.task
 * is shared across both platforms — single asset, single source of
 * truth for the model.
 */

import Foundation
import UIKit
import React

// Resolved by the pod 'MediaPipeTasksVision' line added by
// withMediaPipePose.js. Xcode will mark as unresolved until the
// first iOS prebuild + pod install runs.
import MediaPipeTasksVision

@objc(MediaPipePose)
class MediaPipePose: NSObject {

    private var landmarker: PoseLandmarker?
    private var loadedQuality: String = "full"
    private var lastInferenceMs: Int = 0
    private let queue = DispatchQueue(label: "com.smartplaycaddy.mediapipe", qos: .userInitiated)

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    private func modelPath(forQuality quality: String) -> String? {
        let name: String
        switch quality {
        case "lite":   name = "pose_landmarker_lite"
        case "heavy":  name = "pose_landmarker_heavy"
        default:       name = "pose_landmarker_full"
        }
        // The withMediaPipePose config plugin copies the model into
        // SmartPlayCaddie/Resources/mediapipe/<name>.task — Xcode
        // bundles that directory by default.
        return Bundle.main.path(forResource: name, ofType: "task", inDirectory: "mediapipe")
    }

    /** Lazy init. Thread-safe via the queue. */
    private func ensureLandmarker(quality: String) throws {
        if landmarker != nil && loadedQuality == quality { return }
        guard let path = modelPath(forQuality: quality) else {
            throw NSError(
                domain: "MediaPipePose",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "pose_landmarker_\(quality).task not in app bundle"],
            )
        }
        let options = PoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = path
        // iOS doesn't expose a GPU/CPU delegate selector like Android;
        // the SDK chooses internally. Performance is comparable.
        options.runningMode = .image
        options.numPoses = 1
        options.minPoseDetectionConfidence = 0.4
        options.minPosePresenceConfidence = 0.4
        options.minTrackingConfidence = 0.4

        landmarker?.close()
        landmarker = try PoseLandmarker(options: options)
        loadedQuality = quality
    }

    // MARK: - Exposed methods

    @objc(detectPoseFromFrame:options:resolver:rejecter:)
    func detectPoseFromFrame(b64: NSString, options: NSDictionary?, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        queue.async {
            do {
                let quality = (options?["quality"] as? String) ?? "full"
                try self.ensureLandmarker(quality: quality)
                guard let landmarker = self.landmarker else {
                    rejecter("MP_INIT_FAILED", "Landmarker init returned nil", nil)
                    return
                }
                // Strip data: prefix if present.
                var clean = b64 as String
                if clean.hasPrefix("data:") {
                    if let comma = clean.firstIndex(of: ",") {
                        clean = String(clean[clean.index(after: comma)...])
                    }
                }
                guard let data = Data(base64Encoded: clean, options: .ignoreUnknownCharacters),
                      let image = UIImage(data: data) else {
                    rejecter("MP_DECODE_FAILED", "Could not decode base64 frame to UIImage", nil)
                    return
                }
                let mpImage: MPImage
                do {
                    mpImage = try MPImage(uiImage: image)
                } catch {
                    rejecter("MP_DECODE_FAILED", "MPImage init failed: \(error.localizedDescription)", error)
                    return
                }
                let t0 = Date().timeIntervalSince1970
                let result: PoseLandmarkerResult
                do {
                    result = try landmarker.detect(image: mpImage)
                } catch {
                    rejecter("MP_INFERENCE_FAILED", error.localizedDescription, error)
                    return
                }
                let ms = Int((Date().timeIntervalSince1970 - t0) * 1000.0)
                self.lastInferenceMs = ms
                DispatchQueue.main.async {
                    resolver(self.serializeResult(result, ms: ms))
                }
            } catch {
                rejecter("MP_INIT_FAILED", error.localizedDescription, error)
            }
        }
    }

    @objc(getStatus:rejecter:)
    func getStatus(resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        resolver([
            "available": true,
            "modelLoaded": landmarker != nil,
            "loadedQuality": loadedQuality,
            "lastInferenceMs": lastInferenceMs,
        ])
    }

    @objc(startContinuousDetection:resolver:rejecter:)
    func startContinuousDetection(quality: NSString, resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        rejecter("MP_NOT_IMPLEMENTED", "startContinuousDetection is reserved for future use", nil)
    }

    @objc(stopContinuousDetection:rejecter:)
    func stopContinuousDetection(resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        resolver(nil)
    }

    @objc(close:rejecter:)
    func close(resolver: @escaping RCTPromiseResolveBlock, rejecter: @escaping RCTPromiseRejectBlock) {
        landmarker?.close()
        landmarker = nil
        resolver(nil)
    }

    // MARK: - Serialization

    private func serializeResult(_ result: PoseLandmarkerResult, ms: Int) -> [String: Any] {
        var landmarks: [[String: Double]] = []
        var worldLandmarks: [[String: Double]] = []
        var found = false
        if let lmList = result.landmarks.first {
            found = true
            for lm in lmList {
                landmarks.append([
                    "x": Double(lm.x),
                    "y": Double(lm.y),
                    "z": Double(lm.z),
                    "visibility": Double(lm.visibility?.floatValue ?? 0),
                    "presence":   Double(lm.presence?.floatValue ?? 0),
                ])
            }
            if let worldList = result.worldLandmarks.first {
                for lm in worldList {
                    worldLandmarks.append([
                        "x": Double(lm.x),
                        "y": Double(lm.y),
                        "z": Double(lm.z),
                        "visibility": Double(lm.visibility?.floatValue ?? 0),
                        "presence":   Double(lm.presence?.floatValue ?? 0),
                    ])
                }
            }
        }
        return [
            "poseFound": found,
            "landmarks": landmarks,
            "worldLandmarks": worldLandmarks,
            "inferenceMs": ms,
        ]
    }

    deinit {
        landmarker?.close()
    }
}
