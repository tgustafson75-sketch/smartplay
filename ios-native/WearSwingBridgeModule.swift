/**
 * 2026-08-25 — Apple Watch bridge (iOS phone side).
 *
 * Tim: "having yardage on a watch is, like, a minimum for most golf guys and most golf apps."
 * The Wear OS watch has done this since 2026-07; this is the same story on Apple Watch.
 *
 * DELIBERATELY THE SAME MODULE NAME AND EVENT CONTRACT AS ANDROID (`WearSwingBridge`), so
 * services/watchCaddieBridge.ts and services/watchSwingBridge.ts work on iOS with NO branching.
 * One owner for "the watch"; the platform difference stops at this file. Mirrors
 * android-native/WearSwingBridgeModule.kt method for method:
 *
 *   start / stop / getStatus / sendToWatch(path, data)
 *   emits: onWatchSwing · onWatchConnection · onWatchVoice · onWatchTap · onWatchCommand
 *
 * PROTOCOL. Wear OS has message PATHS; WatchConnectivity has a dictionary. So the same paths ride
 * as a "path" key with a "data" JSON string — identical payloads on both platforms, which is what
 * lets the watch apps stay near-identical and the JS stay ignorant of which one is attached.
 *
 * REACHABILITY. WCSession.isReachable is only true when the watch app is foregrounded, so
 * sendToWatch falls back to transferUserInfo (queued, delivered when the app wakes). Live yardage
 * is useless late, so yardage uses sendMessage when reachable and simply drops otherwise — the
 * next 18s refresh supersedes it anyway. Notifications and prompts queue.
 */

import Foundation
import WatchConnectivity
import React

@objc(WearSwingBridge)
class WearSwingBridgeModule: RCTEventEmitter {

  private var session: WCSession?
  private var listening = false
  private var hasListeners = false

  override static func requiresMainQueueSetup() -> Bool { return false }

  override func supportedEvents() -> [String]! {
    return ["onWatchSwing", "onWatchConnection", "onWatchVoice", "onWatchTap", "onWatchCommand"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  private func emit(_ name: String, _ body: [String: Any]) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // ── JS API ────────────────────────────────────────────────────────────────

  @objc(start:rejecter:)
  func start(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard WCSession.isSupported() else {
      // No paired-watch capability on this device. Resolve false rather than throwing — the JS
      // treats an unavailable bridge as "no watch", exactly as it does on Android.
      resolve(false)
      return
    }
    let s = WCSession.default
    s.delegate = self
    if s.activationState != .activated { s.activate() }
    session = s
    listening = true
    resolve(true)
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // WCSession cannot be deactivated once activated; stop delivering instead. Matches the Android
    // module's observable behaviour (messages stop reaching JS) without pretending to tear down.
    listening = false
    resolve(true)
  }

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let s = session ?? (WCSession.isSupported() ? WCSession.default : nil)
    resolve([
      "listening": listening,
      "supported": WCSession.isSupported(),
      "paired": s?.isPaired ?? false,
      "appInstalled": s?.isWatchAppInstalled ?? false,
      "reachable": s?.isReachable ?? false,
    ])
  }

  @objc(sendToWatch:data:resolver:rejecter:)
  func sendToWatch(_ path: String, data: String,
                   resolver resolve: @escaping RCTPromiseResolveBlock,
                   rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let s = session, s.activationState == .activated else { resolve(false); return }
    let msg: [String: Any] = ["path": path, "data": data]
    if s.isReachable {
      s.sendMessage(msg, replyHandler: nil, errorHandler: { _ in /* best-effort, same as Android */ })
      resolve(true)
    } else if path == "/smartplay/caddie" {
      // Queue anything that still matters when the watch wakes. Live yardage is superseded by the
      // next refresh, so a queued stale number would be worse than nothing — but the payload's own
      // `kind` decides that on the watch, which keeps this rule in ONE place (the watch app).
      s.transferUserInfo(msg)
      resolve(true)
    } else {
      resolve(false)
    }
  }

  @objc(addListener:)
  func addListener(_ eventName: String) { /* required by NativeEventEmitter */ }

  @objc(removeListeners:)
  func removeListeners(_ count: Double) { /* required by NativeEventEmitter */ }
}

// ── WCSessionDelegate ───────────────────────────────────────────────────────

extension WearSwingBridgeModule: WCSessionDelegate {

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
    emit("onWatchConnection", [
      "connected": activationState == .activated && session.isWatchAppInstalled,
      "node": "Apple Watch",
    ])
  }

  func sessionDidBecomeInactive(_ session: WCSession) {
    emit("onWatchConnection", ["connected": false, "node": "Apple Watch"])
  }

  func sessionDidDeactivate(_ session: WCSession) {
    // Reactivate so a watch switch does not silently end the session (Apple's documented dance).
    WCSession.default.activate()
  }

  func sessionReachabilityDidChange(_ session: WCSession) {
    emit("onWatchConnection", ["connected": session.isReachable, "node": "Apple Watch"])
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
    route(message)
  }

  func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
    route(message)
    replyHandler(["ok": true])
  }

  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
    route(userInfo)
  }

  /**
   * One inbound router, mirroring the Android module's onMessageReceived path switch. Any inbound
   * message is also live proof the watch is connected — the same lesson the Wear OS side learned
   * when the launch-time hello was missed and Settings sat on "Not wired" while everything worked.
   */
  private func route(_ message: [String: Any]) {
    guard listening else { return }
    guard let path = message["path"] as? String else { return }
    let raw = (message["data"] as? String) ?? "{}"
    let parsed = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] ?? [:]

    emit("onWatchConnection", ["connected": true, "node": "Apple Watch"])

    switch path {
    case "/smartplay/swing":   emit("onWatchSwing", parsed)
    case "/smartplay/voice":   emit("onWatchVoice", parsed)
    case "/smartplay/tap":     emit("onWatchTap", parsed)
    case "/smartplay/command": emit("onWatchCommand", parsed)
    case "/smartplay/hello":   break   // the connection event above is the whole point of hello
    default:                   break
    }
  }
}
