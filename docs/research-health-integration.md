# Research — Health Kit / Google Fit integration (Phase BJ Component 10)

**Capability:** Log SmartPlay rounds and practice sessions to the platform health database (Apple Health on iOS, Google Fit / Health Connect on Android). Step counts, heart rate samples (if Apple Watch / Wear OS connected), workout type "Golf."

**Verdict: QUEUE — low priority, low value before external beta**

## Technical reason

Health integration is mostly a one-way data export with limited user-facing benefit until SmartPlay has long-term users:

1. **Output-only utility** — writing a "Golf workout" entry into Apple Health or Google Fit doesn't change anything inside SmartPlay. The user sees the entry in the *Health* app, not SmartPlay. For the small population of users who actively look at Health for golf-context data (probably <10% of golfers), this is nice-to-have.
2. **Input has narrow value** — the *interesting* health data (heart rate during a tense putt, step count between holes for fitness tracking) requires a watch present. Without a watch, you're writing one entry per round and reading nothing. With a watch, you're back in [research-watch-imu.md](research-watch-imu.md) territory.
3. **Permissions overhead** — Health Kit + Google Fit both require explicit permission flows with OS-mandated language. Adds onboarding friction for marginal benefit pre-beta.
4. **Privacy footprint** — Health data is among the most regulated categories (HIPAA-adjacent, even when not technically covered). Adds policy / consent / audit overhead vs. SmartPlay's current minimal-data posture.

## Implementation paths

When this becomes worth doing:

- **iOS:** `react-native-health` (Apple Health Kit wrapper). Active, supports workout writing, heart rate read, step count. Supports React Native + Expo with config plugin.
- **Android:** Google **Health Connect** (the post-Google Fit unified health API as of mid-2024). `react-native-health-connect` is the active community wrapper. Requires Health Connect installed (preinstalled on Android 14+, app-store-installable on older).
- Effort estimate: 4-8 hours for "write workout entry on round end" both platforms; 8-16 hours for richer reads (HR samples per shot, etc.).

## What would have to change for BUILD TODAY

- An external beta tester explicitly requests this. (None do today; population of zero.)
- Apple Watch / Wear OS integration is already shipped. (It isn't — see Watch IMU research.)
- A growth-marketing reason emerges to want SmartPlay rounds visible in Apple Health (e.g., partnership with a fitness influencer where Health visibility matters).

None of the above hold today.

## Recommendation

**QUEUE** post-1.0 external beta. Revisit when:
1. The Watch IMU phase is greenlit (Health integration is a natural pair).
2. There's user feedback specifically asking for it.
3. SmartPlay has a story to tell about long-term player fitness, not just per-round caddie advice.

Trivially additive feature; trivially easy to defer. No urgency.
