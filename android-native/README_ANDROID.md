# Android Voice Handler — SmartPlay Caddy + Ray-Ban Meta

Hands-free SmartPlay Caddy on Android paired with Ray-Ban Meta glasses, via Google Assistant.

**User phrase:**

> "Hey Google, ask Smart Play Caddy 145 to pin"

If the user has Ray-Ban Meta glasses paired to Android as a Bluetooth headset, the spoken reply plays through the glasses' speakers automatically (TTS uses `STREAM_VOICE_CALL` which routes to the active BT HFP/HSP profile). Meta AI on the glasses will hear that audio and relay it back to the user — no extra integration needed on the Meta side.

---

## Files in this drop

| File | Where it goes |
|---|---|
| `MetaCaddyVoiceHandler.kt` | `app/src/main/java/com/smartplaycaddy/voice/MetaCaddyVoiceHandler.kt` |
| `AndroidManifest_snippet.xml` | Merge into `app/src/main/AndroidManifest.xml` |
| `shortcuts.xml` | `app/src/main/res/xml/shortcuts.xml` |

No external Gradle dependencies. SDK 34 target.

---

## Setup

### 1. Drop files in place
Copy the three files into the paths above. If `com.smartplaycaddy` isn't your real package name, search-and-replace it everywhere (`MetaCaddyVoiceHandler.kt` package line, `shortcuts.xml` `targetPackage`, and the manifest activity reference).

### 2. Merge manifest
Open `AndroidManifest_snippet.xml` and paste:
- The `<uses-permission>` blocks at the top, inside `<manifest>`
- The `<activity>` block inside `<application>`
- The `<meta-data android:name="android.app.shortcuts">` reference inside `<application>`

### 3. Verify
```
./gradlew assembleDebug
```
Should compile clean. No `OnInitListener` import errors, no missing `BuildConfig.APPLICATION_ID`.

### 4. Test via adb (no Assistant required)
```
adb shell am start -a android.intent.action.VIEW -d "smartplay://meta-voice?q=145%20to%20pin"
```
The activity launches, fetches GPS, hits `/api/meta-voice`, and speaks the reply through whatever audio output is active. If your phone is paired to Meta glasses, the audio routes there.

### 5. Test via Google Assistant
```
"Hey Google, open Smart Play Caddy"
```
This launches the activity. Because the query is empty, the activity opens dictation. Speak your question — it gets POSTed to the caddy and spoken back.

### 6. Test via App Actions (requires Google registration — see below)
```
"Hey Google, ask Smart Play Caddy 145 to pin"
```
After App Actions is registered, Assistant inlines "145 to pin" into the intent extra `thing_name`, which `MetaCaddyVoiceHandler.kt` reads as `EXTRA_QUERY`. The activity skips dictation and goes straight to the POST.

---

## How "Hey Google" works (honest read)

The trigger phrase `Hey Google, ask Smart Play Caddy [question]` only routes the trailing `[question]` into your activity if:

1. `shortcuts.xml` declares an `actions.intent.GET_THING` capability (✅ included in this drop).
2. The capability's `<intent>` points at `MetaCaddyVoiceHandler` (✅).
3. The app is **registered with Google's App Actions console** (you do this once after the app ships):
   - Go to https://actions.developers.google.com/
   - Add your app
   - Submit shortcuts.xml for review (usually approved within 24-48h)
   - Test via the App Actions Test Tool plugin for Android Studio

**Until step 3 is done**, the trigger phrase falls back to "Hey Google, open Smart Play Caddy" → activity launches with no query → activity opens dictation. The full flow still works; the user just has to wait one extra beat before speaking the question.

---

## Privacy

The activity:
- Requests location ONLY when invoked. No background location.
- Persists state JSON to `SharedPreferences` (`MetaCaddyPrefs`) so the caddy can carry conversation continuity across invocations.
- Generates a stable per-install user_id on first launch (random UUID + device-model hint). Never reads `ANDROID_ID` (deprecated for cross-app identification on modern Android).
- Logs only `intent action`, `user_id prefix`, and latency — no GPS, no query content, no PII.

App Store / Google Play data-safety form:
- **Location**: shared only when user explicitly invokes the shortcut.
- **Microphone**: used only during dictation when Assistant didn't inline the query.

---

## Ray-Ban Meta audio routing

When Meta glasses are paired as Bluetooth headset:
- `STREAM_VOICE_CALL` (what we use) routes through the BT HFP/HSP profile that Meta glasses register as.
- The glasses' speakers play the caddy reply.
- Meta AI on the glasses hears the audio in its mic environment and can re-relay if needed.

No app-side Meta SDK integration required. If the user is wearing the glasses + paired, it just works.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Hey Google, ask Smart Play Caddy ..." launches but ignores the question | App Actions not registered yet. Either register or use the dictation fallback ("Hey Google, open Smart Play Caddy"). |
| Reply plays through phone speaker instead of glasses | Glasses not paired, or BT HFP profile didn't connect. Re-pair from system Bluetooth settings. |
| Activity launches but never speaks | TTS engine not installed / disabled on device. Settings → System → Languages & input → Text-to-speech output. |
| 401 / 429 from the endpoint | User hit rate limit (30 req/min) or `ANTHROPIC_API_KEY` missing server-side. Wait 60s and retry. |
| Glasses paired but audio still plays through phone | Some launchers force STREAM_MUSIC. Change line in `speak()`: `KEY_PARAM_STREAM = AudioManager.STREAM_MUSIC`. |
