# SmartPlay Caddie — Application Model

> Living model built by the autonomous QA system. Regenerate/append each run.
> **Repo root:** `/Users/timothyg/smartplay` (the `smartplaycaddie` dir is an empty stub — do not use it.)
> Last full pass: 2026-07-21

## Scale
- **711** TS/TSX source files, TypeScript **strict** mode.
- **88** screens (`app/`, expo-router), **11** client API routes (`app/api/*+api.ts`), **54** server API routes (`api/`).
- **53** Zustand stores (**45** persisted via `persist()` → AsyncStorage). This is the primary data-integrity surface.
- **97** components, **12** hooks, **3** contexts.
- `components/ErrorBoundary.tsx` present (getDerivedStateFromError + componentDidCatch).

## Stack
- Expo / React Native, expo-router file-based navigation.
- State: Zustand + persist middleware (AsyncStorage).
- Backend: serverless routes under `api/` (Vercel), custom domain `api.smartplaycaddie.com` (never ship on `*.vercel.app` — DNS-filtered on course networks).
- AI: `@anthropic-ai/sdk`, `@google/genai`. Voice: pipecat pipeline (`usePipecatVoice`, `useVoiceCaddie`).

## Largest / highest-blast-radius files
| File | LOC | Notes |
|---|---|---|
| `app/swinglab/smartmotion.tsx` | 4815 | swing capture + analysis UI |
| `app/(tabs)/caddie.tsx` | 4706 | caddie tab, voice surface |
| `app/swinglab/swing/[swing_id].tsx` | 3601 | swing review |
| `app/settings.tsx` | 2896 | settings density |
| `hooks/useVoiceCaddie.ts` | 2553 | **VOICE PATH — FREEZE** |
| `app/smartvision.tsx` | 2483 | live vision |
| `app/smartfinder.tsx` | 2421 | on-course read |
| `api/kevin.ts` | 1642 | caddie brain server |
| `api/swing-analysis.ts` | 1603 | pose/swing AI |

## Constraints honored by QA
- **VOICE PATH FREEZE**: `useVoiceCaddie.ts`, `usePipecatVoice.ts`, `api/voice*.ts`, `api/pipecat-*.ts`, `app/api/voice*`, VAD hooks — audit read-only; findings flagged for Tim, **no code changes proposed**.
- **Root-cause only**: no band-aids.
- **No fabricated metrics**: this environment cannot run the RN app, so no live CPU/battery/FPS/crash-rate numbers are produced — only static findings + runnable tests.

See: [navigation-map.md](navigation-map.md), [state-machine.md](state-machine.md), [api-map.md](api-map.md), [voice-flow.md](voice-flow.md), [camera-flow.md](camera-flow.md), [feature-dependencies.md](feature-dependencies.md).
