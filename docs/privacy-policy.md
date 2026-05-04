# SmartPlay Caddie — Privacy Policy

**Effective date:** [TO BE FILLED — date the policy is published at the public URL]
**Last updated:** 2026-05-04

> **Status: DRAFT for internal beta.** This policy is template-adapted to SmartPlay Caddie's actual data flow (audited 2026-05-04). It is sufficient for internal beta + a TestFlight/Play internal-track listing. **Before external beta or public launch, a privacy attorney must review and finalize.** Square brackets `[…]` mark fields that need to be filled before publication.

---

## 1. Who we are

SmartPlay Caddie ("the App", "we", "us") is a golf companion mobile application operated by [LEGAL ENTITY NAME — e.g., "SmartPlay Caddie LLC"], with a registered address at [LEGAL ADDRESS]. You can contact us at **support@smartplaycaddie.com** for any privacy-related question, request, or complaint.

This policy explains what personal data we collect, why we collect it, who we share it with, how long we keep it, and the rights you have over it.

## 2. Data we collect

We collect the categories of data below. We collect the minimum needed to make each feature work, and we tell you in the App when a feature is about to use a new category (e.g., the first time we ask for microphone access).

| Category | What | Why | When |
|---|---|---|---|
| **Profile data** | Name, golf handicap, home course, preferences | Personalize Kevin's caddie advice and surface your stats | You enter this during onboarding and in Settings |
| **Location (GPS)** | Coarse and precise device location while the App is open or in active-round background | Find courses near you, compute yardages to greens/hazards, detect hole transitions during a round | Only after you grant permission, only while the App or an active round needs it |
| **Audio (voice)** | Recordings of your spoken queries to Kevin (the in-app caddie voice assistant) | Transcribe your question and route it to a response | Only while a listening session is open (after you tap or earbud-trigger Kevin); recordings are not retained after transcription |
| **Audio (cage / swing)** | Microphone capture during practice cage sessions | Acoustic strike feel detection, ball-speed estimation | Only while a cage session is recording |
| **Video** | Camera capture during swing recordings, lie analysis (TightLie), and SmartFinder usage | Visual swing analysis, lie/turf analysis, on-course distance assistance | Only while you are actively in those features; videos save locally to your device unless you opt to upload |
| **Round data** | Shot-by-shot history, per-club statistics, scoring, hole-by-hole performance | Generate your scorecard, recap, and long-term trends | Created during rounds you start in the App |
| **Practice data** | Cage session results, swing analyses, drill recommendations | Track practice performance and pattern detection over time | Created when you use SwingLab / Cage Mode |
| **Device data** | Operating system, app version, device model, language, timezone | Diagnostic context for crash reports and feature compatibility | At app start and on crash |
| **Crash data** | Stack traces and breadcrumb logs (when the in-app crash reporter is enabled) | Debugging | Only when a crash occurs and only if the reporter is configured (currently disabled in beta) |

### What we do NOT collect

- We do **not** collect your contacts, calendar, photos library (beyond pictures you intentionally save from the App), SMS, or browsing history.
- We do **not** sell your personal information.
- We do **not** use your data to train third-party AI models. Your voice and video are sent to AI processors only to generate the immediate response you requested, and are not stored by them for training. (See "Third-party processors" below.)
- We do **not** use advertising trackers, third-party SDK ad-networks, or behavioral retargeting in the App.

## 3. Where the data lives

| Where | What's stored | How long |
|---|---|---|
| **On your device** | All profile data, round history, practice history, swing videos saved locally | Until you uninstall the App or clear app data; you can also delete specific items in-app |
| **Our backend (Vercel-hosted serverless API)** | Transient request/response state for AI features. **No persistent user records are stored on our backend today.** Logs may include redacted timing data and error messages | API request logs ≤ 30 days; no user content beyond the duration of the request |
| **Third-party processors (see §4)** | Your audio / video / text is sent to the relevant provider only for the duration of the request | Processor retention varies; see §4 |

**Important note for v1.0:** SmartPlay Caddie does **not** maintain a user account database. Your profile, rounds, and practice history are stored on your device only. Loss of your device or uninstalling the App will erase that data. Cloud sync is on the post-1.0 roadmap and will be opt-in.

## 4. Third-party processors (sub-processors)

We send data to the following providers solely to deliver the feature you requested. Each is bound by their own privacy and security commitments. Links go to the provider's policy.

| Provider | What we send | Purpose | Retention by provider |
|---|---|---|---|
| **Anthropic** ([privacy](https://www.anthropic.com/legal/privacy)) | Voice query transcripts, swing/lie context | Generate Kevin's caddie / coach / psychologist responses | Anthropic does not train on API data; logs retained ≤ 30 days |
| **OpenAI** ([privacy](https://openai.com/policies/privacy-policy/)) | Voice transcription audio, TTS text, hole-overhead images | Speech-to-text, text-to-speech, vision-based hole reads | OpenAI does not train on API data; logs retained ≤ 30 days |
| **ElevenLabs** ([privacy](https://elevenlabs.io/privacy)) | Synthesised speech text | Higher-quality Kevin / Serena voice synthesis | Per ElevenLabs API policy |
| **Mapbox** ([privacy](https://www.mapbox.com/legal/privacy)) | Hole bounding-box coordinates and zoom requests | Satellite imagery and static map tiles | Mapbox-side request logs |
| **golfcourseapi.com** | Course identifiers and queries | Course information, hole geometry, tee/green coordinates | Per golfcourseapi.com policy |
| **Vercel** ([privacy](https://vercel.com/legal/privacy-policy)) | Standard hosting telemetry (request IPs, user-agent) for our backend | Hosting / infrastructure | Per Vercel data processing terms |
| **Apple App Store** / **Google Play** | App distribution and (eventually) subscription billing | Distribution channel | Per Apple / Google privacy policies |

We do not currently use third-party analytics (PostHog, Amplitude, Segment, Mixpanel, Firebase Analytics) or third-party advertising networks. If we add any in the future, we will update this policy and notify you in-app.

## 5. Your rights

Depending on where you live, you may have the rights below. To exercise any of them, email **support@smartplaycaddie.com** with the subject line "Privacy request".

- **Access** — request a copy of your personal data.
- **Correction** — ask us to fix inaccurate data.
- **Deletion** — ask us to delete your personal data. Because most data lives on your device, you can also delete it directly by removing items in-app or uninstalling the App.
- **Portability** — request a machine-readable export of your round and practice data.
- **Objection / restriction** — object to certain processing or ask us to restrict it.
- **Withdrawal of consent** — where processing relies on your consent (e.g., microphone access), you can withdraw at any time in your device settings.
- **Complaint to a regulator** — you have the right to lodge a complaint with your local data-protection authority.

We respond within 30 days. We do not charge for reasonable requests.

### California residents (CCPA / CPRA)

You have the right to know, delete, correct, and opt out of the sale or sharing of personal information. **We do not sell your personal information** and do not "share" it for cross-context behavioral advertising. To exercise California-specific rights, email **support@smartplaycaddie.com**.

### EU / UK / EEA residents (GDPR / UK GDPR)

Our legal bases for processing are:
- **Performance of a contract** — running the App and providing the features you request.
- **Consent** — for permission-gated features (microphone, camera, location).
- **Legitimate interests** — diagnostics, security, product improvement, weighed against your privacy interests.

Where data is sent to processors outside the EEA / UK, transfers rely on the Standard Contractual Clauses or each provider's adequacy decision.

## 6. Children's privacy

SmartPlay Caddie is **not directed at children under 13** (or under 16 in jurisdictions that apply that age limit). We do not knowingly collect personal data from children. If you believe a child has provided personal data to us, contact **support@smartplaycaddie.com** and we will delete it.

## 7. Security

We use industry-standard transport encryption (HTTPS / TLS) for all communication between the App and our backend. Voice and video uploads are sent over encrypted channels. On-device data is protected by your device's operating-system-level security (PIN, passcode, biometrics). No system is perfectly secure; if you become aware of a vulnerability, please email **support@smartplaycaddie.com**.

## 8. Permissions on iOS and Android

The App requests the following device permissions, each with a specific human-readable reason shown in the OS prompt:

- **Microphone** — voice queries to Kevin and cage-session strike detection.
- **Camera** — swing recording, lie analysis, SmartFinder distance assistance.
- **Location (when in use)** — find courses, compute yardages, detect hole transitions.
- **Photos library** — save your hero-moment shots and round share-cards.
- **Bluetooth media-key access** (Android) — earbud tap-to-engage Kevin.

Denying any permission disables the corresponding feature but the rest of the App continues to work.

## 9. Changes to this policy

We may update this policy as the App evolves. When we make material changes, we will update the "Last updated" date at the top, post the new policy at the same URL, and (for material changes) notify you in-app. Continued use of the App after a material change constitutes acceptance of the updated policy.

## 10. Contact

For any privacy question, request, or complaint:

**Email:** support@smartplaycaddie.com
**Postal:** [LEGAL ENTITY NAME], [LEGAL ADDRESS]

---

### Implementation checklist (for Tim — remove this section before publishing)

Before publishing at `smartplaycaddie.com/privacy` (or wherever):

- [ ] Replace `[LEGAL ENTITY NAME]` and `[LEGAL ADDRESS]` with the registered entity for SmartPlay Caddie.
- [ ] Replace the `Effective date` placeholder with the date you publish.
- [ ] Verify the third-party processor list against your actual production env (any processor you add later requires a policy update).
- [ ] Confirm "no behavioral advertising" / "no analytics SDKs" claims are still true at publish time.
- [ ] If/when you add Sentry, PostHog, or any analytics, update §2 ("Crash data") and §4 (sub-processor table).
- [ ] If/when you add Stripe / RevenueCat for subscriptions, add a row to §4 and a paragraph to §5 about subscription/billing data.
- [ ] If/when you add cloud sync, rewrite §3 ("Where the data lives") — this policy currently states user data lives only on-device, which is true today.
- [ ] **Have a privacy attorney review** before external beta and any external press / store-listing visibility.
- [ ] Embed the URL into:
  - [ ] App.json/app config so iOS/Android consent surfaces can link to it
  - [ ] Onboarding (Permissions screen) — link below the permission rationale
  - [ ] Settings → About → Privacy Policy link
  - [ ] App Store Connect listing
  - [ ] Google Play Console listing
