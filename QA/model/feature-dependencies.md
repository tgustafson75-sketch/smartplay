# Feature Dependency Graph

> QA audit 2026-07-21. High-level coupling between features and the shared services/stores
> they lean on. Use this to scope blast radius before a change.

## Shared spine (touched by almost everything)
- **`store/*` (53 Zustand stores, 45 persisted)** → AsyncStorage via `services/ssrSafeStorage`.
- **`services/cloudSync/snapshot.ts` + `api/backup.ts`** → back up / restore the persisted stores. Any store added to `BACKED_UP_STORE_KEYS` inherits the merge/restore semantics (see H1/H2).
- **`api/_aiProvider.ts`** → provider selection + `withGeminiTimeout`; brain, swing, lie, putting, cage all route through it.
- **`services/apiBase` (`getApiBaseUrl`)** → every client fetch; prod fallback host (never `*.vercel.app`).
- **`contexts/SmartVisionContext` + `KevinPresenceContext` + `ThemeContext`** → mounted at root; camera/voice/theme consumers depend on them.

## Feature clusters → key deps
| Feature | Screens | Stores | APIs |
|---|---|---|---|
| Caddie brain / voice | `(tabs)/caddie`, `GlobalCaddieMic` | `caddieMemoryStore`, `conversationLogStore`, `vocabularyProfileStore`, `trustLevelStore` | `brain`, `voice*`, `kevin`, `pipecat-*` *(FROZEN)* |
| SwingLab / analysis | `swinglab/smartmotion`, `swing/[swing_id]`, `library` | `cageStore`, `clubStatsStore`, `practicePointsStore` | `swing-analysis`, `pose-analysis`, `swing-question`, `cage-review` |
| On-course | `(tabs)/play`, `smartfinder`, `course-layout` | `roundStore`, `clubBagStore`, `smartFinderStore`, `gpsHealthStore` | `course-*`, `hole-scan`, `elevation`, `weather` |
| Scorecard / recap | `(tabs)/scorecard`, `recap/*` | `roundStore` | `recap`, `parse-shot` |
| Practice / points | `practice/*`, `drills/*` | `practiceStore`, `practiceSessionStore`, `pointsStore`, `coachKnowledgeStore` | `preround`, `tutorial-analysis` |
| Backup / account | `settings`, `CloudBackupCard` | *(all backed-up stores)* | `backup` |
| Messaging | `messages` | — | `messages` *(H4 IDOR)* |
| Family / social | `family/*` | `familyStore`, `relationshipStore`, `teamIntelligenceStore` | `kevin-read` |

## Cross-feature risk edges
- **Backup ↔ every persisted store**: a store's `partialize`/`migrate` shape decides what survives restore. Changing a persisted shape without a migration = silent data loss.
- **AI provider chain ↔ all AI features**: a bare Gemini call (no `geminiWithTimeout`) can stall a whole endpoint (M1/M2 pattern) — audit new AI routes for the wrapper.
- **SmartVisionContext ↔ camera + voice**: camera owns the mic; voice active-listening must not naively contend (see voice-flow.md).
- **Route params ↔ hydration**: dynamic-param screens rendered pre-store-hydration must keep all hooks unconditional (H5 pattern).
