# Phase 410B — Real authentication (Supabase + Google Sign-In)

**Date opened:** 2026-05-16
**Decisions (locked):**
- Auth UX: **required login at first launch** — must sign in to reach Caddie tab
- Provider: **Supabase** (Postgres + Auth + RLS)
- Sign-in method: **Google one-tap only** (no password, no magic link, Apple deferred to App Store ship)

## Scope of THIS phase

Phase 410B delivers a working Google-auth gate. It does **not** include round/shot/swing-history sync — that's Phase 410C.

In scope:
- Auth gate at first launch (no session → `/auth`)
- "Continue with Google" native one-tap UI
- Persisted session (survives app restart) via expo-secure-store
- Real `signOut()` in Settings (revokes Supabase + Google) and Sign Out + Reset App Data as separate options
- Server-side `profiles` table (id pk, first_name, handicap, caddie_persona, created_at, updated_at)
- Bidirectional profile sync (local Zustand ↔ Supabase row) so signing in on a second device restores name/handicap/caddie
- Migration: existing testers who already filled welcome get their local profile pushed up on first sign-in

Out of scope (Phase 410C):
- Round/shot/SwingLab history sync
- Conflict resolution beyond last-write-wins on profile-only fields
- Sign in with Apple (required only when shipping to iOS App Store)
- Account deletion + GDPR export flows

## Code scaffolded (already written)

| File | Purpose |
| --- | --- |
| `lib/supabase.ts` | Supabase client singleton with SecureStore session adapter; safe-fail when env vars missing |
| `lib/googleAuth.ts` | GoogleSignin config + `signInWithGoogle()` wrapper returning typed results |
| `store/authStore.ts` | Zustand wrapper around supabase.auth: session/user, init(), signInWithGoogleAndSupabase(), signOut(), onAuthStateChange subscription |
| `services/profileSync.ts` | Bidirectional profile sync — fetch on SIGNED_IN, debounced push on local edits, migration path |
| `app/auth.tsx` | "Continue with Google" sign-in screen (replaces stub) |
| `app/_layout.tsx` | Adds configureGoogleSignIn() + useAuthStore.init() + profile-sync subscription at boot |
| `app/index.tsx` | Auth gate: no session → `/auth`; existing intro/permissions/welcome/greeting chain runs after sign-in |
| `app/settings.tsx` | New "Sign Out" row + Reset App Data also revokes session |
| `app.json` | Config plugins for `@react-native-google-signin/google-signin` + `expo-secure-store` auto-added |
| `.env.local` | Placeholders appended for `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |

TS check after scaffold: 0 errors.

## What I cannot do — needs Tim

### A) Supabase project setup (~10 min)

You're already in the dashboard. Do these:

1. **New project**
   - Name: `smartplay-caddie`
   - Region: US West (closest to California testers)
   - DB password: save in your password manager (you won't see it again)
   - Wait ~2 min for provisioning

2. **`profiles` table** — paste this into SQL Editor and run once:

   ```sql
   create table public.profiles (
     id uuid primary key references auth.users(id) on delete cascade,
     first_name text,
     handicap numeric(4,1),
     caddie_persona text check (caddie_persona in ('kevin','tank','serena','harry')),
     created_at timestamptz default now() not null,
     updated_at timestamptz default now() not null
   );

   alter table public.profiles enable row level security;

   create policy "Users can read own profile"
     on public.profiles for select using (auth.uid() = id);

   create policy "Users can upsert own profile"
     on public.profiles for insert with check (auth.uid() = id);

   create policy "Users can update own profile"
     on public.profiles for update using (auth.uid() = id);

   create or replace function public.handle_new_user()
   returns trigger language plpgsql security definer as $$
   begin
     insert into public.profiles (id) values (new.id);
     return new;
   end;
   $$;

   create trigger on_auth_user_created
     after insert on auth.users
     for each row execute function public.handle_new_user();
   ```

3. **Grab keys** — Settings → API. You'll paste these into `.env.local`:
   - Project URL (looks like `https://xxxxx.supabase.co`)
   - **anon / public** key (safe to ship in client bundle)
   - Do NOT touch the `service_role` key. Never paste it anywhere.

### B) Google Cloud Console (~25 min, the slowest piece)

1. https://console.cloud.google.com — create a new project (`smartplay-caddie`) or pick an existing one
2. APIs & Services → Library → enable **Google Sign-In API**
3. APIs & Services → OAuth consent screen
   - User type: **External**
   - App name: SmartPlay Caddie
   - Support email: yours
   - Scopes: add `email` + `profile` (defaults)
   - Test users: add your own Gmail + any early tester emails (you can add up to 100 — bypass the verification process until launch)
4. APIs & Services → Credentials → **Create Credentials → OAuth Client ID** — do this **twice**, once per type:

   **Web application client** (Supabase uses this to verify ID tokens):
   - Name: `SmartPlay Caddie — Web`
   - Authorized redirect URIs: paste your Supabase callback (you'll see it once Supabase is set up): `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - After creating: copy the **Client ID** and **Client secret**

   **Android client** (for the native one-tap sheet):
   - Name: `SmartPlay Caddie — Android`
   - Package name: `com.smartplaycaddie.app` (matches `app.json` android.package)
   - SHA-1 certificate fingerprint: I'll give you the exact command for this in step C below; come back to fill this in after you run it
   - After creating: copy the **Client ID** (no secret for Android clients)

   **iOS client**: skip for now (Android-only beta)

### C) SHA-1 fingerprint for the Android OAuth client

Run this in a terminal in `/Users/timothyg/Documents/smartplay`:

```bash
npx eas credentials --platform android
```

When prompted:
- Build profile: `preview`
- Action: `Keystore: Manage everything needed to build your project` → `Download credentials`

The keystore SHA-1 will print in the output. Copy it (looks like `AA:BB:CC:...` — 20 hex pairs separated by colons). Paste it into the Android OAuth client's "SHA-1 certificate fingerprints" field in Google Cloud Console.

If you have **both** a `preview` and a `production` build profile, do this for **both** keystores (Google needs every keystore's SHA-1 registered).

### D) Wire Google → Supabase

Back in Supabase dashboard:

1. Authentication → Providers → **Google** → enable
2. Paste:
   - **Client ID (for OAuth)**: the **Web** client ID from step B
   - **Client Secret (for OAuth)**: the **Web** client secret from step B
3. Save

### E) Send me the values

Paste these in chat — I'll fill them into `.env.local` and we ship:

- Supabase Project URL
- Supabase anon key
- Google **Web** client ID (NOT the Android one — Android is auto-matched via SHA-1 at runtime)

That's it from your side. About 35-40 min total.

## What happens after you send me the values

I'll:
1. Fill in `.env.local`
2. Verify TS + lint + doctor still clean
3. Commit the Phase 410B scaffold + config
4. Trigger a fresh EAS preview build (the Google sign-in native module requires a new binary — OTA alone won't work for this one)
5. You install the new build, tap "Continue with Google", and we verify the end-to-end flow

## Migration plan for existing testers

The current testers have local Zustand profile data. When 410B ships:
- First launch on the new build → `/auth`
- Tap Continue with Google → pick account
- `profileSync.hydrateProfileFromServer()` detects: server row is empty + local has data → pushes local up
- Subsequent launches: local + server stay in sync

No data loss. No second welcome screen.

## Definition of done (Phase 410B)

- [ ] Fresh install: open → `/auth` → tap Google → pick account → `/welcome` (if no profile) or `/(tabs)/caddie` (if profile restored)
- [ ] Sign Out: Settings → Sign Out → session revoked → `/auth`
- [ ] Multi-device: sign in on second device with same Google → name, caddie, handicap restored
- [ ] Existing tester migration: local profile lands in Supabase on first sign-in
- [ ] TS + lint + doctor all green (TS already verified after scaffold)
- [ ] Beta tester instructions: "tap Continue with Google to sign in"
