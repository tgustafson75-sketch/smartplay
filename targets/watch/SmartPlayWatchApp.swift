/**
 * 2026-08-25 — SmartPlay Caddie, Apple Watch.
 *
 * A DELIBERATE MIRROR of the Wear OS face (wear-os-app MainActivity.kt), because the two watches
 * must not drift into different products:
 *
 *   ┌────────────────────┐
 *   │      SmartPlay     │   brand, tiny green
 *   │       HOLE 7       │   hole label, dim
 *   │        147         │   BIG middle-of-green yardage — the hero number
 *   │    F 132   B 158   │   front / back, flanking
 *   │   [  Ask caddie ]  │   prominent green mic button
 *   │  status / feedback │
 *   └────────────────────┘
 *
 * Yardage is PUSHED FROM THE PHONE, never computed here. The phone owns GPS, the green geometry
 * and the working number; a watch that did its own maths would be a second owner of the one number
 * the player trusts most, and the two would disagree on the tee. Same reason the Wear OS app is a
 * display. If the phone has not sent a fix yet, this says so rather than showing a stale number.
 *
 * Protocol matches Wear OS exactly — {"path": "/smartplay/caddie", "data": "<json>"} where the JSON
 * carries a `kind` of yardage | notification | voice_prompt | score | state.
 */

import SwiftUI
import WatchConnectivity

// ── Model ───────────────────────────────────────────────────────────────────

final class CaddieState: NSObject, ObservableObject, WCSessionDelegate {
  @Published var hole: Int? = nil
  @Published var middle: Int? = nil
  @Published var front: Int? = nil
  @Published var back: Int? = nil
  @Published var status: String = "Open a round on your phone"
  /// Set when the phone pushes a spoken prompt or notification; shown briefly in place of status.
  @Published var message: String? = nil

  private var session: WCSession?

  func activate() {
    guard WCSession.isSupported() else { status = "Watch not supported"; return }
    let s = WCSession.default
    s.delegate = self
    s.activate()
    session = s
    // Announce ourselves so the phone marks the watch connected even if it started listening first
    // — the exact failure the Wear OS side hit, where a missed hello left Settings on "Not wired".
    send(path: "/smartplay/hello", payload: ["v": 1])
  }

  func send(path: String, payload: [String: Any]) {
    guard let s = session, s.activationState == .activated else { return }
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    let msg: [String: Any] = ["path": path, "data": String(decoding: data, as: UTF8.self)]
    if s.isReachable {
      s.sendMessage(msg, replyHandler: nil, errorHandler: nil)
    } else {
      s.transferUserInfo(msg)
    }
  }

  // ── WCSessionDelegate ─────────────────────────────────────────────────────

  func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

  func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { apply(message) }
  func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { apply(userInfo) }

  private func apply(_ message: [String: Any]) {
    guard let raw = message["data"] as? String,
          let obj = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any]
    else { return }

    DispatchQueue.main.async {
      switch obj["kind"] as? String {
      case "yardage":
        self.hole = obj["hole"] as? Int
        self.middle = obj["middle"] as? Int
        self.front = obj["front"] as? Int
        self.back = obj["back"] as? Int
        self.status = ""
      case "notification", "voice_prompt":
        self.message = obj["text"] as? String
      case "state":
        // Round ended / no fix — clear rather than leave a stale number on the wrist.
        if (obj["active"] as? Bool) == false {
          self.hole = nil; self.middle = nil; self.front = nil; self.back = nil
          self.status = "No round in play"
        }
      default:
        break
      }
    }
  }
}

// ── View ────────────────────────────────────────────────────────────────────

struct CaddieFace: View {
  @ObservedObject var state: CaddieState
  private let neon = Color(red: 0.53, green: 0.97, blue: 0.0)   // #88F700

  var body: some View {
    VStack(spacing: 2) {
      Text("SmartPlay")
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(neon)

      Text(state.hole.map { "HOLE \($0)" } ?? "—")
        .font(.system(size: 12, weight: .medium))
        .foregroundColor(.gray)

      // The hero number. A dash when the phone has not sent a fix — never a stale yardage.
      Text(state.middle.map(String.init) ?? "—")
        .font(.system(size: 46, weight: .bold, design: .rounded))
        .foregroundColor(.white)
        .minimumScaleFactor(0.6)
        .lineLimit(1)

      HStack(spacing: 14) {
        Text(state.front.map { "F \($0)" } ?? "F —").foregroundColor(.gray)
        Text(state.back.map { "B \($0)" } ?? "B —").foregroundColor(.gray)
      }
      .font(.system(size: 13, weight: .medium))

      Button(action: { state.send(path: "/smartplay/tap", payload: ["source": "watch"]) }) {
        Text("Ask caddie")
          .font(.system(size: 13, weight: .bold))
          .frame(maxWidth: .infinity)
      }
      .tint(neon)
      .padding(.top, 3)

      if let m = state.message, !m.isEmpty {
        Text(m).font(.system(size: 11)).foregroundColor(.gray).lineLimit(2)
      } else if !state.status.isEmpty {
        Text(state.status).font(.system(size: 11)).foregroundColor(.gray).lineLimit(2)
      }
    }
    .padding(.horizontal, 4)
  }
}

@main
struct SmartPlayWatchApp: App {
  @StateObject private var state = CaddieState()

  var body: some Scene {
    WindowGroup {
      CaddieFace(state: state)
        .onAppear { state.activate() }
    }
  }
}
