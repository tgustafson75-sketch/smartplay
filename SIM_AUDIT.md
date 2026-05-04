# v2 Comprehensive Sim Audit
Date: 2026-05-03
Branch: fix/v2-wiring

## Verdict
FIX-FIRST — one BLOCKER (`services/roundAnalyzer.ts:34`) sends a relative `/api/analyze-round` URL that on a native EAS build resolves against the device, not v3, and will silently 404 every round; trivial fix but ship-blocking for the AI insight loop.

## v3 isolation
- ✅ No hardcoded prod URLs override `EXPO_PUBLIC_API_URL`. `utils/apiUrl.ts:33-44` reads env first, returns it. Only `__DEV__` + native + localhost env value falls through to LAN discovery — production env (`https://smartplay-beta.vercel.app`) is honored. (`.env:21`)
- ⚠️ Hardcoded `http://${ip}:8081` strings in `services/castService.js:26,42,47` and `services/goProBridge.js:16` (10.5.5.9) — both are LAN/local-only features, not v3 traffic. Acceptable.
- ⚠️ `app/_layout.tsx:34` configures NetInfo `reachabilityUrl: 'http://localhost:8082/'` — paired with `useNativeReachability:false` and `reachabilityShouldRun:()=>false` so it never fires (`app/_layout.tsx:31-40`). Acceptable, no Android IOException risk.
- ✅ EAS channels in `eas.json:10,20,30` = `development|preview|production`. Generic names but separate Expo project ID per app.config (`app.config.js:23` → `f81c2ac1-db52-4643-8828-481b27d2f376`); v3 lives in a different EAS project/slug, so channel name reuse is harmless.
- ✅ Bundle IDs (`app.json:12,27`) iOS=`com.smartplaycaddie.app`, Android=`com.tgustafson76.smartplaycaddiev2`. v3 ("smartplay") would not legally share. No store collision.
- ❌ Firebase project is **shared**: `lib/firebase.ts:6-12` projectId=`smartplaycaddie`. Every v2 write hits the same Firestore that v3 likely also targets. Writes:
  - `app/auth.tsx:82` setDoc(`users/{uid}`) — user profile bootstrap.
  - `app/PlayScreenClean.tsx:1145, 4392` addDoc(`users/{uid}/rounds`) — but this file is the legacy screen and not in the new tab tree (`app/(tabs)` deleted; new tree is `app/tabs/*`). Confirmed `app/tabs/caddie.tsx` end-round path (1707-1754) does NOT write to Firestore. Still, the screen is bundled and reachable via stale imports — see Should-fix.
  - `services/cloudSync.js:28,41,52` setDoc(`users/{uid}/...`) — only called from cloud-sync flow; namespaced under uid so no cross-user collision but shares schema with v3.
- ✅ Persisted schema: zustand persist key `round-store-v1` (`store/roundStore.ts:252`) lives in device AsyncStorage only — never sent to v3.
- ✅ Route conflicts: `app/api/*+api.ts` routes (17 of them) compile into the JS bundle but on a native EAS build there is no Expo Router server to host them, so they are dead weight only — never executed, no v3 collision risk.

### Every /api endpoint v2 calls
All resolved against `${getApiBaseUrl()}` which on EAS = `https://smartplay-beta.vercel.app`, except where noted. v3 must accept the same shape:

| Endpoint | Method | Caller | Body/Query | If 404 |
|---|---|---|---|---|
| `/api/golfcourse?action=search&q=` | GET | `services/golfCourseApi.js:38` | query | empty results, search shows "no matches" (graceful) |
| `/api/golfcourse?action=course&id=` | GET | `services/golfCourseApi.js:84` | query | falls back to direct GolfCourseAPI if `EXPO_PUBLIC_GOLF_COURSE_API_KEY` set, else null |
| `/api/caddie` | POST | `services/aiCoach.ts:129` | `{prompt, coachingStyle}` | offline cue fallback (line 145-161) ✅ |
| `/api/brain` | POST | `services/caddieBrain.js:338`, `services/swingVisionService.ts:152`, `services/IntelligenceEngine.js:428` | varies | catch-blocks return defaults |
| `/api/vision` | POST | `app/tabs/caddie.tsx:1236`, `app/hole-view.tsx:521`, `components/HolePhotoCapture.tsx:115`, `services/cageVision.js:67,109,149` | multipart frame | catch returns null analysis |
| `/api/weather?lat=&lon=` | GET | `services/weatherService.js:48` | query | null weather |
| `/api/cage-caddie` | POST | `app/cage/session.tsx:180,463`, `app/cage/summary.tsx:134,181` | shot context | offline coaching falls back |
| `/api/scan-club` | POST | `components/ClubScannerModal.tsx:86` | image | scan fails gracefully |
| `/api/videos` | GET | `services/contentSearch.js:119` | query | YouTube fallback |
| `/api/analyze-round` | POST | `services/roundAnalyzer.ts:34` | `{shots}` | **silent 404** — see Blockers |

Voice TTS goes **direct** to `https://api.elevenlabs.io` (`services/voiceService.js:165`) — not v3-dependent. STT not in current voice path (no `/api/transcribe` callers; legacy file in `inspect_archive/`).

## 10-round simulation results
1. ✅ Cold launch — `app/_layout.tsx:31-40` neutralises NetInfo probe (no IOException). `lib/firebase.ts:20-24` try/catch around initializeAuth (won't crash on AsyncStorage). `app/_layout.tsx:90-92` calls `setGlobalGender` before any speech can fire (mounts before tabs).
2. ⚠️ Search course — `services/golfCourseApi.js:38` shape matches `app/api/golfcourse+api.ts:43-51`. v3's deployed route must serve the same `?action=search&q=` query string and return `{courses:[…]}`. If shape drifted on v3, v2 reads `data?.courses ?? []` (line 42) — empty list = "no results", graceful.
3. ✅ Start Round — Play tab calls `clearRound() → setIsRoundActive(true) → setCurrentHole(1) → router.replace('/tabs/caddie')` (typical Play tab pattern; `app/tabs/_layout.tsx:76-82` only redirects on false→true transition). The Caddie redirect-to-Play in `app/tabs/caddie.tsx:355-359` fires only if `isRoundActive===false`; since the store is set true before navigation, no flap.
4. ✅ Caddie tab — `app/tabs/caddie.tsx:449-455` calls `unifiedGPS.retry()` on round-active rising edge. Tools strip + steppers + SmartFinder all wired (verified imports lines 24, 70-83). No file:line problems found.
5. ✅ Mic — `setGlobalGender` runs at boot (`app/_layout.tsx:91`). Voice path is direct ElevenLabs (`services/voiceService.js:165`) — no v3 dep.
6. ✅ Shot Card "Good" — `addShot` (`store/roundStore.ts:154`) stores last 250 shots with all GPS fields; gridScores via `setCourseHoleScore:203-217` updates both grid and `courseScores` snapshot.
7. ✅ Hole progression — `useUnifiedGPS` + `useHoleProgression` imported (`app/tabs/caddie.tsx:68,74`); `setCurrentHole` writes to round store (`store/roundStore.ts:146`).
8. ⚠️ End round — `handleEndRound` (`app/tabs/caddie.tsx:1707-1754`) defers `setIsRoundActive(false)` to the modal's `pendingNavRef` callback, which dodges the tabs/_layout redirect race. ✅ Modal flow correct. ❌ `analyzeRoundInBackground` 404s (see Blockers) — but it's fire-and-forget so UX still works; only AI insight loop fails.
9. ✅ Round 2 reset — `clearRound` (`store/roundStore.ts:181-192`) wipes shots, scores, gridScores, holePutts, penaltyLog, currentHole/Par. **`courseScores` intentionally preserved** (per comment lines 174-180). Confirmed.
10. ✅ Gender toggle — `setGlobalGender` is called from settings; `app/tabs/caddie.tsx:430` re-fires hole-change effects on `voiceGender` change. ElevenLabs voice ID resolved per call inside `services/voice` (`speakJob` accepts gender). No race because the global is read at speak-time, not cached at hook-level.

## Blockers
- [ ] `services/roundAnalyzer.ts:34` — `fetch('/api/analyze-round', …)` is a path-only URL. On native (EAS APK/IPA) `fetch` requires absolute URL; this throws/network-errors and is silently swallowed by the catch on line 59. v3's `/api/analyze-round` is never reached, the AI miss-bias profile never updates between rounds. Fix: import `getApiBaseUrl` and use `` `${getApiBaseUrl()}/api/analyze-round` ``. One-line fix, zero v3 impact.

## Should-fix-before-push
- [ ] `app/PlayScreenClean.tsx` — legacy screen still in repo (`app/PlayScreenClean.tsx:40,1145,4392`) imports Firestore and writes `users/{uid}/rounds`. New tab tree (`app/tabs/*`) replaces it, but the file is still bundled and any stale `<Link href="/PlayScreenClean">` or deep link would surface a duplicate write path against the shared `smartplaycaddie` Firestore. Verify no router entry references it, or move to `__trash/`.
- [ ] `app/tabs/caddie.tsx:1235` — fallback URL `http://${fallbackHost}:${fallbackPort}/api/vision` builds an LAN URL after the primary Vercel call. On a real EAS device with no Metro running this will fail fast (negligible cost) but the code path is dev-only — wrap in `if (__DEV__)`.
- [ ] `services/cloudSync.js:28,41,52` — three `setDoc` writes share Firestore schema with v3. Confirm v3's Firestore Security Rules accept v2's document shapes (`firestore.rules` exists in repo root — diff against v3's deployed rules).
- [ ] `services/contentSearch.js:119` references `/api/videos` — v3 must implement this endpoint or YouTube Data API fallback path triggers. Verify v3 deployment.

## Acceptable-as-is
- 17 `app/api/*+api.ts` route files bundle into JS; ~unused but inert on EAS. Not worth a delete this close to push.
- `services/castService.js` LAN-only `http://ip:8081/api/cast` — phone-to-TV cast feature, no v3 traffic.
- `services/goProBridge.js` `http://10.5.5.9` GoPro local IP — fine.
- `inspect_archive/**` — old copy of repo, not bundled (no `app/(tabs)` import path resolves there).
- All `/api/*` callers have try/catch with offline fallbacks except `analyze-round`, which silently no-ops (graceful but blocker for AI loop).

## Confirmed working from this session
- Voice gender persists from settings → `setGlobalGender` runs at boot (`app/_layout.tsx:90-92`).
- `clearRound` correctly preserves `courseScores`, wipes everything else (`store/roundStore.ts:181-192`).
- End-round modal sequencing avoids the tabs/_layout redirect race (`app/tabs/caddie.tsx:1734-1746`).
- NetInfo Android probe is fully neutralised (`app/_layout.tsx:31-40`).
- Firebase Auth init is wrapped in try/catch (`lib/firebase.ts:20-24`).
- `getApiBaseUrl` honours `EXPO_PUBLIC_API_URL=https://smartplay-beta.vercel.app` for production EAS builds (`utils/apiUrl.ts:33-44`).
- EAS channel `preview` is project-scoped and won't collide with v3's separate Expo project.
- Round 1→Round 2 state reset is clean (zustand persist `round-store-v1`).
