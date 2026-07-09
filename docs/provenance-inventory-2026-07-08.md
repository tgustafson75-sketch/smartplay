# SmartPlay Caddie — Provenance Inventory

**Generated:** 2026-07-08
**Purpose:** Objective, dated record of when each distinctive SmartPlay Caddie
concept, name, and system first appeared in this repository's git history.
Establishes prior art / origination dates. Every row is verifiable with
`git show <hash>` and `git log -S"<term>"`.

**Context:** A screen recording (an AI app-builder "Preview" of a golf app that
reproduces several of these concepts by name — notably "GolfFather", the Tank
persona, the 3:1/2:1 tempo-trainer split, and the Line/Angle/Ball/Tee swing
annotation + calibration system) surfaced on 2026-07-08. The dates below predate
that recording by ~2-3 months.

## First-appearance table (this repo)

| Concept / name | First commit date | Commit | Commit subject |
|---|---|---|---|
| SmartMotion (capture/analysis) | 2026-04-25 | 0cb7b109 | Fix Kevin centering on Z Fold folded state |
| Caddie personas (`caddiePersonality`, Serena) | 2026-04-25 | 0cb7b109 | (repo origin) |
| 3:1 tempo drill / SwingLab drill cards | 2026-04-25 | 0c2a9e3c | Day 9 — SwingLab tab, drill cards, silhouettes, cage/arena screens |
| `tempoRatio` (tempo metric) | 2026-04-26 | 43edda7d | Galaxy Watch integration — tempo, transition, club speed |
| **Tank** persona | 2026-04-29 | b5a818c2 | Phase 0: Tank in Kevin's world |
| Calibration (weather/plays-like lineage) | 2026-05-01 | 8a8bcf9f | Phase C: Weather and Wind Arrow |
| **GolfFather** + TightLie branding | 2026-05-03 | a9d60623 | Phase AS — TightLie branding + greeting |
| Harry persona | 2026-05-04 | c752adb0 | Phase BU — Cage Mode empirical state audit |
| Tempo Trainer (named drill) | 2026-05-13 | 919c90af | swinglab(5/5): Arena Practice Drills 3-card list |
| `ask_golf_father` ("Golf Father") tool | 2026-05-24 | ecf57d96 | feat: voice spine extensions … ask_golf_father |
| **VideoAnnotationOverlay** (coach annotation toolkit: Line/Angle/Circle/Ball/Tee) | 2026-05-25 | 97a20d82 | Batch 20: Fix AH — coach annotation toolkit |
| **SmartCapture** (name) | 2026-05-26 | 023f59be | Fix CK + SmartCapture rename — annotation gestures fire |
| SwingSim motion game | 2026-07-07 | 27db8974 | SwingSim motion-sim game spec |
| Hotel Mode / IndoorRepDetector | 2026-07-07 | 8b801d1f | HOTEL MODE: phone-in-hand tempo practice |

Repo's earliest commit: **2026-04-25** (`0cb7b109`). (Predecessor lines exist in
separate repos: SmartPlay-Caddie-V3, smartplay-vnext — not covered here.)

## The strongest tells (overlap with the 2026-07-08 recording)

1. **"GolfFather" / "Golf Father"** — reserved in this project's own `CLAUDE.md`
   as the deferred 1.x evolution concept; first in git 2026-05-03 (`a9d60623`),
   voice tool `ask_golf_father` 2026-05-24 (`ecf57d96`). A distinctive coined name,
   not a generic golf term.
2. **Tank persona** — 2026-04-29 (`b5a818c2`). The recording is explicitly a
   "Tank version."
3. **3:1 full-swing / 2:1 short-game tempo split** with the exact club-category
   grouping — the 3:1 drill taxonomy dates to repo origin (2026-04-25).
4. **Swing annotation + calibration rail** (Line / Angle / Horizon / Circle /
   Ball Ø / Tee + color set + Confirm Calibration) — `VideoAnnotationOverlay`
   2026-05-25 (`97a20d82`).
5. The recording runs on **the owner's own range footage**.

## How to verify any row

```
git show <hash>                 # the commit that introduced the term
git log --reverse -S"<term>" --date=short --format='%ad %h %s' | head -1
```

_This document is descriptive (dates + evidence), not a legal conclusion._
