# OTA runbook

## Something is broken in production. What do I do?

**1. Kill the feature. Seconds, no pipeline.**

```
vercel edge-config update smartplay-flags --patch '[{"operation":"update","key":"flags","value":{"<feature>":false, ...}}]'
```

Every player picks it up on their next app foreground. No rebuild, no store review, no OTA. This is
**always the first move** — it stops the bleeding while you work out what actually happened.

Flags: `smartvision`, `smartfinder`, `swinglab`, `cage_capture`, `voice_caddie`,
`kevin_tool_routing`, `lie_analysis`, `swing_analysis`. Per-course geometry can be disabled with
`course_geometry.disabled_course_ids`.

**Never killable, by design:** GPS yardages, round tracking, scorecard, bag, course book, history.
If one of those is broken, the switch cannot help you — go to step 3.

**2. Ship the fix as an OTA.** This is the follow-up, not the emergency response.

```
eas update --branch development --message "..."
eas update --branch production --message "..."
```

Both branches, always, unless you know exactly which build is on the device. A dev-client build
listens to `development`; a production-APK build listens to `production`.

**A kill switch only works on a build that HAS the switch code.** Tim hit this on 2026-09-06: the
flag flip did nothing until an `eas update` reached the phone, because the installed build predated
the flag store. Not a flag bug — the ordinary OTA rule.

**3. If the app crashes on launch, none of the above works.** The switch is read by code that never
runs, and a crashing app cannot download the OTA that would fix it. The only recourse is a store
build, and telling people to install it. This is why step 4 exists.

## The one automated gate

`.github/workflows/ota-guard.yml` fails any PR that touches native surface area:

- `ios/`, `android/`
- `app.json` / `app.config.*` — plugins, permissions, entitlements, bundle ids
- `eas.json` build profiles
- `package.json` **dependencies** (add / remove / version change — a version or script edit alone
  does not trip it, deliberately: a gate that cries wolf gets waved through)

There is **no override flag**. A native change is not "an OTA that needs care" — it is not an OTA.

## What is deliberately NOT built

Staged rollout (10% → 50% → 100%) with crash-rate auto-rollback was designed and parked on
2026-09-06. It decides using crash-free session rate over a **50-session floor**, and at pre-beta
traffic that floor is never reached — the watcher would neither ramp nor revert. It would idle and
look healthy, which is worse than not having it.

**Build it when there is real traffic to measure.** The design: publish at 10%, watch crash-free rate
against the last fully-rolled-out release, revert if more than 1 point below baseline over 50+
sessions, ramp at 60-minute intervals otherwise. Auto-rollback reverts; it never rolls forward.
