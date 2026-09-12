# Owner 2.0 — The Fitting Session

**Raised by Tim, 2026-09-12**, the day per-club variant tracking shipped — because that feature
turned out to be the bottom half of something much bigger.

> "Add a card for me with Owner 2.0 for a range session with SmartMotion where I enter 1–3 different
> clubs for 10 shots then compare results… but we never considered grips and grip sizes. So like
> seeing maybe not universal truth but a what's working for me, and then maybe there is a
> quantifiable why."
>
> "That's real fitting session beta in theory."
>
> "Make sure that fitting session is robust and has all factors selectable."

**STATUS: SPEC ONLY. Not built.** The bottom half shipped 2026-09-12 (`clubVariantStore`,
`ShotResult.club_variant`, `services/clubVariantPerformance`).

---

## 1. Why this is bigger than a range drill

A real fitting costs money, needs an appointment, runs on someone else's launch monitor, and ends in
a recommendation from a person whose employer sells clubs. The player takes the club home and finds
out over six months whether it helped.

**The moat is not the measurement — it is the validation.** A fitting bay knows what a club did for
ten swings indoors. We know what it did over the next twenty *rounds*, because we are there for both.
A fitting that checks its own homework on the course is only possible for whoever owns the round.
No launch-monitor company can follow us there.

---

## 2. The factor taxonomy — everything selectable

A contender is a **spec**, not a club. Any field may differ; the ones that differ become the
comparison axis. All optional, all free-text or picker, none required.

### 2.1 Head
| Factor | Notes |
|---|---|
| Model / year | free text — "Qi10", "Burner 2" |
| Loft | stated loft, and actual if known |
| Face angle setting | open / square / closed, or the hosel setting |
| Lie angle | standard / upright / flat, degrees if known |
| Head weight | grams, or the weight-port setting |
| Bounce + grind | wedges only |

### 2.2 Shaft
| Factor | Notes |
|---|---|
| Model | free text |
| Flex | L / A / R / S / X, or a raw CPM |
| Weight | grams |
| Torque | degrees |
| Length | inches — **the factor most likely to move strike location** |
| Kick point | low / mid / high |
| Tip trim | free text |

### 2.3 Grip — the unmodelled one
Tim's aside is the most interesting thing in the ask. Nobody fits grips, they are cheap to change,
and they plausibly move exactly what our pose read is *good* at.

| Factor | Notes |
|---|---|
| Model | free text |
| **Size** | undersize / standard / midsize / jumbo |
| Build-up | number of wraps |
| Material | rubber / cord / hybrid / wrap |
| Taper | reduced-taper yes/no |

### 2.4 Ball
Already tracked (`currentBall`). A fitting session must pin it — **comparing two drivers with two
different balls compares nothing.** The session should refuse to start with an undeclared ball, or
record it as a known confound.

### 2.5 Setup and environment — recorded, not chosen
Not factors under test, but they are what makes a session comparable to itself, and a later session
comparable to this one.

Tee height · turf vs mat · indoor/outdoor · temperature · wind · altitude · time of day (fatigue) ·
camera angle (face-on vs down-the-line — the pose read is angle-aware and nulls what it cannot see
from behind) · warm-up completed yes/no.

---

## 3. What we can honestly measure, and what we cannot

This table is the spine of the feature. Everything above the line is real; everything below it is a
number a launch monitor gives and **we must never imply we have.**

### Measured
| Signal | Source |
|---|---|
| Carry vs total, per club | `clubStatsStore` — two ladders + roll model |
| Dispersion / direction | shot direction + outcome tagging |
| Trouble rate | penalty strokes + non-clean outcomes |
| Contact quality | acoustic contact + strike feel |
| Clubhead path through impact | `services/swing/clubPath` — measured points, with frame coverage |
| Tempo and transition | swing metrics |
| Hip / shoulder turn, tilt, sequencing | `SwingBiomechanics` |
| Lead-arm angle at top and impact | `leadArmTopDeg`, `leadArmImpactDeg` |
| Head drift, sway, weight shift | `headDriftPxNorm`, `swayNorm`, `weightShiftPct` |
| Finish quality | `finishWeightPct` |

### NOT measured — never imply otherwise
Ball speed · **spin rate** · **launch angle** · smash factor · spin axis · angle of attack in degrees
· face-to-path in degrees · strike location on the face (mm).

> A fitting that quietly implies spin numbers it never took is exactly the fake precision this app
> exists not to do. Where a factor's usual justification is a number we cannot take, say so: "I can't
> measure spin — what I *can* tell you is you're in trouble off it 40% of the time."

---

## 3b. Frame rate — the hard floor on everything above

**Tim, 2026-09-12: "Make sure we are prompting for 60fps minimum and accommodating for more when
possible, like a GoPro (original concept) for more precise data and feedback."**

This is not a nicety; it is the ceiling on how good any of §3 can be. A driver head travels roughly
100+ mph. At 30fps the head moves about **4–5 feet between frames**, so the clubhead path is a coarse
polyline through a handful of points and impact almost never lands on a sampled frame. At 60fps that
halves; at 120 it is a quarter; at 240 you are resolving the strike itself.

### What is already in the codebase
| Constant | Value | Where |
|---|---|---|
| `PREFERRED_CAPTURE_FPS` | 120 | `services/capture/captureFlags.ts` |
| `MIN_TRACE_FPS` | 60 | same — below this SmartTrace refuses to claim a flight direction |
| `DEFAULT_USE_VISION_CAMERA` | **false** | same — the high-fps engine is OFF by default |

So the 60fps floor Tim is asking for **is already specified**, and the engine that can hit it already
exists behind `SwingVisionCamera` (vision-camera, `useCameraFormat` degrading to device max).

**The live gap: the default capture path is expo-camera at ~30fps.** `recordAsync()` exposes no frame
rate. The vision path has been off since 2026-06-13 pending on-device validation, toggled by the
owner on the native-modules-debug screen. Until it is validated and flipped, every swing — including
every fitting session — is captured below `MIN_TRACE_FPS`.

### Requirements for the session
1. **Check the achievable fps before the session starts, and say it.** Not a silent degrade: "this
   phone gives me 60 — I can compare dispersion and path, not strike location."
2. **Refuse to claim what the frame rate cannot support.** The existing `MIN_TRACE_FPS` gate is the
   right pattern — extend it so each *metric* declares the fps it needs, rather than one global cut.
3. **Prompt for better.** If the device supports 120/240 and the session is set lower, say so. If the
   light is too poor for high fps (high-speed modes need it), say that instead of quietly dropping.
4. **Record the fps on every captured swing**, and refuse to compare two contenders captured at
   different rates without flagging it — that is a confound exactly like using two different balls.
5. **External camera — the original concept, and it was a whole bay.** Tim, 2026-09-12: *"in first
   gen I was going to put a GoPro on my cage and stream my phone to a big screen as my own cheap-ass
   bay."*

   That is the setup this feature should assume, not a phone propped on a bag. A fixed camera on a
   cage is **better** than a handheld phone in every way that matters here: identical framing across
   every contender (the single biggest confound in a comparison — move the camera between clubs and
   the pose angles shift), a locked distance and height, and a rate the phone cannot reach.

   None of the pipeline assumes the phone is the camera — SmartMotion already accepts uploaded
   video — so an external-source session is mostly an import flow plus fps metadata, not a new
   engine. Two things it does need:

   - **fps from the file.** We cannot read it today. `expo-av` gives `durationMillis` and no frame
     rate, and the frame extractor samples by TIME offset rather than by frame index. So a 240fps
     GoPro clip yields more distinct samples than a 30fps one, but the app cannot say which it got —
     and `MIN_TRACE_FPS` cannot honestly gate what it cannot measure.
   - **A fixed-rig mode.** Calibrate once — angle, distance, height — then every session reuses it,
     and the app can flag when the rig has moved rather than silently comparing two setups.

   The big screen is the other half of it, and it is a real product surface rather than a nicety: at
   a cage you are not holding the phone, so the session has to be readable across a room and drivable
   by voice. That is already how this app prefers to be used.

---

## 4. The session protocol

1. **Declare the contenders — 1 to 3.** Each is a spec from §2. The app names the axis that actually
   differs ("same head, same shaft, midsize vs standard grip") so the player knows what is being
   tested. If more than one factor differs, say so plainly: the result will be real but it will not
   isolate a cause.
2. **Pin the confounds.** Ball declared; environment recorded.
3. **Rotate, never block.** Shot-by-shot rotation, not ten in a row. **Ten in a row with one club
   measures how warm you got.** This is the single most important protocol decision here.
4. **10 shots each, minimum.** See §5 — ten resolves large gaps only, and the app must say so.
5. **Compare** using the shipped `compareClubVariants` rules: straighter beats longer, report "nothing
   in it" when it is, never invent a winner.
6. **Offer a why** only where a measurement backs it. "Your face is four degrees less closed at impact
   with the midsize grip" is a why. "Midsize grips reduce hand action" is marketing.
7. **Carry it to the course.** The winner becomes the declared variant. The next twenty rounds either
   confirm it or do not — and the app says which. **This step is the product.**

---

## 5. The statistics honesty problem

Ten shots is a small sample and shot-to-shot variance in golf is large. With n=10 per contender, only
**large** effects are resolvable; a 4-yard carry difference is indistinguishable from noise no matter
how confidently it is displayed.

The feature must therefore:
- state the resolution up front — "with 10 each I can see a big difference, not a small one";
- widen, not sharpen, as data thins;
- offer "hit 10 more with each" as the answer to an inconclusive result, rather than picking a winner;
- treat an outlier as an outlier (a topped one is a mishit, not evidence about the shaft) and say how
  many it set aside;
- **never rank three contenders 1-2-3 when only first-vs-last clears the noise.** Say "A and B are
  level, C is behind."

`MIN_SHOTS_PER_VARIANT = 12`, `MEANINGFUL_YARDS = 6`, `MEANINGFUL_TROUBLE_PCT = 8` in
`clubVariantPerformance` are the shipped expression of this and should govern the session too.

---

## 6. What it must never become

- A recommendation engine pointed at a shop.
- A universal claim. Tim set the line himself: *"maybe not universal truth but a what's working for
  me."* That framing is both the honest claim and the better product.
- A number-dense screen that looks like a launch monitor. The output is a sentence, then the numbers
  under it for anyone who wants them.

---

## 7. Build notes

No new measurement is required. This is orchestration of what exists:

- SmartMotion capture, with the existing rotation between clubs driven by the session.
- `clubVariantStore` for the declared spec — **needs extending from a single label string to the
  structured spec in §2**, keeping the current string as the display name.
- `clubVariantPerformance` for the comparison — already correct, already guarded.
- Pose + clubPath for the "why".
- Round history for the validation loop.

The work is the session flow, the spec editor, the rotation prompting and the honesty rails — not
new sensors.
