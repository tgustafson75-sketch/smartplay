# EAS Build — Meta Wearables DAT setup

Two real gotchas surfaced on the first EAS build that included the Meta Wearables DAT native module. Both are closed permanently by the updated [`plugins/withMetaWearablesDAT.js`](../plugins/withMetaWearablesDAT.js); this doc captures the one-time setup step (a `GITHUB_TOKEN` EAS secret) and how to troubleshoot common failure modes.

## TL;DR

You need to do ONE thing in the EAS dashboard (no CLI), then re-run the build. Everything else is auto-injected at prebuild time.

1. Create a GitHub Personal Access Token with the `read:packages` scope.
2. Add it as an EAS environment variable named `GITHUB_TOKEN`.
3. Re-run `eas build`.

That's it. The plugin handles the rest.

## Step-by-step

### 1. Create the GitHub PAT
- Visit https://github.com/settings/tokens?type=beta (fine-grained PAT) OR https://github.com/settings/tokens (classic).
- **Fine-grained:** Resource owner = your account; Repository access = "Public repositories (read-only)"; **Permissions → Account permissions → Packages: Read-only**. Expiration: 90 days is reasonable.
- **Classic:** Check `read:packages`. That's the only scope needed.
- Copy the token now — GitHub only shows it once.

### 2. Add the token as an EAS env variable
- Go to https://expo.dev → your project → **Environment variables** (left sidebar).
- Click "New variable".
- Name: `GITHUB_TOKEN`
- Value: paste the PAT.
- Environments: tick **production**, **preview**, and **development** so every build profile picks it up.
- Visibility: **Secret** (so it doesn't show in build logs).
- Save.

### 3. Re-run the EAS build
- From the EAS dashboard or via `eas build --platform android --profile preview`.
- The prebuild step now resolves `process.env.GITHUB_TOKEN` and writes it into the project-level `build.gradle`'s Maven credentials block. Gradle then authenticates against `maven.pkg.github.com/facebook/meta-wearables-dat-android` and pulls the mwdat 0.7.0 artifacts.

## What the plugin does automatically (you don't touch any of this)

| Concern | How it's handled at prebuild |
|---|---|
| GitHub Packages Maven repo | Injected into `android/build.gradle`'s `allprojects.repositories` |
| `read:packages` token | Resolved from `process.env.GITHUB_TOKEN` → written as a literal into the gradle Maven `credentials` block (because `android/` is gitignored, the literal never enters git) |
| mwdat-core + mwdat-camera deps | Injected into `android/app/build.gradle`'s `dependencies` block |
| `manifestPlaceholders` (`MWDAT_APP_ID`, `MWDAT_CLIENT_TOKEN`) | Injected into `android/app/build.gradle`'s `defaultConfig` |
| `<meta-data>` attestation entries | Injected into the `<application>` block of `AndroidManifest.xml` |
| Bluetooth permissions | `BLUETOOTH` + `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` added to `AndroidManifest.xml` |
| Kotlin native module sources | Copied from `android-native/` into the prebuilt `android/app/src/main/java/com/smartplaycaddy/wearables/` path |
| **MainApplication.kt package registration** | `packages.add(com.smartplaycaddy.wearables.MetaWearablesPackage())` injected via `withMainApplication` mod |
| iOS Info.plist Bluetooth + Camera usage strings | Added |
| iOS Info.plist DAT attestation keys | Added |
| iOS Podfile mwdat pods | Added |
| iOS Swift + Obj-C sources | Copied from `ios-native/` to `ios/SmartPlayCaddie/Wearables/` |

## Fallback: commit the token to `app.json` (NOT recommended)

The plugin reads from `config.extra.githubToken` as a fallback. If you ever need to ship without the EAS env variable (e.g. a contractor needs to build locally), add to `app.json`:

```json
"extra": {
  "router": {},
  "eas": { "projectId": "..." },
  "githubToken": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

**Don't.** This commits the token into git. Use the EAS env path.

## Troubleshooting

### Build log shows "WARNING: GITHUB_TOKEN is not set"
The plugin's prebuild step couldn't resolve the token. Either:
- The EAS env variable hasn't been added yet → step 2 above.
- The variable was added but not enabled for the build profile you're running → re-check the environments tickboxes.

### Gradle fails with HTTP 401 against `maven.pkg.github.com`
The token resolved but doesn't have `read:packages` scope (or the scope was revoked). Generate a new PAT with the right scope and update the EAS env value.

### Gradle fails with HTTP 404 against `meta-wearables-dat-android`
The token resolved but your GitHub account doesn't have access to the `facebook/meta-wearables-dat-android` repo. The repo is public for invited developers — confirm your account has access at https://github.com/facebook/meta-wearables-dat-android.

### Build succeeds but `NativeModules.MetaWearablesFrame` is null at runtime
- Inspect the build log for `[withMetaWearablesDAT] injected MetaWearablesPackage into MainApplication.kt` — that's the confirmation line.
- If it shows `WARNING: could not locate PackageList(this).packages in MainApplication.kt`, Expo regenerated MainApplication with a new template shape. Update the `valLineRegex` in [`plugins/withMetaWearablesDAT.js`](../plugins/withMetaWearablesDAT.js)'s `withMainApplicationInjection` to match.

### iOS build fails on the Wearables pod
- The Wearables pod is fetched from a private GitHub repo (`facebook/meta-wearables-dat-ios.git`). Same `GITHUB_TOKEN` resolution path — but iOS CocoaPods doesn't use the gradle credentials block. If you hit iOS pod auth failures, set `bundler` → `gem install cocoapods` and configure git to use the PAT for HTTPS GitHub URLs (CocoaPods inherits git's auth). This is a deferred item until Apple Developer enrollment lands; for now Android-only EAS builds are the focus.

### "Plugin not found" or "Cannot find module 'withMetaWearablesDAT'"
The plugin is registered in `app.json` as `"./plugins/withMetaWearablesDAT.js"`. If the file path got renamed, update the entry in `app.json`'s `plugins` array.

## What to verify after a successful build

Install the APK on a paired-glasses device, then:

1. Settings → glasses connection toggle (TODO: ship UI; bridge API is already in place — see [`services/metaWearablesBridge.ts`](../services/metaWearablesBridge.ts)).
2. Open SmartMotion. The header should show a `MULTIMODAL ON` chip (green) when frames are flowing, `GLASSES PAIRED` (amber) when paired but no recent frame, `GLASSES OFF` (neutral) when paired but inactive.
3. Same chip appears on the PuttingLab card and inside the SmartVision hole/par badge.
4. Trigger an analysis (record a swing, capture a lie, ask the caddie a question) — the latest glasses frame should fold into the call automatically because every consumer reads from `services/glassesVisionInput`.

## References

- Integration architecture: [`docs/META_WEARABLES_DAT_INTEGRATION.md`](META_WEARABLES_DAT_INTEGRATION.md)
- SDK reference snapshot: [`android-native/META_WEARABLES_DAT_SDK_REFERENCE.md`](../android-native/META_WEARABLES_DAT_SDK_REFERENCE.md)
- Plugin source: [`plugins/withMetaWearablesDAT.js`](../plugins/withMetaWearablesDAT.js)
