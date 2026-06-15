# Post-Test Log

**Window:** test pass against a stable build (started 2026-06-15). **No new builds/OTAs during the window** — this log captures everything; we batch the work after.

How this is used:
- **FIXES** — feedback on each test-manual item, tied to the page/tool it came from. Captured in Tim's words + severity. Nothing is built during the window.
- **NEW IDEAS (parked)** — any new idea (Tim's or mine) lands here, not in a build.

Severity key: 🔴 blocker · 🟠 broken/wrong · 🟡 polish/nit · 🔵 question

---

## FIXES — by test-manual page/tool

> Filled in as Tim works the 7 pages of `docs/TEST-MANUAL.md`. One bullet per finding:
> `- [severity] <tool/item> — <symptom in Tim's words> (manual pg N)`

### Page 1 —
- _(none yet)_

### Page 2 —
- _(none yet)_

### Page 3 —
- _(none yet)_

### Page 4 —
- _(none yet)_

### Page 5 —
- _(none yet)_

### Page 6 —
- _(none yet)_

### Page 7 —
- _(none yet)_

---

## NEW IDEAS (parked — build after the window)

- _(none yet)_

---

## Carry-ins (already known, fold into the post-window triage)
- 🟠 **Two readings per swing-library upload** — `cageStore.setShotAnalysis` flips `analysis_status:'ok'` early on multi-swing parallel batches (shows a stale read while later swings finish). The flip is load-bearing for per-shot-only paths, so it needs careful flow analysis — a screenshot of the two readings will pin it. (audit 2026-06-15)
- 🟡 Skeleton lag = sparse pose sampling (5 frames); decide frames-vs-speed after the daytime/60fps data.
- 🟡 Shot-shape roll/check (needs landing+rollout frames); hardware experiments (colored sleeve+glove, pie-tin center calibration).
