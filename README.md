# SmartPlay Caddie

A voice-first AI golf caddie. Pick a persona (Kevin, Serena, Harry, Tank), let the app track your round via GPS + voice + audio swing detection, and get on-course advice that actually feels like the named caddie giving it.

## Stack

- **App:** Expo SDK 54, React Native, expo-router, Zustand (with AsyncStorage persist), Hermes
- **AI:** Anthropic Claude (Sonnet 4.6 + Haiku 4.5), OpenAI (gpt-4o-mini text + gpt-4o-mini-tts fallback voice)
- **Voice:** ElevenLabs primary (per-persona voice IDs), OpenAI TTS fallback
- **Backend:** Vercel-hosted `/api/*` routes (server-side persona-aware system prompts)
- **Data:** Supabase (per-user persistence), golfcourseapi.com (course geometry)
- **Build:** EAS Build, Android APK as primary distribution; iOS not yet wired

## Quick start

```bash
npm install
cp .env.local.example .env.local       # fill in API keys (Anthropic, OpenAI, ElevenLabs, etc.)
npx expo start --dev-client             # default port 8081
# or:
npx expo start --dev-client --port 8082 # if 8081 is taken
```

Open the dev-client app on the device, **Enter URL manually**, type `<mac-ip>:<port>`. The bundle loads.

USB-tethered Android shortcut: `adb reverse tcp:8082 tcp:8082` then enter `localhost:8082` in the dev-client.

## Verifying anything works

The four critical paths each have a MIN VERIFY scenario in [docs/critical-paths.md](docs/critical-paths.md). External beta-readiness requires all four green within 7 days on a real device. See [CLAUDE.md](CLAUDE.md) "Critical Path Verification Gates" for the discipline.

## Where things live

- `app/` — Expo Router file-based routes (screens + API endpoints)
- `services/` — non-React side-effect modules (audio, GPS, voice, telemetry, etc.)
- `store/` — Zustand stores (13 persisted, 2 are gated in `app/index.tsx` for cold-launch hydration)
- `components/` — React components (CaddieAvatar, CageSessionOverlay, etc.)
- `lib/persona.ts` — persona type system + `getCaddieName` / `getCharacterSpec` / pronoun helpers
- `api/` + `app/api/` — server-side route handlers (deployed to Vercel)
- `docs/` — phase decisions, audits, critical paths, deferred items. See [docs/INDEX.md](docs/INDEX.md).

## Conventions

[CLAUDE.md](CLAUDE.md) is the source of truth for project conventions. Highlights:

- **Critical Path Verification Gates** — phases that touch PATH 1 / 2 / 3 / 4 must pass MIN VERIFY before they ship
- **Locked elements** — Kevin's photoreal portrait is canonically locked at commit `19165fb`; do not add transforms in CaddieAvatar to compensate for layout shifts
- **AbortSignal polyfill** — `services/polyfills.ts` is imported first in `app/_layout.tsx`; do not move
- **Persona resolution** — pass `caddiePersonality` (not `voiceGender`) to `getCaddieName()`
- **Honest scope discipline** — don't ship features beyond what the phase requires; don't fake completion

## v1.1 status

In progress per Phase 100. See [docs/audit-100-verdict.md](docs/audit-100-verdict.md) for the current verdict (Foundation / paths / personas / beta-readiness).

Deferred items: [docs/v1.2-deferred.md](docs/v1.2-deferred.md).
