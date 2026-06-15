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

### Unassigned (confirm which manual page)
- ✅ **FIXED (test-enabling, OTA'd 2026-06-15) — Tap-to-talk on Ray-Ban Meta glasses cold-start delay.** First tap engaged the mic but the first response was delayed / read as "no connection"; after ~20s it warmed and every tap worked. Cause: the voice Lambdas re-cool after ~15 min idle, and the existing warms only fire on caddie-tab mount + app-foreground — not on "sat idle on the tab, then tapped." Fix: `handleMicPress` now fires `prewarmVoice()` the instant a capture STARTS, so the cold-start overlaps the seconds you're speaking. (hooks/useVoiceCaddie.ts)

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

- **Detect glasses/Bluetooth connect → pre-warm + "voice mode" (NATIVE BUILD).** Tim: the Meta glasses send a BT connection signal when opened — capture it to know we're in glasses mode. Value: connection = imminent voice use = the perfect pre-warm trigger (and a real mode flag). NOT possible via OTA: expo-av exposes no granular route-change events (audioRoutingService is a best-effort stub, route stays 'unknown'); honest capture needs a custom native module (iOS AVAudioSession.routeChangeNotification / Android BT-profile listener — a "BT audio connected" proxy) OR the Meta Wearables SDK (the actual glasses; currently no-op'd, needs the GITHUB_TOKEN native build). When we do the next native build: BT-route listener → fire prewarmVoice() + set a glasses/voice-mode flag. Interim cold-start already mitigated by the warm-on-capture-start fix (16f7f1a).

---

## Carry-ins (already known, fold into the post-window triage)
- 🟠 **Two readings per swing-library upload** — `cageStore.setShotAnalysis` flips `analysis_status:'ok'` early on multi-swing parallel batches (shows a stale read while later swings finish). The flip is load-bearing for per-shot-only paths, so it needs careful flow analysis — a screenshot of the two readings will pin it. (audit 2026-06-15)
- 🟡 Skeleton lag = sparse pose sampling (5 frames); decide frames-vs-speed after the daytime/60fps data.
- 🟡 Shot-shape roll/check (needs landing+rollout frames); hardware experiments (colored sleeve+glove, pie-tin center calibration).
