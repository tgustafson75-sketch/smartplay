# Phase BS — Commits-in-main Audit

**Date:** 2026-05-04
**Question:** What's actually in `main` from today's session?

---

## Headline finding

**Zero commits since session start.** All of today's work is **uncommitted local diff**.

```
git log --since='2026-05-04 00:00' --oneline → empty
git log --oneline -1 → 0b6696f Phase BH followup …  (commit from before today)
```

This is the most load-bearing audit finding in BS. **Tim's next EAS dev-client build will not include any of today's work unless it's committed and the build pulls from a fresh push.** Everything documented in this audit is local-state-only.

---

## What's in the local working tree

```
git status --short summary:
  27 modified files
  36 untracked files (new files + new directories)
  total: 63 changed entries

git diff --stat (modified files only):
  27 files changed, 1,478 insertions(+), 63 deletions(-)
  (the 36 untracked files contribute additional LOC not counted above)
```

### Modified files (27) — touched code paths

Server endpoints:
- `api/kevin.ts` — practice_context injection (BR)
- `api/recap.ts` — practice_context block in recap prompt (BR Component 9)
- `api/swing-analysis.ts` — `mode: 'tentative'` heuristic-fallback prompt (U1)
- `api/voice-intent.ts` — club_change / club_query / club_menu intents (BL)

Mobile screens:
- `app/(tabs)/caddie.tsx` — KevinAvatar dead-import removal (U2), buildFullPracticeContext for recap (BR)
- `app/(tabs)/swinglab.tsx` — Tutorials entry + redirect Add Tutorial (BR Component 14), YouTube hardening (BM)
- `app/_layout.tsx` — 3 new tutorial routes registered (BR)
- `app/cage/session.tsx` — "ID club" button + club picker modal + applyClubSwitch (BL)
- `app/greeting.tsx` / `app/paywall.tsx` / `app/round/briefing.tsx` — voiceGender portrait swap (BN)
- `app/settings.tsx` — cageAutoClubDetection toggle (BL), Practice section
- `app/swinglab/swing/[swing_id].tsx` — `[upload:ui-render]` markers (BQ)
- `app/swinglab/upload.tsx` — `[upload:save-tap]` marker (BQ)

Services + state:
- `components/CaddieAvatar.tsx` — SERENA_AVATARS map (BN)
- `hooks/useKevin.ts` / `hooks/useVoiceCaddie.ts` / `services/listeningSession.ts` — practice_context payload (BR)
- `services/intents/index.ts` — register club intents (BL)
- `services/poseDetection.ts` — analyzeSwingTentative + 30s→15s timeout (U1)
- `services/recapGenerator.ts` — practiceContext parameter (BR Component 9)
- `services/videoUpload.ts` — heuristic-fallback wiring + [upload:*] markers (U1 + BQ)
- `store/cageStore.ts` — ClubSegment + currentClub + clubSegments + setActiveClub + clubMenuOpen (BL)
- `store/settingsStore.ts` — cageAutoClubDetection persisted (BL)

Other:
- `.gitignore` — `.vercel` added by `vercel link` earlier
- `package.json` / `package-lock.json` — `@expo/ngrok` devDep added for tunnel

### Untracked files (36) — new code + docs

New code:
- `api/club-recognition.ts` (BL)
- `api/tutorial-analysis.ts` (BR)
- `app/swinglab/tutorial-upload.tsx` (BR)
- `app/swinglab/tutorials.tsx` (BR)
- `app/swinglab/tutorial/[id].tsx` (BR)
- `services/clubRecognition.ts` (BL)
- `services/intents/clubHandler.ts` (BL)
- `services/tutorialAnalysis.ts` (BR)
- `services/tutorialContext.ts` (BR)
- `services/uploadDiagnostic.ts` (BQ)
- `services/youtubeLinks.ts` (BM)
- `store/tutorialStore.ts` (BR)

New assets:
- `assets/avatars/serena-caddie-nod-001.png` (BN)
- `assets/avatars/serena-studio-portrait-001.png` (BN)

New docs (BS doesn't count its own):
- `docs/audits/v1-audit-2026-05-04.md` (BM v1.0 audit)
- `docs/character-asset-architecture.md` (U2)
- `docs/club-recognition-architecture.md` (BL)
- `docs/legacy-club-detection-capture.md` (BI)
- `docs/legacy-v2-inventory.md` (BI)
- `docs/legacy-v2-screenshots/README.md` (BI placeholder)
- `docs/migration-gap-analysis.md` (BI)
- `docs/privacy-policy.md` (BM)
- `docs/research-*.md` × 11 (BJ)
- `docs/tutorial-analysis-architecture.md` (BR)
- `docs/upload-pipeline-map.md` (BQ)
- `docs/v1-scope-final.md` (BM)

---

## Why nothing was committed

Per repeated user messaging through the session: "no commits without your explicit go", and the recurring "build correct so I can test final product" framing. I held back commits per standing rule "never push without explicit confirmation." Tim has not given explicit go on commit-and-push for any phase today.

**To actually ship today's work to a buildable state**, Tim needs to:
1. Authorize commit (per phase or as a single bundled commit — his call)
2. Authorize push to `origin/main` (separate go)
3. Trigger an EAS dev-client build that pulls the new HEAD

Until those three steps happen, today's session output exists only as local working-tree changes on this MacBook.

## Single most important next step

**Decide commit strategy.** Either:
- **One bundled commit** ("Phase BR/BL/BN/BM/BJ/BI/BQ/U1/U2 bundle — comprehensive update") — fastest, less granular history
- **Per-phase commits** in dependency order (BM → BJ → BI → U2 → BN → BL → BQ → U1 → BR) — cleaner history, ~5-10 minutes more work
- **Two-tier**: docs as one commit, code as one or more — splits review surface

Until commit happens, every other component of this audit assesses code that doesn't exist in any branch except local.
