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
| 2 | Live SmartMotion screen (app/swinglab/smartmotion.tsx) moved onto the engine stage by stage: segments/locate, verdict + per-swing reads, pose/biomech/pose-verdict, tempo, club arc, ball departure/path, feel. | **done 2026-10-04 (in-screen)** — one window finder (live Stop + review); pose decodes once (warm joined); the pose pass no longer re-runs on its own angle; ONE club-arc runner (saves swing 1); a named cloud fault always takes the headline and a late duff is locked; detail-screen club arc not restarted by play/pause and saved once found; review/recap players no longer use ExoPlayer repeat mode (130.7MB heap → OOM crash; now peak 68MB). Motion pass already shared the frame queue. Remount re-entry: the clipUri review route has no in-app caller (deep link only). Stages still run from effects, not engine stages — the engine port of the live screen is phase 3 with the deletions. |
| 3 | Delete what the engine replaced: five extra locate chains, the duplicate club-arc anchors, the dead `LIBRARY_AUTO_PROCESS` / watch-then-analyze code, the second clip copy. | **done 2026-10-04** — analyzeSwing's private locate now asks findUploadSwingWindow (device first; network only on the 'full' plan; abort reason kept; tight `core` window for the read's 9 frames; iOS short clips still located on-device). The only network-locate callers left: the finder and the upload impact-search (which needs an impact, not a window). One anchor rule for all four club-arc runners (clubPathWindow.clubArcAnchorMs / poseImpactFromFrames; the upload runner had none). Swing detail's on-open backfill, `?watch=1` autoplay/analyze and its 60s watchdog deleted — gated off by a constant, no caller passes watch=1, and each duplicated the Analyze run. The durable clip shares the raw clip's private copy (sharedClipCopy.aliasClipCopy). NOT done: the live screen's remaining effects are still effects, not engine stages — the in-screen ownership fixes (phase 2) removed the double runs and races they caused. |

Each phase ships only after `tsc`, jest, the sim and an emulator run on Tim's 6s and 14.5s clips pass.
