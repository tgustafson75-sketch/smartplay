# SmartPlay Caddie — Field Manual

**Generated:** 2026-05-24 (end of pre-beta sprint)
**Bundle head:** `017e56b` — `feat(harness): scenario coverage for shipped-unverified items`
**Channel state:** preview OTA channel; v1.x runtime
**Scope:** comprehensive current-state reference. Read this and you understand SmartPlay Caddie's full shipped state without needing to dig through git, audits, or sprint logs.

This manual supersedes `docs/MASTER_COMPENDIUM.md` (dated 2026-05-17, pre-sprint) as the most recent state-of-the-app reference. Older compendia are kept for historical context.

---

## How to read this manual

The manual is split into seven section files, each self-contained and ~one screen long. Read top-to-bottom if you're new to the project; jump to a section if you know what you need.

| # | Section | When to read |
|---|---|---|
| 1 | [Product](01-product.md) | New to the project — vision, three pillars, persona system, how we win |
| 2 | [Architecture](02-architecture.md) | Touching the brain, voice, GPS, metrics, or capture pipelines |
| 3 | [Feature state](03-feature-state.md) | Need to know what works / what's stubbed / what's deferred |
| 4 | [Conventions & standing rules](04-conventions.md) | About to write code or land a commit |
| 5 | [File map](05-file-map.md) | Lost — where does X live |
| 6 | [Ship status](06-ship-status.md) | About to verify, bill, or submit; checking gap-closer status |
| 7 | [Known issues & roadmap](07-known-issues-roadmap.md) | Triaging a bug; deciding what's next; planning 1.x |

---

## Related references (older / narrower)

- [../MASTER_COMPENDIUM.md](../MASTER_COMPENDIUM.md) — 2026-05-17 snapshot (superseded by this manual but kept for diff context)
- [../../CLAUDE.md](../../CLAUDE.md) — project conventions (critical-path gates, locked elements, commit format)
- [../INDEX.md](../INDEX.md) — full docs navigation hub
- [../critical-paths.md](../critical-paths.md) — the four PATH 1–4 MIN VERIFY scenarios
- [../v1-scope-final.md](../v1-scope-final.md) — v1.1 scope contract
- [../v1.2-deferred.md](../v1.2-deferred.md) — items intentionally not in v1.1
- [../../SHIP-QA-AUDIT.md](../../SHIP-QA-AUDIT.md) — beta-prep bug catalog (0 P0, 2 P1 fixed, 9 P2)
- [../../PLATFORM-QA-AUDIT.md](../../PLATFORM-QA-AUDIT.md) — iOS + tablet + fold audit
- [../../BUILD-STATE-AUDIT.md](../../BUILD-STATE-AUDIT.md) — built / verified / left-for-1.0 / future
- [../../FEATURE-STATUS-AUDIT.md](../../FEATURE-STATUS-AUDIT.md) — smart play / TightLies / SmartMotion / SmartVision

---

## Regeneration

Update this manual after every multi-day sprint or any cluster of architectural / shipping changes. The split-by-section structure keeps individual updates cheap — refresh just the section that moved, leave the rest.

The in-app owner-tools surface (Settings → Owner Tools → Field Manual) opens this directory directly so it's reachable from device during pre-beta verification.
