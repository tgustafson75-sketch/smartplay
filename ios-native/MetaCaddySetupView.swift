//
//  MetaCaddySetupView.swift
//  SmartPlay Caddy — Ray-Ban Meta glasses onboarding
//
//  2026-05-22
//
//  Single-file SwiftUI view that walks the user through installing the
//  "Ask My Caddy" Shortcut so Meta AI can route their dictation to our
//  /api/meta-voice endpoint hands-free.
//
//  HONEST CONSTRAINT (read this before shipping):
//  Apple does NOT expose a public deep link that programmatically
//  installs a shortcut from a payload. The two URL schemes that ARE
//  documented + supported:
//      shortcuts://run-shortcut?name=Ask%20My%20Caddy&input=text&text=Setup
//          -> Runs an EXISTING shortcut. Errors politely if absent.
//      https://www.icloud.com/shortcuts/<hash>
//          -> Opens the iCloud-hosted shortcut share page; iOS prompts
//             "Add Shortcut". This is how you distribute a pre-built
//             shortcut to other users.
//
//  There is NO `shortcuts://create-shortcut` API that accepts an inline
//  base64 payload. That URL pattern circulated in forums but Apple
//  never shipped it. Building it into production code would silently
//  fail on every device.
//
//  THE WORKING FALLBACK:
//  1. Build the shortcut once in Shortcuts.app on YOUR device.
//  2. Tap Share -> iCloud Link. Paste the resulting
//     https://www.icloud.com/shortcuts/<hash> URL into kSharedShortcutURL
//     below.
//  3. The view opens that URL on tap when run-shortcut fails. iOS
//     handles the "Add Shortcut?" confirm sheet natively.
//
//  HOW TO ADD TO EXISTING APP:
//  - Drop this file into your iOS target's Sources group.
//  - Replace kSharedShortcutURL with your real iCloud link.
//  - Replace kEndpointURL if your meta-voice endpoint lives elsewhere.
//  - Embed `MetaCaddySetupView()` anywhere in your SwiftUI tree
//    (e.g. a row in your Settings screen, an onboarding step).
//  - No Info.plist changes needed for shortcuts:// (iOS allowlists it).
//
//  No external dependencies. Pure SwiftUI + UIKit (for UIApplication open).
//

import SwiftUI
import UIKit

// MARK: - Configuration

/// Replace with your real iCloud share link AFTER building "Ask My Caddy"
/// once in Shortcuts.app and tapping Share -> iCloud Link.
private let kSharedShortcutURL = URL(string: "https://www.icloud.com/shortcuts/REPLACE_WITH_REAL_HASH")!

/// SmartPlay meta-voice endpoint. Keep in sync with vercel.json.
private let kEndpointURL = "https://smartplay-beta.vercel.app/api/meta-voice"

/// Shortcut name — must match exactly what users will name the shortcut
/// in the Shortcuts app for the run deep-link to resolve.
private let kShortcutName = "Ask My Caddy"

// MARK: - View

public struct MetaCaddySetupView: View {
    @State private var status: SetupStatus = .idle
    @State private var showingManualGuide = false

    public init() {}

    public var body: some View {
        VStack(spacing: 24) {
            header
            installButton
            statusBlock
            privacyFooter
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(.systemBackground))
        .sheet(isPresented: $showingManualGuide) {
            ManualSetupGuide()
        }
    }

    // MARK: Subviews

    private var header: some View {
        VStack(spacing: 8) {
            Text("⛳️")
                .font(.system(size: 56))
            Text("Connect Ray-Ban Meta Glasses")
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
            Text("Install the “Ask My Caddy” shortcut so Meta AI can route your hands-free questions to SmartPlay.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var installButton: some View {
        Button(action: handleInstall) {
            HStack(spacing: 10) {
                Image(systemName: "flag.fill")
                Text("Connect Ray-Ban Meta Glasses")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Color.accentColor)
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    @ViewBuilder
    private var statusBlock: some View {
        switch status {
        case .idle:
            EmptyView()
        case .runOpened:
            VStack(spacing: 6) {
                Text("Shortcut ran. If iOS said it doesn’t exist, the install link will open next.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                tryItLine
            }
        case .installOpened:
            VStack(spacing: 8) {
                Text("Tap **Add Shortcut** when Shortcuts.app opens.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                tryItLine
            }
        case .failed(let message):
            VStack(spacing: 10) {
                Text(message)
                    .font(.footnote)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
                Button("Walk me through it manually") {
                    showingManualGuide = true
                }
                .font(.footnote.weight(.semibold))
            }
        }
    }

    private var tryItLine: some View {
        Text("Try saying: **“Hey Meta, ask my caddy 150 to pin”**")
            .font(.subheadline.weight(.medium))
            .foregroundColor(.primary)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(Color.accentColor.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .multilineTextAlignment(.center)
    }

    private var privacyFooter: some View {
        VStack(spacing: 4) {
            Image(systemName: "lock.shield")
                .font(.footnote)
                .foregroundColor(.secondary)
            Text("Shares location and voice only when you ask.")
                .font(.footnote)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 8)
    }

    // MARK: Actions

    private func handleInstall() {
        // 1. Try to RUN the shortcut by name. If the user has it installed
        //    already, Shortcuts.app opens and executes immediately.
        let runURL = makeRunURL()
        UIApplication.shared.open(runURL, options: [:]) { didOpen in
            if didOpen {
                self.status = .runOpened
                // Race condition: iOS may say "Couldn't run — no such
                // shortcut" without telling us. So we always queue the
                // install fallback after a short delay.
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    self.openInstallURL()
                }
            } else {
                // 2. run-shortcut deep link itself failed to open
                //    (Shortcuts.app disabled or device restriction).
                //    Go straight to install.
                self.openInstallURL()
            }
        }
    }

    private func openInstallURL() {
        UIApplication.shared.open(kSharedShortcutURL, options: [:]) { didOpen in
            DispatchQueue.main.async {
                if didOpen {
                    self.status = .installOpened
                } else {
                    self.status = .failed(message:
                        "Couldn’t open the install link. Open Shortcuts.app and add “Ask My Caddy” manually."
                    )
                }
            }
        }
    }

    private func makeRunURL() -> URL {
        // shortcuts://run-shortcut?name=Ask%20My%20Caddy&input=text&text=Setup
        var c = URLComponents()
        c.scheme = "shortcuts"
        c.host = "run-shortcut"
        c.queryItems = [
            URLQueryItem(name: "name", value: kShortcutName),
            URLQueryItem(name: "input", value: "text"),
            URLQueryItem(name: "text", value: "Setup"),
        ]
        return c.url!
    }
}

// MARK: - Setup status

private enum SetupStatus: Equatable {
    case idle
    case runOpened
    case installOpened
    case failed(message: String)
}

// MARK: - Manual setup guide (sheet)

private struct ManualSetupGuide: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Group {
                        Text("Build “Ask My Caddy” manually")
                            .font(.title3.weight(.bold))
                        Text("Open the Shortcuts app and create a new shortcut with these 8 actions:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }

                    stepRow(
                        n: 1, title: "Dictate Text",
                        body: "Language: English. Stop Listening: After Pause. Rename output to “Dictation”."
                    )
                    stepRow(
                        n: 2, title: "Get Current Location",
                        body: "Accuracy: Best."
                    )
                    stepRow(
                        n: 3, title: "Get Clipboard",
                        body: "Rename output to “PriorState”."
                    )
                    stepRow(
                        n: 4, title: "Dictionary",
                        body: """
                        query = Dictation
                        gps = { lat = Location > Latitude, lng = Location > Longitude }
                        spoken_context = (empty for now)
                        user_id = Device Name (or iCloud email)
                        state = PriorState
                        """
                    )
                    stepRow(
                        n: 5, title: "Get Contents of URL",
                        body: """
                        URL: \(kEndpointURL)
                        Method: POST
                        Headers: Content-Type = application/json
                        Request Body: JSON = the Dictionary above
                        """
                    )
                    stepRow(
                        n: 6, title: "Get Dictionary Value",
                        body: "Get: Value. Key: speak. From: Contents of URL."
                    )
                    stepRow(
                        n: 7, title: "Speak Text",
                        body: "Text: the dictionary value from step 6."
                    )
                    stepRow(
                        n: 8, title: "Get Dictionary Value + Copy to Clipboard",
                        body: "Get value for key “state” from Contents of URL, then Copy to Clipboard."
                    )

                    Divider().padding(.vertical, 6)

                    Group {
                        Text("Settings")
                            .font(.headline)
                        Text("Tap the shortcut’s Details button:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        bullet("Name: “Ask My Caddy”")
                        bullet("Icon: pick the golf flag")
                        bullet("Accepts Siri / Apple Intelligence requests with phrase “ask my caddy”")
                    }

                    Group {
                        Text("Try it")
                            .font(.headline)
                            .padding(.top, 8)
                        Text("Say to your Ray-Ban Meta glasses:")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Text("“Hey Meta, ask my caddy 150 to pin”")
                            .font(.subheadline.weight(.semibold))
                            .padding(.vertical, 8)
                            .padding(.horizontal, 12)
                            .background(Color.accentColor.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    Group {
                        Text("Privacy")
                            .font(.headline)
                            .padding(.top, 8)
                        Text("Shares location and voice only when you ask. Nothing is stored on a server beyond the request itself.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Manual Setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func stepRow(n: Int, title: String, body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.subheadline.weight(.bold))
                .frame(width: 22, height: 22)
                .background(Color.accentColor.opacity(0.18))
                .foregroundColor(.accentColor)
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(body)
                    .font(.footnote)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func bullet(_ s: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("•").foregroundColor(.secondary)
            Text(s).font(.footnote).foregroundColor(.secondary)
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    MetaCaddySetupView()
}
#endif
