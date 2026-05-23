# Ask My Caddy — iOS Shortcut Setup

Hands-free SmartPlay Caddy on Ray-Ban Meta glasses via iOS Shortcuts + Meta AI.

**Trigger phrase:** "Hey Meta, ask my caddy [question]"

Meta AI captures your dictation, hands it to the iOS Shortcut, the Shortcut POSTs to `/api/meta-voice`, and Meta AI reads the response aloud through your glasses' speakers. State carries forward between shots via the device clipboard (no server-side session needed).

---

## Step-by-step shortcut config

Open the **Shortcuts** app on iPhone → tap **+** → **Add Action** for each row below.

### Shortcut name
`Ask My Caddy`

### Action 1 — Receive dictation
- Search: **Dictate Text**
- Set: **Language = English (US)**, **Stop Listening = After Pause**
- Rename the output variable to `Dictation`

### Action 2 — Get location
- Search: **Get Current Location**
- Set: **Accuracy = Best**
- Rename the output variable to `Location`

### Action 3 — Read previous state from clipboard
- Search: **Get Clipboard**
- Rename the output variable to `PriorState`

### Action 4 — Build the JSON body
- Search: **Dictionary**
- Add keys:
  - `query` = (Variable) Dictation
  - `gps` (Dictionary):
    - `lat` = (Variable) Location → Latitude
    - `lng` = (Variable) Location → Longitude
  - `spoken_context` = (leave empty string for now — populated when Meta opens vision)
  - `user_id` = (Variable) **Get iCloud Account** → email (or any stable per-user string)
  - `state` = (Variable) PriorState

### Action 5 — POST to the endpoint
- Search: **Get Contents of URL**
- URL: `https://smartplay-beta.vercel.app/api/meta-voice`
- Method: **POST**
- Headers: `Content-Type` = `application/json`
- Request Body: **JSON** = (Variable) Dictionary from step 4

### Action 6 — Pull the `speak` field
- Search: **Get Dictionary Value**
- Get: **Value for**
- Key: `speak`
- From: (Variable) Contents of URL

### Action 7 — Read it aloud
- Search: **Speak Text**
- Text: (Variable) Dictionary Value from step 6
- Rate: **Default**, Pitch: **Default**, Voice: any natural voice

### Action 8 — Save the new state back to clipboard
- Search: **Get Dictionary Value**
- Get: **Value for**
- Key: `state`
- From: (Variable) Contents of URL
- Then add another action: **Copy to Clipboard**
- Copy: (Variable) Dictionary Value from this step

---

## How to invoke

Say to your Meta glasses:

> "Hey Meta, ask my caddy how far to the pin"

Meta AI launches the shortcut, dictation captures "how far to the pin", the shortcut POSTs with your GPS, and the caddy's reply plays through the glasses.

Other phrases that work:
- "Hey Meta, ask my caddy what's the play here"
- "Hey Meta, ask my caddy how's my lie"
- "Hey Meta, ask my caddy I made it" (lets the caddy log the result + react)
- "Hey Meta, ask my caddy what should I hit"

---

## Privacy

- The endpoint logs `user_id` (first 8 chars only), `intent`, and latency. No GPS, no query content, no name.
- State lives **on your device** in the clipboard. The server never persists it.
- When Meta opens their camera API, the shortcut can be extended with a vision capture step; the endpoint already accepts an optional `image_base64` field with a TODO marker.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Glasses say "I need your location. Open Caddy on phone." | Location services are off, or the Shortcut didn't get permission. Open Settings → Privacy → Location → Shortcuts → While Using. |
| Glasses say "One sec — finishing my read." | The endpoint took >1.5s. Try again with a fresh GPS lock. Persistent slowness = report. |
| Wrong hole reported | Hole advance fires when GPS jumps >200y. If it's stuck, just say "I'm on hole 7" — the next round of context catches up. |
| State seems to reset every shot | Confirm Action 8 actually copies the `state` Dictionary Value back to clipboard before the shortcut ends. |
