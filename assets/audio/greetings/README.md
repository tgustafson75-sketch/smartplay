# Kevin Launch Greetings

Twelve pre-rendered MP3 files Kevin plays on cold launch. The screen at
`app/greeting.tsx` picks one based on time-of-day / day-of-week / launch
context and plays it before transitioning into the caddie home.

The 12 files in this directory are 0-byte placeholders so Metro bundles
cleanly. Replace each with the corresponding rendered audio (Kevin voice,
mp3, mono 24-44 kHz, ≤3 sec is ideal):

| File | Kevin's line |
|---|---|
| `universal_01.mp3` | "Welcome back. Let's play some golf." |
| `universal_02.mp3` | "There you are. Ready when you are." |
| `universal_03.mp3` | "Good to see you. Let's do this." |
| `morning_01.mp3` | "Early start today — I like it." |
| `morning_02.mp3` | "Morning. Course is calling." |
| `evening_01.mp3` | "Squeezing in a late round? Let's go." |
| `evening_02.mp3` | "Evening light's the best light. Let's play." |
| `weekend_01.mp3` | "Saturday golf is the right kind of golf." |
| `weekend_02.mp3` | "Weekend round. My favorite kind." |
| `first_launch.mp3` | "Welcome to SmartPlay Caddie. I'm Kevin — your golf companion. Let's play some golf." |
| `returning.mp3` | "Been a minute. Glad you're back." |
| `demo_mode.mp3` | "Welcome to SmartPlay Caddie. I'm Kevin — your AI golf companion." |

Render with the existing voice pipeline (`api/voice.ts` → ElevenLabs first,
OpenAI `gpt-4o-mini-tts` voice `onyx` fallback) so the timbre matches in-app
TTS exactly.

Until real audio lands, the greeting screen renders the visual (avatar fade
+ caption text) and then transitions silently into the caddie home — there
is no audible greeting but the launch flow still works end-to-end.
