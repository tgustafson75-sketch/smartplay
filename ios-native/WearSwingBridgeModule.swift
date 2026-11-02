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
 * sendToWatch falls back when it is not. Yardage and round state are LATEST-WINS: they go through
 * updateApplicationContext, a single slot the watch reads on wake, so a watch that wakes after a
 * hole change sees the current number and never a queue of old ones. (2026-11-01 — this used to be
 * transferUserInfo, which queued every yardage push and replayed the stale ones on wake.)
 * Notifications and spoken prompts still queue with transferUserInfo, because each one matters.
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
      // The payload's own `kind` decides how it waits. Yardage and state replace each other, so
      // only the newest one is kept; everything else is a discrete event and queues in order.
      if Self.isLatestWins(data) {
        do {
          try s.updateApplicationContext(["caddie": msg])
        } catch {
          // Non-fatal: the next refresh (18s tick or hole change) replaces it anyway.
          NSLog("[WearSwingBridge] updateApplicationContext failed: \(error)")
        }
      } else {
        s.transferUserInfo(msg)
      }
      resolve(true)
    } else {
      resolve(false)
    }
  }

  /// Yardage and round state describe the moment they were sent, so only the newest one matters.
  private static func isLatestWins(_ data: String) -> Bool {
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(data.utf8))) as? [String: Any],
          let kind = obj["kind"] as? String else { return false }
    return kind == "yardage" || kind == "state"
  }

  /**
   * 2026-10-13 — NO addListener / removeListeners OVERRIDES. RCTEventEmitter already exports both,
   * and its versions are what count listeners and call startObserving(). The empty overrides that
   * lived here (added 08-30 to satisfy a compile error) swallowed that: the count stayed 0,
   * hasListeners never went true, and emit() dropped EVERY event — no watch swing, tap, voice,
   * command or connection change ever reached JS on iOS. Phone→watch sends were unaffected, which
   * is why it looked half-working.
   */

  /**
   * Is a watch there to talk to? iOS parity with Android's NodeClient count, so Settings can answer
   * before a round instead of after a failed push. Paired AND our watch app installed = 1. Reachable
   * is deliberately NOT required: on watchOS it is only true while the watch app is foregrounded,
   * so requiring it would report a watch on the wrist as absent. Not activated = reject (unknown),
   * never 0 — JS reads a rejection as "cannot ask", which is the honest answer.
   */
  @objc(getConnectedNodeCount:rejecter:)
  func getConnectedNodeCount(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard WCSession.isSupported() else { resolve(0); return }
    let s = session ?? WCSession.default
    guard s.activationState == .activated else {
      reject("watch_session_inactive", "WCSession not activated yet", nil)
      return
    }
    resolve(s.isPaired && s.isWatchAppInstalled ? 1 : 0)
  }
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
