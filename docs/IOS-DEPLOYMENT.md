# SmartPlay Caddie — iOS TestFlight Deployment Playbook

> Step-by-step guide to ship iOS builds from cloud (EAS Build) to TestFlight beta testers. Optimized for the "no iPhone, MacBook only, Expo managed workflow" path.
>
> **Prerequisites:** Apple Developer Program enrolled + activated, Xcode license agreed (`sudo xcodebuild -license`).

---

## TL;DR — once Apple Dev is active

```bash
# First-time only (interactive credential setup):
eas build --platform ios --profile preview

# Every future TestFlight build + submit, one command:
npm run ios:ship

# Code-only changes (no native rebuild needed):
npm run ota:preview     # or ota:production
```

---

## Phase 0 — Before Apple Dev activates (PREP done tonight)

These files are already configured:

| File | Status | What's in it |
|---|---|---|
| [app.json](../app.json) | ✅ ready | Bundle ID `com.smartplaycaddie.app`, all NS* permission strings, UIBackgroundModes `["audio", "location"]`, `ITSAppUsesNonExemptEncryption: false`, `supportsTablet: false` |
| [eas.json](../eas.json) | ✅ ready | `preview` (internal TestFlight), `production` (App Store/external TestFlight). `autoIncrement: "buildNumber"` set so EAS bumps build numbers automatically. `m-medium` ARM builder for faster iOS builds. Submit config with placeholders for Apple credentials. |
| [package.json](../package.json) | ✅ ready | Convenience scripts: `ios:build:preview`, `ios:build:production`, `ios:submit`, **`ios:ship`** (build + auto-submit in one), `ota:preview`, `ota:production` |
| iOS app icons + splash | ✅ ready | `expo-splash-screen` plugin uses `./assets/images/splash-icon.png`; main icon at `./assets/images/icon.png` |

### What still needs your input (after Apple activates)

The `eas.json` `submit` blocks have three `REPLACE_WITH_*` placeholders:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "REPLACE_WITH_APPLE_ID_EMAIL",
      "ascAppId": "REPLACE_WITH_APP_STORE_CONNECT_APP_ID",
      "appleTeamId": "REPLACE_WITH_APPLE_TEAM_ID"
    }
  }
}
```

You'll fill these in during Phase 2 below.

---

## Phase 1 — Apple Developer + App Store Connect setup (manual)

**Wait for Apple email: "Welcome to the Apple Developer Program"** (up to 48h from enrollment, usually faster for individual / sole proprietor).

### 1.1 Verify Apple Developer activation
1. Sign in: <https://developer.apple.com/account>
2. You should see "Account" with your name + agreements accepted
3. **Find your Team ID:** Account → Membership → Team ID (10-character alphanumeric). **Save this** — you need it for `appleTeamId` in `eas.json`.

### 1.2 Create the app in App Store Connect
1. Go to <https://appstoreconnect.apple.com> → Apps → **+** → New App
2. Fill in:
   - **Platform:** iOS
   - **Name:** `SmartPlay Caddie` (this is the App Store name; max 30 chars)
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** select `com.smartplaycaddie.app` from dropdown (Apple auto-detected from the team)
     - *If not in the dropdown*: go to <https://developer.apple.com/account/resources/identifiers/list> → **+** → App IDs → App → Bundle ID `com.smartplaycaddie.app` → Continue → Register. Then return to ASC and the dropdown will have it.
   - **SKU:** `smartplay-caddie-001` (any unique string — never shown to users)
   - **User Access:** Full Access
3. Click **Create**
4. **Find your ASC App ID:** Once the app record exists, look at the URL: `appstoreconnect.apple.com/apps/<APP_ID>/...` — the numeric `<APP_ID>` (10 digits) is your `ascAppId`. **Save this.**

### 1.3 Fill in the eas.json placeholders
Edit [eas.json](../eas.json) → `submit.preview.ios` AND `submit.production.ios`:

```json
"appleId": "your-apple-id-email@example.com",
"ascAppId": "1234567890",
"appleTeamId": "ABCD1234EF"
```

Commit + push.

### 1.4 (Optional) Generate an App Store Connect API Key
**Recommended for CI/CD** but not required for first build. If you skip this, EAS will prompt for your Apple ID password during `eas submit`.

1. ASC → Users and Access → **Integrations** tab → **App Store Connect API**
2. **+** → Name: "EAS Build Auto-Submit" → Access: **App Manager**
3. Generate → download the `.p8` key file (you can only download it ONCE — save it securely)
4. Note the **Issuer ID** and **Key ID** shown alongside
5. Add as EAS secrets:
   ```bash
   eas credentials   # interactive — choose iOS → Manage credentials → API key → upload
   ```

---

## Phase 2 — First iOS build (interactive credential setup)

**Run from your MacBook terminal, in the project directory.**

### 2.1 First build — interactive (NOT `--non-interactive`)
```bash
cd ~/Documents/smartplay
eas build --platform ios --profile preview
```

EAS will walk you through:
1. **Apple ID sign-in** — your Apple Developer email + password (and 2FA code if enabled)
2. **Select your team** — pick "Tim Gustafson (Individual)" or your team name
3. **Distribution certificate** — choose "Let EAS create one" (handles it server-side, no Keychain needed)
4. **Provisioning profile** — choose "Let EAS create one" → ad-hoc for internal distribution (preview profile)
5. **Push notifications key** — say NO unless you're shipping push notifs in v1 (you can add later)

Build time: ~25 minutes on `m-medium`. EAS sends a notification when done. Download URL is also shown in CLI output + on <https://expo.dev/builds>.

### 2.2 Verify the build
The `.ipa` file from EAS is internal-distribution. To install on a physical iPhone (a tester's, since you don't own one):
- You CANNOT install it on a phone whose UDID isn't in the provisioning profile (ad-hoc limitation)
- **Easier path: skip the preview test, go straight to TestFlight** (next phase)

---

## Phase 3 — TestFlight distribution

### 3.1 Build for App Store / external TestFlight
```bash
npm run ios:build:production
```

Or equivalently:
```bash
eas build --platform ios --profile production
```

This produces an App Store-signed `.ipa` suitable for TestFlight. Build time: ~25 minutes.

### 3.2 Submit to TestFlight
```bash
npm run ios:submit
```

Or equivalently:
```bash
eas submit --profile production --platform ios --latest
```

EAS uploads the latest production `.ipa` to App Store Connect. You'll be prompted for:
- Apple ID password (if you didn't set up the API key) OR
- Nothing if the API key is configured

Upload takes ~5 minutes. The build then enters Apple's processing (typically 10-30 minutes for the first build, faster on subsequent ones).

### 3.3 In App Store Connect — make the build TestFlight-available
1. Go to <https://appstoreconnect.apple.com> → Apps → SmartPlay Caddie → **TestFlight** tab
2. Wait for the build to finish processing (Apple emails you; status shows "Ready to Submit" or "Ready to Test")
3. Click the build → fill in:
   - **Export Compliance**: Answer "No" to non-exempt encryption (we declared `ITSAppUsesNonExemptEncryption: false` in app.json, so this should auto-resolve to "Missing Compliance" → click → confirm "No" → Save)
   - **Test Information** (required for external testers):
     - Beta App Description (1-2 paragraphs about what the beta does)
     - Email (your support email)
     - Privacy Policy URL (REQUIRED for external testers — placeholder OK during legal review; see SPRINT-LOG launch-prep)
4. **Internal Testing**: add yourself + up to 100 internal testers (must be App Store Connect users on your team). Internal testers can install immediately, no Apple review.
5. **External Testing**: create a tester group → add tester emails (up to 10,000). External builds need **Apple Beta App Review** (~24-48h first time, faster on updates). Once approved, testers get an email with a TestFlight install link.

### 3.4 Tester install flow
1. Tester installs **TestFlight** app from App Store
2. Opens your invite link → app installs
3. Tester can submit feedback via TestFlight → you see it in ASC → TestFlight → Feedback

---

## Phase 4 — Future updates (the one-command path)

### Code change requires native rebuild?
**Yes if you touched:** native modules, app.json plugins, Info.plist permissions, Android manifest, Expo SDK version, native dependency in package.json.

**No if you ONLY touched:** JS/TS files, styles, images, app routing, store logic, API endpoints. → Use OTA instead (next section).

### Single command: build + auto-submit to TestFlight
```bash
npm run ios:ship
```

Behind the scenes: `eas build --profile production --platform ios --auto-submit-with-profile production`. Builds the IPA, waits for completion, then submits to App Store Connect automatically. ~30 minutes end-to-end. You confirm export compliance + tester info in App Store Connect once Apple finishes processing.

### Symmetric Android
```bash
npm run android:build:production
```

### OTA-only update (no native rebuild — fastest path)
```bash
npm run ota:production
```

Pushes a JS bundle to the production channel. Both iOS + Android devices on that channel pull on next launch. **~1 minute end-to-end.** Use this for all the non-native fixes (most of tonight's work fit this pattern).

---

## CI/CD — auto-build on push to main (GitHub Actions)

### Setup
1. **Create EAS access token:**
   ```bash
   eas access-token:create --name "GitHub Actions"
   ```
   Copy the token.

2. **Add as GitHub secret:**
   - GitHub repo → Settings → Secrets and variables → Actions → New repository secret
   - Name: `EXPO_TOKEN`
   - Value: paste the token

3. **Create the workflow file** at `.github/workflows/ios-build.yml`:

```yaml
name: iOS TestFlight Build

on:
  # Trigger on version tags like v1.0.0, v1.0.1, etc.
  push:
    tags:
      - 'v*'
  # Manual trigger from GitHub UI
  workflow_dispatch:
    inputs:
      profile:
        description: 'EAS profile (preview or production)'
        required: true
        default: 'production'
        type: choice
        options:
          - preview
          - production
      submit:
        description: 'Auto-submit to TestFlight after build'
        required: true
        default: 'true'
        type: choice
        options:
          - 'true'
          - 'false'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: expo/expo-github-action@v8
        with:
          eas-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      - run: npm ci
      - name: Build iOS
        run: |
          PROFILE="${{ github.event.inputs.profile || 'production' }}"
          SUBMIT="${{ github.event.inputs.submit || 'true' }}"
          if [ "$SUBMIT" = "true" ]; then
            eas build --profile "$PROFILE" --platform ios --non-interactive --auto-submit-with-profile "$PROFILE"
          else
            eas build --profile "$PROFILE" --platform ios --non-interactive
          fi
```

### Usage
- **Push a release tag:**
  ```bash
  git tag v1.0.1
  git push origin v1.0.1
  ```
  → triggers a production iOS build + auto-submit to TestFlight.

- **Manual trigger:** GitHub Actions tab → "iOS TestFlight Build" → Run workflow → choose profile + submit toggle.

### Notes
- First time the workflow runs, EAS still needs your Apple credentials. Set them up once via local `eas credentials` (run interactively from your Mac) → EAS stores them server-side → CI uses them automatically.
- If you used the App Store Connect API key route (Phase 1.4), submission works fully unattended. Otherwise the build step succeeds but submit may fail without an interactive password prompt.

---

## Final deployment checklist

Run through this top-to-bottom for your first TestFlight ship:

- [ ] `sudo xcodebuild -license` accepted on your Mac
- [ ] Apple Developer Program shows "active" at <https://developer.apple.com/account>
- [ ] App record created in App Store Connect with bundle ID `com.smartplaycaddie.app`
- [ ] Team ID + ASC App ID + Apple ID email filled into `eas.json` submit blocks
- [ ] (Optional) App Store Connect API key uploaded via `eas credentials`
- [ ] `eas.json`, `package.json`, `app.json` all committed + pushed to main
- [ ] Run `eas build --platform ios --profile preview` interactively (one-time credential setup)
- [ ] Run `npm run ios:ship` for production build + auto-submit
- [ ] In ASC: confirm export compliance ("No" to non-exempt encryption)
- [ ] In ASC: fill in Test Information (Beta App Description, support email, Privacy Policy URL)
- [ ] In ASC: add internal testers (immediate access) or external testers (Beta App Review required)
- [ ] Tester installs TestFlight app, opens your invite link, installs SmartPlay Caddie

---

## Troubleshooting — common TestFlight failures

| Symptom | Cause | Fix |
|---|---|---|
| `eas build` fails with "couldn't find any credentials" | First-time iOS build needs interactive Apple sign-in | Run `eas build --platform ios --profile preview` (no `--non-interactive`) from your Mac |
| Build succeeds but `eas submit` fails with auth error | Apple ID password not provided OR App Store Connect API key not set up | Either pass password interactively, OR set up the API key via `eas credentials` |
| TestFlight build stuck in "Processing" >2 hours | Apple's processing backlog, usually clears within 24h | Wait. If still stuck, contact Apple support via App Store Connect. |
| TestFlight build status: "Missing Compliance" | Export compliance not declared | In ASC → TestFlight → build → click → answer No to non-exempt encryption → Save. We pre-declared `ITSAppUsesNonExemptEncryption: false` in app.json so future builds skip this. |
| Build rejected with "ITMS-90683: Missing purpose string" | A `NSXxxUsageDescription` is missing in Info.plist | Check error log for the specific NS* key, add to `app.json` → `ios.infoPlist`, rebuild |
| Build rejected with "ITMS-90078: Missing Push Notification Entitlement" | Code references push notifications but no APS entitlement | Either remove push code OR add Push Notifications capability via Apple Dev → Certificates, Identifiers & Profiles → Identifiers → your bundle ID → enable Push Notifications |
| External tester invite link 404s | App not yet approved for Beta App Review OR tester not added to the group | Wait for Apple Beta Review (~24-48h first time); confirm tester email is added to the correct external group |
| TestFlight: "This beta isn't accepting new testers" | External Beta App Review hasn't been submitted yet | ASC → TestFlight → External Testing → tester group → submit for review |
| Build version conflict ("CFBundleVersion must be greater than X") | Build number didn't increment | Already handled via `autoIncrement: "buildNumber"` in eas.json. If still firing, manually bump in app.json → `ios.buildNumber` |
| `eas build` says "running on m-medium" but you wanted to use free tier | The `resourceClass: "m-medium"` config is the new default for iOS | Either accept (faster builds, counts against credits) or set `resourceClass: "default"` for free-tier large queue |
| OTA update doesn't appear on device | Bundle hasn't been pulled; app must cold-launch twice (pull on launch 1, apply on launch 2) | Swipe app off recents twice. Check `Updates.updateId` matches latest in `eas update:list --branch production`. |

---

## When to use Transporter or Xcode (basically never)

For the EAS-managed Expo workflow with cloud builds, you should **never need Transporter or Xcode** for normal operations. EAS handles:
- IPA signing (server-side certificates + provisioning profiles)
- Submission to App Store Connect (via API, not Transporter)
- Build number incrementing (via `autoIncrement` in eas.json)
- Native iOS file generation (prebuild happens server-side on each `eas build`)

You'd only need Xcode if you:
- Want to test the iOS app on a Mac simulator (set `simulator: true` in eas.json's `ios` block, build, then run the resulting `.app` in Xcode's iOS Simulator) — but since you don't own an iPhone, the better path is just rely on TestFlight + a tester
- Need to debug a native crash that EAS Build couldn't reproduce
- Need to hand-edit native Xcode project files (rare with Expo managed workflow; almost always a sign you should be using a config plugin instead)

You'd only need Transporter if:
- `eas submit` is broken AND you have an IPA you want to upload manually — fall back to `xcrun altool --upload-app` from terminal instead (no Transporter needed)

---

## Security: secrets + env vars

**Already configured** in your expo.dev environments:
- `EXPO_PUBLIC_SENTRY_DSN` — auto-injects into iOS + Android builds
- `EXPO_PUBLIC_MAPBOX_TOKEN` — same

**For App Store Connect API key** (if you set it up): EAS stores it server-side. Never commit the `.p8` file to git (gitignore `*.p8`).

**Apple ID password**: never put in code, never put in env vars, never commit. Either type interactively per submit OR use the API key approach (preferred for CI/CD).

---

## Pre-flight before tomorrow's `ios:ship` run

When Apple Dev activates, before running anything:
1. Verify `eas.json` placeholders filled in (Apple ID, ASC App ID, Team ID)
2. Verify Privacy Policy URL exists (even a placeholder page is OK during legal review; required by Apple for external TestFlight testers — see SPRINT-LOG launch-prep)
3. Verify you have a test device available (your iPad? a friend's iPhone?) to install via TestFlight once the build clears Beta Review

You don't need to OWN an iPhone — once the TestFlight build is live, anyone you invite (with an iPhone) can install + test. You see their feedback through App Store Connect.
