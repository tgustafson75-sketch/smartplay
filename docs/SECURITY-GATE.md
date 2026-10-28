# SmartPlay security gate: rule modes and when to flip them

`smartplay-gate` runs from the local checkout at `~/smartplay-gate`, **never** as a package.json dependency: its repo is private, so Vercel and EAS could not install it (that broke two deploys on 2026-10-27, fixed in e52b60c6). Config lives in `.smartplay-gate.json`. It runs on every `git push` via `.githooks/pre-push`, and on demand with `npm run gate`.

- **warn:** the rule prints its findings and the push continues.
- **block:** the rule stops the push when it has a finding.

Counts are from HEAD on 2026-10-27.

| Rule | Current mode | Flip to block when… |
|---|---|---|
| client-entitlement | **block** | Done. 0 findings since Critical #1 was fixed (56b3acc5: no email-based owner, no lifetime grant). |
| owner-bundle-env | **block** | Done. 0 findings. |
| client-vendor-calls | **block** | Done. 0 findings. The app never calls a paid AI or data vendor directly. |
| client-secrets | warn (1 finding) | The one finding is resolved: `services/appAuth.ts:27`, `EXPO_PUBLIC_MESSAGING_KEY`, the bundled shared messaging key. It is public by design (anyone can extract it from the app), and since 2026-10-27 the server also requires a participant email (`MESSAGING_ALLOWED_EMAILS`). Fix: replace it with per-user auth, or allow-list it in `.smartplay-gate.json` with that reason. Then flip. |
| unauth-endpoints | warn (54 findings, 9 allow-listed) | `ENFORCE_CALLER_IDENTITY = true` in `api/_callerIdentity.ts`. In the **same commit**, change `authHelper` from `"verifyCaller"` to `"allowInference"`, which every paid route awaits and which then enforces the caller check. Before that: set `REVENUECAT_SECRET_KEY` on Vercel, and wait until the app update that sends `x-rc-app-user-id` has reached players. |
| client-prompts | warn (3 findings) | Stays warn: the rule is a heuristic. The 3 findings are the Kevin/Serena/Harry character specs (`constants/*Character.ts`), which audit top-5 #3 plans to move server-side. |

**Not covered:** there is no GitHub Action yet. A push with `--no-verify`, from a machine without `~/smartplay-gate`, or from an EAS or Vercel build skips the gate. The hook prints `NOT RUN` when the gate is missing.
