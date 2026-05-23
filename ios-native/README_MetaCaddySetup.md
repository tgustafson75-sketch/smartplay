# MetaCaddySetupView — install instructions

Single-file SwiftUI view that walks the user through installing the **Ask My Caddy** Shortcut so Meta AI on Ray-Ban Meta glasses can route hands-free dictation to `/api/meta-voice`.

## Honest constraint

Apple does **not** expose a public deep link to install a shortcut from an inline payload. The `shortcuts://create-shortcut?payload=…` URL pattern that circulates in forums was never shipped by Apple. The two supported URL schemes are:

| URL | Behavior |
|---|---|
| `shortcuts://run-shortcut?name=Ask%20My%20Caddy&input=text&text=Setup` | Runs an EXISTING shortcut. Errors politely if missing. |
| `https://www.icloud.com/shortcuts/<hash>` | Opens the iCloud share page. iOS prompts **Add Shortcut**. |

This view tries `run-shortcut` first; if the shortcut isn't installed it falls back to the iCloud share URL after ~1.5s.

## One-time setup before shipping

1. Open **Shortcuts.app** on your device.
2. Build the **Ask My Caddy** shortcut by following the 8-step recipe in the in-app **Manual Setup Guide** sheet (it's already in the view). Or copy from `docs/README_IOS_SHORTCUT.md` in the repo.
3. Tap the shortcut's Share button → **iCloud Link**.
4. Paste the resulting `https://www.icloud.com/shortcuts/<hash>` URL into `kSharedShortcutURL` at the top of `MetaCaddySetupView.swift`.
5. Commit the change.

After step 4, every user who taps **Connect Ray-Ban Meta Glasses** on a device that doesn't have the shortcut yet will be sent to the iCloud share page and prompted to add it.

## Adding to your existing iOS app

1. Drag `MetaCaddySetupView.swift` into your iOS target's Sources group in Xcode.
2. Embed it in your view tree:

```swift
import SwiftUI

struct SettingsScreen: View {
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("Glasses Setup") {
                    MetaCaddySetupView()
                }
            }
            .navigationTitle("Settings")
        }
    }
}
```

3. No `Info.plist` changes required — iOS allowlists `shortcuts://` and `https://www.icloud.com/shortcuts/...` by default.

## What the user sees

- Big "Connect Ray-Ban Meta Glasses" button with golf-flag SF symbol.
- Below the button: `Try saying: "Hey Meta, ask my caddy 150 to pin"`.
- Below that: privacy line "Shares location and voice only when you ask."
- If iOS reports the shortcut doesn't exist, the iCloud install page opens automatically.
- A **Manual Setup Guide** sheet (the 8-step recipe) is one tap away as a fallback.

## Endpoint URL

`MetaCaddySetupView.swift` references `kEndpointURL = "https://smartplay-beta.vercel.app/api/meta-voice"`. The shortcut itself embeds this URL — change it once in the shortcut + once in this file if you ever move the endpoint.

## Privacy compliance

The visible footer line ("Shares location and voice only when you ask.") satisfies App Store guideline 5.1.1 in plain copy. Match it in your App Store privacy details: this view triggers `Location` and `Microphone` access only when the user explicitly fires the Shortcut from Meta AI / Siri.

## Future: vision frames

When Meta opens the Ray-Ban camera API, extend the shortcut with a **Take Photo** action and pass `image_base64 = Photo` in the JSON dictionary. The endpoint already accepts `image_base64` (Zod-typed, optional) with a `TODO: vision frame attached` marker where the multimodal Sonnet call slots in. No server change required to start sending frames.
