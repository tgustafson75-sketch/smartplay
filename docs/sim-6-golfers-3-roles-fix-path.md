# Code Simulation — Six Golfers, Three Rounds, Fix-Path Scenario

A higher-fidelity scenario designed to find the shortest path to an **8.5/10 overall product score** for mixed-age, mixed-handicap groups using voice, tools, scoring, and coaching across three rounds. This is a **planning artifact**, not a runtime test.

Reference points:
- Voice behavior: [hooks/useVoiceCaddie.ts](../hooks/useVoiceCaddie.ts)
- Voice routing: [services/voiceCommandRouter.ts](../services/voiceCommandRouter.ts)
- Round state: [store/roundStore.ts](../store/roundStore.ts)
- Primary profile: [store/playerProfileStore.ts](../store/playerProfileStore.ts)
- Family / extra golfers: [store/familyStore.ts](../store/familyStore.ts)
- Play flow: [app/(tabs)/play.tsx](../app/(tabs)/play.tsx)
- Caddie flow: [app/(tabs)/caddie.tsx](../app/(tabs)/caddie.tsx)
- SwingLab / player library: [app/swinglab/coach-mode.tsx](../app/swinglab/coach-mode.tsx), [app/swinglab/player-library/[player_id].tsx](../app/swinglab/player-library/[player_id].tsx)

---

## Goal

Make the app feel strong enough that a mixed group of six golfers would rate it at or above **8.5/10 overall** after three rounds.

That means the app must feel:
- fast enough before the round starts,
- reliable enough that voice does not need retries,
- broad enough to handle different ages and skill levels,
- and structured enough that the group can share one device without confusion.

### Success thresholds

To treat this scenario as a real 8.5/10 candidate, all of the following should be true:

| Threshold | Green | Yellow | Red |
|---|---|---|---|
| Start-round friction | 1 clear action from Play or Caddie | 2 actions | 3+ actions or uncertainty |
| Voice first-try success | 90%+ for open-tool / round-start commands | 75-89% | below 75% |
| First response latency | feels immediate, no repeated prompt | brief pause but still acceptable | user repeats the command |
| Group clarity | golfers stay distinguishable throughout | occasional ambiguity | repeated confusion about who is being coached |
| Age-fit | younger/older golfers get noticeably different tone | mild tone differences only | one-size-fits-all output |
| Handicap-fit | advice feels tailored by skill level | some tailoring | generic advice dominates |
| Review value | each golfer gets a useful next step | some golfers get value | review is mostly stats without action |

---

## Scoring Model

The overall score should be weighted toward the things that actually determine whether a group keeps using the app.

| Metric | Weight | What it measures |
|---|---:|---|
| Group flow | 20% | Can six golfers move through the round without confusion? |
| Voice first-try success | 20% | Do tool-open and round-start commands fire on the first attempt? |
| Age-fit coaching | 15% | Do younger, older, and mixed-experience players get the right tone? |
| Handicap-fit coaching | 15% | Does advice scale from 6 hcp to 24 hcp without sounding generic? |
| Multi-golfer identity handling | 10% | Can the app keep golfers separated cleanly? |
| Game-improvement usefulness | 10% | Does the app actually help decisions, scoring, and practice? |
| Round continuity | 5% | Does the experience stay coherent across three rounds? |
| Learnability | 5% | Can a first-time group understand what to do? |

Target pass line for the product: **8.5/10 overall**.

---

## Why This Scenario Is Better

The previous 3-golfer scenario was too easy on the system.

This version forces the codebase to prove three things at once:
- it can support a **larger group size** than the default single-user flow,
- it can adjust tone and guidance across **age bands**, not just handicap bands,
- and it can do all of that while keeping voice and tools fast enough to avoid repeat attempts.

That is the real path to finding the next fix.

---

## Group Roster

Six golfers, chosen to create the widest realistic spread of needs.

| Golfer | Age | Handicap | Tech comfort | Voice dependence | Notes |
|---|---:|---:|---|---|---|
| Jordan | 68 | 22 | Low | High | Wants simple answers, hates menus, needs replayable voice cues |
| Maya | 54 | 16 | Medium | Medium | Steady golfer, likes score clarity and quick tool access |
| Leo | 41 | 8 | High | Medium | Wants tight shot advice and fast tool opening |
| Priya | 37 | 19 | Medium | High | Returning golfer, benefits from confidence-first coaching |
| Noah | 15 | 11 | High | High | Junior player, responds better to short, direct coaching |
| Elise | 29 | 14 | Medium | Medium | Balanced player, needs clean round flow and quick review |

### Group dynamics to simulate

- Six golfers are present for all three rounds.
- Two golfers are voice-first.
- One golfer is junior-aged and needs shorter, more encouraging language.
- One golfer is older and struggles with menu depth.
- Two golfers are single-digit to low-teens and want precise golf decisions.
- The group rotates who is actively asking Kevin questions, so the app must not assume only one person matters.

### Why these six golfers

This roster is intentionally chosen to stress the exact parts of the app that decide whether it feels group-ready:

- Two older golfers expose menu and wording friction.
- One junior exposes tone and brevity.
- Two low-to-mid handicaps expose whether coaching is specific enough.
- Two higher-handicap players expose whether the app stays encouraging and practical.
- The mixture of voice-heavy and tap-heavy golfers exposes whether the app can survive a shared-device round.

---

## Round Setup

### Round 1: Warm-up / first exposure

Purpose:
- Measure learnability and first-try success.
- See whether the app handles a large group without overexplaining.
- Establish whether tool-opening is instant enough to feel trustworthy.

Expected behavior:
- Start Round should work in one clear step.
- SmartVision, SmartFinder, score entry, and coach/help questions should feel discoverable.
- Voice commands like “open SmartFinder” and “start a round” should not require retries.

What to watch:
- How often the group asks “where do I do that?”
- Whether older or less technical golfers can find the right surface.
- Whether the junior golfer gets coaching that feels short and encouraging instead of verbose.

### Round 2: Mid-round pressure test

Purpose:
- Measure whether the system stays coherent once the group is in motion.
- Force the app to handle several different question types across mixed skill levels.

Expected behavior:
- Distance questions should return quickly.
- Shot logging should not require repeated prompts.
- Tool launches should stay stable when the round is already active.
- Coaching answers should differ by handicap and confidence level.

What to watch:
- Repeated voice attempts.
- Confusion around who the advice is for.
- Slower responses when the group switches between tools and live play.

### Round 3: Fatigue / trust test

Purpose:
- Measure whether the app still feels dependable when the group is tired and impatient.
- Confirm that the experience can survive without becoming noisy or repetitive.

Expected behavior:
- Voice should still hit first try.
- Review, recap, and practice follow-up should feel worth using.
- The app should help the group remember what mattered across the prior rounds.

What to watch:
- Whether the older golfer stops using voice because of friction.
- Whether the junior golfer gets lost in the flow.
- Whether the low-handicap players feel the advice is too generic.

---

## Scenario Script

### Pre-round commands

Run these voice requests in order before the first tee:
- “Open SmartFinder”
- “Start a round at Menifee Lakes”
- “Show me the course”
- “Open SmartVision”
- “Start quick round”

Success condition:
- Each one routes cleanly on the first attempt.
- No one has to repeat the command because the app was still thinking.

### In-round requests

Use a spread of commands that forces the app to adapt:
- “How far is it?”
- “What club should I hit?”
- “Open the library”
- “Mark that shot”
- “Coach Noah”
- “What should Priya work on?”
- “Open SmartMotion”
- “Start Cage Mode”
- “Show the scorecard”
- “What did I do wrong?”

Success condition:
- The app should route each request to the right tool or handler without needing extra clarification unless genuinely ambiguous.

### Post-round requests

Use these after each round:
- “What changed today?”
- “Show my best shots”
- “What should we work on next?”
- “Open Player Library for Noah”
- “Review Priya’s swings”
- “Start another round”

Success condition:
- The review flow should convert raw play into actionable improvement, not just a stats dump.

---

## Metrics To Move

These are the metrics that matter most for the fix path.

### 1. Group size handling

Current issue:
- The app is naturally optimized around one main golfer plus supporting context.

Target:
- Six golfers should feel like a normal use case, not a stretch case.

What must improve:
- Faster player switching.
- Clearer golfer identity in voice and review.
- Less reliance on a single active context.

Likely fix path:
- Add a clearer active-golfer selector for shared sessions.
- Make voice replies mention the golfer name when it matters.
- Reduce the number of places the group must memorize for the same action.

### 2. Age-fit

Current issue:
- The app has some tone control, but not enough explicit age-based variation in the live flow.

Target:
- Older golfers get simpler navigation and shorter voice responses.
- Juniors get concise, confidence-first prompts.
- Adults get more precise guidance.

What must improve:
- Tone selection should be explicit in the scenario.
- Voice length should scale by age and patience.

Likely fix path:
- Shorten responses for older and junior golfers.
- Keep the first sentence actionable.
- Save detail for follow-up, not the initial reply.

### 3. Handicap-fit

Current issue:
- Advice is good for one player, but it can feel too generic when the skill spread gets wide.

Target:
- Single-digit players get sharper, more tactical guidance.
- Mid-handicappers get practical decision help.
- High-handicappers get simple next-step advice.

### 4. First-try voice success

Current issue:
- The app has improved, but voice still needs to prove it can avoid repeats under pressure.

Target:
- “Open tool” and “start round” must land on the first attempt.
- No multi-try behavior before the round starts.

### 5. Identity clarity

Current issue:
- The app can blur which golfer is being coached when the group gets large.

Target:
- Every reply should feel clearly tied to the right person or the right round context.

Likely fix path:
- Ensure tool-open and round-start utterances never depend on a slower fallback when the intent is obvious.
- Make round context and golfer context explicit in the response payload where possible.
- Keep follow-up clarification rare and only for true ambiguity.

---

## Fix Mapping

Use this as the shortest path from a failing metric to the most likely code area.

| Failing metric | What it probably means | Where to fix first |
|---|---|---|
| Voice first-try success | Obvious commands are still going through the classifier path | [hooks/useVoiceCaddie.ts](../hooks/useVoiceCaddie.ts), [services/voiceCommandRouter.ts](../services/voiceCommandRouter.ts) |
| Group clarity | One active round / one profile is dominating shared use | [store/roundStore.ts](../store/roundStore.ts), [store/familyStore.ts](../store/familyStore.ts), [store/playerProfileStore.ts](../store/playerProfileStore.ts) |
| Age-fit | Responses are too long or too similar across golfers | [services/voiceCommandRouter.ts](../services/voiceCommandRouter.ts), handler response copy, persona/tone logic |
| Handicap-fit | Advice is generic and not scaled to skill | intent handlers, coach-mode reply copy, review surfaces |
| Review value | Post-round recap is not turning into actionable next steps | SwingLab review, player library, round summary, coaching routes |

---

## What An Ideal Pass Looks Like

If the scenario is working well enough to justify an 8.5/10 score, the group should be able to say:

- “We knew exactly how to start the round.”
- “Voice worked on the first try.”
- “The older players didn’t have to fight the app.”
- “The junior player got quick, encouraging coaching.”
- “The better players got specific enough advice to trust it.”
- “The app remembered who was who.”
- “The post-round review told each golfer what to do next.”

If those seven statements are true, the app is not just usable. It is group-ready.

---

## Fix-Path Hypothesis

If this scenario fails, the fix path should likely prioritize in this order:

1. **Voice fast-paths for tool-open and round-start commands**
   - These are the highest-value, lowest-tolerance actions.
2. **Better group identity handling**
   - The app needs a cleaner way to know which golfer is speaking or being coached.
3. **Tone scaling by age and handicap**
   - Responses should feel shorter and simpler for the younger and older ends of the group.
4. **Multi-golfer review surfaces**
   - The post-round path should make it easy to review each golfer separately.
5. **Less generic coaching copy**
   - The app should sound specific enough that each golfer feels seen.

### Recommended order of attack

If this scenario becomes the basis for the next sprint, the best sequence is:

1. Fix pre-round voice reliability for open-tool and start-round commands.
2. Add stronger golfer identity handling for shared-device use.
3. Compress and personalize voice tone by age and handicap.
4. Improve post-round review so every golfer gets a distinct takeaway.
5. Re-run the same six-golfer, three-round scenario and compare first-try success, confusion points, and perceived usefulness.

---

## What An 8.5/10 Looks Like

The app reaches 8.5/10 if this six-golfer, three-round group says all of the following are true:
- It was easy to start.
- Voice worked fast enough that nobody got annoyed.
- Each golfer felt like the app understood their level.
- Older golfers did not get overwhelmed.
- Younger golfers did not get bogged down.
- The review and practice loop gave them something useful to take home.

If those are true, the app is not just functional. It is genuinely group-ready.
