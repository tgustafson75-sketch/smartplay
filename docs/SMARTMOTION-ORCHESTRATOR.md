# SmartMotion orchestrator — design of record

**Why (Tim, 2026-10-03):** "Is all of this being managed by an orchestrator?" — it was not. "With all we have
going on in SmartMotion, we need a very robust and smart orchestrator."

A stage map of 2026-10-04 found **19 analysis stages on the live SmartMotion screen and 8 on the
upload/library path**, started from effects, buttons and status changes across five files. Nothing owned the
order. The results were six copies of the swing locate, four club-arc runners with different impact anchors,
pose decoding the same frames twice, the cloud read and the on-device verdict racing for the headline, and a
6-second upload colliding with itself.

## The rules

1. **One run per clip window.** A run is keyed by session + shot + window. Asking again joins the run that is
   already going; nothing starts a second copy of a stage.
2. **Declared stages, declared dependencies.** Each stage names what it needs. The engine starts a stage only
   when those outputs exist, once, and stores what it returns.
3. **Critical first.** The read (what the player waits for) runs before any secondary stage starts a frame
   read. Secondary stages fill in afterwards and the screen shows each as it lands.
4. **Every stage has a budget.** A stage that overruns is cancelled and marked `failed: budget`. The run moves
   on, and nothing waits forever.
5. **Cancellation.** Leaving the screen or selecting another swing aborts that run's remaining work (an
   AbortSignal reaches every stage).
6. **One file per run.** Every frame read uses the run's pooled private copy (services/swing/sharedClipCopy).
   The raw recorder URI and the durable URI never both get copied.
7. **One report per failure.** A stage that fails reports itself once, with its reason, to the issue log.
8. **Observable.** services/swing/analysisPipeline keeps recording what ran. The engine is what decides it.

## Stage graph

```
window ──► read (CRITICAL) ──► pose ──► biomech ──► tempo
                  │              └────► clubArc
                  └──────────────────► ballDeparture ─► ballPath   (needs ballArea)
feel: on demand, after read
```

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Engine (services/swing/orchestrator) + the upload/library path: window → read → pose/biomech → club arc. All `runPhaseKOnSession` callers go through it. The swing screen's auto-analyze and per-shot backfill become engine requests. | **done 2026-10-04** — services/swing/orchestrator/{engine,uploadRun}.ts; emulator: both of Tim's clips, one read each, correct verdict |
| 2 | Live SmartMotion screen (app/swinglab/smartmotion.tsx) moved onto the engine stage by stage: segments/locate, verdict + per-swing reads, pose/biomech/pose-verdict, tempo, club arc, ball departure/path, feel. | **in progress** — 2026-10-04: live Stop and review (<15s) find the window through findUploadSwingWindow (no network after Stop); the pose warm and the review pass share one in-flight decode (emulator: 2 extractions → 1). Open: hazards 3–9 (setAngle re-run, club-arc ×2, verdict race, contact_read after save, remount re-entry, detail club arc on play/pause, motion window outside the frame queue). |
| 3 | Delete what the engine replaced: five extra locate chains, the duplicate club-arc anchors, the dead `LIBRARY_AUTO_PROCESS` / watch-then-analyze code, the second clip copy. | planned |

Each phase ships only after `tsc`, jest, the sim and an emulator run on Tim's 6s and 14.5s clips pass.
