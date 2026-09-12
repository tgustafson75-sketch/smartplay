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

### Gated BY FACTOR, with the lever shown

**Tim, 2026-09-12: *"We revised from drop to adjust gates by factor and show confidence level. Now we
can show real factors the user could change to affect the confidence level."***

The rule has moved in three steps and this session's spec must reflect the third:

1. **Drop** what a phone cannot measure (2026-06-07). Why the app never shipped a fake spin number.
2. **Do not null a metric for being less certain** (2026-09-02) — grade per element, show confidence
   and a range. Blank is not more honest than an estimate, just less useful.
3. **Show the factors** (now). A confidence level the player cannot act on is a verdict. The same
   number with *"at 30fps I can't see the start line — record at 60 and I can"* is a lever.

So a fitting session does not present a metric as present-or-absent. It presents it with its
confidence and the **specific things this player could change** to raise it:

| Factor they can change | What it raises |
|---|---|
| Frame rate (60 → 120 → 240) | start direction, club path through impact |
| Camera angle (face-on vs down-the-line) | the pose read nulls what it cannot see from behind |
| A fixed rig instead of a propped phone | comparability between contenders — the biggest confound |
| More shots per contender | every comparison; the noise floor falls with n |
| Lighting | high-speed formats need it; poor light silently degrades fps |
| Declaring the ball | removes a confound from a club comparison |

`services/captureQuality` is the first shipped instance of this — what I can still read, what I
cannot and why, and the concrete fix — and the pattern generalises to every gated metric here.

### Still never shown, at any confidence

The revision above is about metrics we can PARTIALLY see. It does not license inventing ones we
cannot see at all.


**spin rate** · **spin axis** · smash factor · face-to-path in degrees · angle of attack in degrees ·
strike location on the face (mm).

Spin is the hard one and the reason a radar still exists: reading it optically needs a marked ball
and a high-speed close-up of the first inches of flight, which is a different rig from this one.
Smash factor is club speed ÷ ball speed, so it inherits both error bars and becomes a number too
loose to act on.

**Moved OUT of this list on 2026-09-12:** *ball speed* (measurable across a known 15-foot section at
120fps+, see above) and *launch angle* (measurable from a calibrated side-on rig at high fps, coarse,
and only with the calibration). Both belong in the gated-by-factor column with their confidence
shown — that is the whole point of the revision.

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

   - **A fixed-rig mode.** Calibrate once — angle, distance, height — then every session reuses it,
     and the app can flag when the rig has moved rather than silently comparing two setups.
   - **fps from the file.** We cannot read it today: `expo-av` gives `durationMillis` and no frame
     rate. This is a smaller problem than it first looks — see §3c.

---

## 3c. Two sources, and the audio is the clock

**Tim, 2026-09-12:** *"GoPro exports don't get timestamped, but the original premise was based on
known target reconciled with acoustic confirmation and strike quality, known distance, clip length,
swing time, time in each phase, etc. to derive a poor man's TrackMan."* — *"with a swing bay in my
back yard, off Temu."* And: *"GoPro
would come in as the SECOND video source file to analyze, in addition to the phone camera stream."*

This corrects an assumption I had written into §3b. I had treated "we cannot read fps from the file"
as a blocker for external cameras. **It mostly is not, and the codebase already proves it.**

### The clock is the strike, not the frame rate

`services/swing/ballDeparture` already works this way: it takes the **acoustic impact time**
(`impactMs`) and samples `frameAt(uri, impactMs ± PRE/POST_MS)` — by TIME, not by frame index. The
microphone is a far better clock than the video track, and the strike is an unmistakable transient in
it. So swing time, time in each phase, and the launch window are all anchored in **real milliseconds**
regardless of what the video was shot at.

Frame rate therefore limits only one thing: how much the ball and club MOVED between the frames
either side of a sampled moment. It is a spatial resolution limit, not a timing one. That is worth
being precise about, because it is the difference between "we cannot use a GoPro" and "a GoPro makes
the spatial half sharper while the timing half is already solid."

And fps is **derivable** when it matters — clip length is known, so sampling across a known interval
and counting distinct frames bounds it. A measured bound is all `MIN_TRACE_FPS` needs.

### How two sources reconcile

| Source | Contributes |
|---|---|
| **Phone** | the acoustic track (the clock and the strike-quality read), one angle, live capture |
| **GoPro** | the fixed high-fps angle — the spatial detail the phone cannot reach |

They are synchronised on the **same strike**. Both clips contain the impact; aligning their transients
is the oldest trick in film and needs no timestamps, no clock sync and no metadata. Everything
downstream already speaks in ms-from-impact, so a second source drops into the existing coordinate
system rather than needing a new one.

### "Poor man's TrackMan" — what that can honestly mean

The target setup is a **net in a back garden, bought off Temu**, a GoPro on the frame and a phone.
Naming TrackMan sets the bar deliberately high, so it is worth being exact about which parts of that
bar we clear, which we do not, and which we clear that TrackMan does not.

| | TrackMan | This |
|---|---|---|
| Start direction / face-to-path tendency | degrees, radar | **direction and dispersion, measured** |
| Strike quality | smash factor | **acoustic strike read** |
| Tempo, phase timings | — | **measured, ms-anchored to impact** |
| Body: turn, tilt, sequencing, sway, extension | **not measured at all** | **measured** |
| Carry distance | measured | **inferred — see below** |
| Ball speed, spin, launch angle, spin axis | measured | **never. Radar or nothing.** |

### The net problem — and how much flight 15 feet actually is

**Tim, 2026-09-12: *"BUT with my 10 foot netter cage I am about 15 feet from the target."***

That correction matters, and it moves a metric off the never-list. I had written "about four feet",
which would have been a golfer standing almost on the net. Fifteen feet of observable flight, at a
ball speed around 150 mph (220 ft/s), is **68 milliseconds** — and how much that is worth depends
entirely on frame rate:

| fps | frames over 15 ft | timing error | what it supports |
|---|---|---|---|
| 30 | 2.0 | ±49% | nothing. Two points is a line with no confidence. |
| 60 | 4.1 | ±24% | start direction only |
| 120 | 8.2 | **±12%** | start direction + a **usable ball-speed estimate** |
| 240 | 16.4 | **±6%** | the above, tighter — a real number with a real range |

So a 15-foot cage is not "no flight". It is a short, well-lit, **fixed-distance** measuring section,
which is close to the ideal conditions for the one thing that matters most: the ball crosses a KNOWN
distance in a COUNTABLE number of frames, and distance over time is speed.

**BALL SPEED COMES OFF THE NEVER-LIST.** It belongs in the gated-by-factor column, which is exactly
what Tim's revised rule is for: not dropped, not fabricated — measured to a confidence the frame rate
earns, with the lever shown ("at 120 I can give you ball speed to about 12%; at 240 it halves").

**CARRY DISTANCE IS STILL NOT MEASURED,** and must never be presented as if it were. Fifteen feet
says nothing about 250 yards on its own; carry needs ball speed *plus* launch angle *plus* spin, and
spin is radar-or-nothing. What we can do is *infer* it from measured ball speed and label it as an
inference with a range.

---

### The canvas target — where cage mode came from, and the real unlock

**Tim, 2026-09-12: *"and canvas target with a bulls eye. This is where cage mode came from."***

That completes the original rig: a 10-foot net cage, **15 feet** to a canvas target with a bullseye.
And it is not decoration — it is the instrument. A known target at a known distance gives three
things a net alone does not:

1. **A fiducial.** A bullseye of known size is a camera calibration reference. Pixels become inches
   without asking the player to measure anything.
2. **Dispersion, measured rather than extrapolated.** Where the ball actually *strikes the canvas*
   is the dispersion, directly — far better than projecting a line from 15 feet of flight.
3. **A second acoustic event at a speed-dependent delay.** This is the big one.

#### Ball speed, acoustically, with one microphone

`api/acoustic-detect.ts` already finds TWO peaks and already does the arithmetic — but it reads the
second peak as the **wall echo** of the club strike and therefore solves for the unknown: distance.
`Δt = 2 × distance / c`.

In a cage where the distance is KNOWN, that inverts. And the ball hitting the canvas is a *third*,
later transient whose delay depends on how fast the ball was going:

| Event | Delay after impact | Depends on ball speed? |
|---|---|---|
| Club-strike echo off the cage wall | **26.7 ms** (2 × 15 ft ÷ 1125 ft/s) | **no** — constant |
| Ball strikes the canvas, sound returns | **73–127 ms** (15 ft ÷ v, + 13.3 ms back) | **yes** |

They are cleanly separable because they scale differently. And the timing precision is extraordinary
compared with video: the decoder runs at 22050 Hz, so one sample is **0.045 ms** — about **0.06%** of
a 68 ms flight. That is an order of magnitude better than 240fps video, from hardware every phone has.

| | timing error on ball speed |
|---|---|
| video @ 120fps | ±12% |
| video @ 240fps | ±6% |
| **acoustic, known distance** | **≈0.1%** (detection confidence, not timing, is the limit) |

#### This corrects a claim in our own code

`api/acoustic-detect.ts` states: *"True ball speed needs 2 mics, doppler, or radar — out of scope."*
That is right for an OPEN range, where the distance travelled is unknown. **It is not right for a
cage with a known target distance**, which is the exact case this rig is. One mic, one known
distance, two timestamps.

#### What would have to be true

Stated plainly, because this is a proposal and not a shipped capability:

- **The canvas hit has to be detectable.** It is much quieter than the club strike, and netting
  absorbs; a taut canvas target is the loudest version of this and is what Tim built. Unproven.
- **The detection window must widen.** It is currently 5–80 ms, tuned for the 26.7 ms echo — which
  *misses the ball-strike transient for every swing under about 150 mph*. It needs ~200 ms.
- **The distance must be entered once**, in a cage setup. That is the single missing input standing
  between the existing two-peak maths and a real number.
- **Rebounds must be rejected.** `filterReboundStrikes` already exists for the adjacent problem.

If it holds, ball speed stops being "club-typical × peak amplitude" — the heuristic the file itself
flags as a heuristic — and becomes measured. That is the difference between a swing recorder and the
poor man's TrackMan.

**And then check the inference against something no bay has.** We hold this player's real carry and
total for that club, from actual rounds, in two ladders. So a bay-inferred carry is not a guess
floating free — it can be reconciled against what the club has genuinely done for them outdoors, and
the gap between the two is itself worth telling them about.

### And that is precisely where the round comes back in

The bay says **how you swung**. The course says **how far it went** — we already hold carry and total
per club from real rounds, in two ladders, with a roll model between them.

Neither half alone is a fitting. A launch monitor bay measures ball flight and never sees your body
or your scores. A round tracker knows your distances and never sees your swing. **The whole argument
for this feature is that one product has both**, and the fitting session is where they finally meet:
test the swing indoors in January, validate the club outdoors in April, from the same app.

Nobody selling a $20,000 bay can follow us onto the golf course, and nobody selling a shot tracker
can follow us into the garage.

### The thing a real bay cannot do

**Tim: *"Swing bay — you don't get to see yourself and how you are swinging, as a standard."***

A commercial bay sells you ball data and shows you a number. It does not show you your swing. We
start from the swing — that is the whole of SmartMotion — and the ball data is what we are adding.
Coming at it from that side is not a compromised version of a launch monitor; it is the half a launch
monitor leaves out, with the half it does best approximated well enough to choose a club.

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

## 5b. Where the honesty ethos came from

**Tim, 2026-09-12: *"So you have context — this is where the entire honesty ethos originally came
from."***

Worth recording, because it changes how the rules in this document should be read. The honesty
principles in this app are not a policy adopted for good taste. They are what the original concept —
this concept, a Temu net in a back garden with a GoPro and a phone — ran into physically and could
not get around:

- in a net the ball travels about four feet, so there is no carry to observe at any frame rate;
- a phone camera and one microphone cannot see spin, launch angle, ball speed or spin axis;
- so the only way the idea worked **at all** was to be exact about which numbers were real.

Everything downstream descends from that. Dropping spin / face angle / launch angle from SmartMotion
rather than faking them. "Real signals or Coming Soon, never fabricate." Confidence and range instead
of a blank. Degrade and flag rather than go dark. The source-tiering in `swingMetricsService`.

So the honesty rails in §3 and §5 are not a constraint bolted onto this feature to keep it modest.
**They are the feature.** The reason a phone and a cheap net can be called a fitting at all is that
it only ever claims what it measured — and the moment it claims more, it is just a worse launch
monitor.

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

---

## 8. PARKED — the intuitive-simplification pass

**Tim, 2026-09-12: *"We are not going to do the intuitive simplification review — that is 2.0, mostly
minor, maybe some like putting drills and shot shapes in one interface. But let's not mess with that
right now, just put it for later."***

Deliberately not being done now. Recorded so it is not rediscovered as a finding:

- consolidating putting drills and shot shapes into one interface;
- the wider "even I have trouble finding things" pass over navigation and settings.

Both are 2.0 and mostly minor. Nothing above depends on them.

---

## 9. What was already built (checked, 2026-09-12)

Tim: *"you will probably find this all built mostly already."* He was right, and this is what the
check actually found — recorded so the next person does not rebuild it:

| Piece | State |
|---|---|
| `app/practice-session/target-calibration.tsx` | **Built.** Listen → tap where it hit → save a labelled `CageTargetSample` (WAV + hitX/hitY + peakDb + cage geometry). Scatter plot after 5. Reachable from the practice-session index. |
| `store/acousticCalibrationStore` | **Built.** Persists up to 200 target samples, plus a separate applied-calibration path that IS wired. |
| `api/acoustic-detect.ts` | **Built.** Two-peak detection, envelope, echo-delay → cage distance, confidence. |
| `components/practice/PracticeTargetUI` | **Built.** The canvas/bullseye UI with hit-type labelling. |
| Bullseye as a vision fiducial at high fps | **Not built.** The design intent Tim describes; nothing detects the target optically yet. |

### ⚠️ The tap-to-label screen is a BOOTSTRAP TOOL, not the product

**Tim, 2026-09-12: *"Not too much supervised — it was too much tap. We need to show what AI does in
this space."***

Correcting how I wrote this up. `target-calibration.tsx` asks the player to tap where the ball hit,
and I described it as the feature. It is not: it is a dataset builder, built to teach an
**acoustic-only** model to place a strike from sound. That was the right tool for bootstrapping and
the wrong shape to ship.

And the tapping is not confined to calibration. The cage flow today asks for three:

| Tap | Why it exists |
|---|---|
| *"tap where your ball sits"* | gives the ball's position for the departure read |
| tap the target | gives the aim line |
| *"tap where it hit"* (calibration) | labels a training sample |

Three manual inputs to measure one golf shot. Every one of them is a thing the camera is looking
straight at.

### Zero taps is the requirement

The setup the AI should handle by itself:

1. **Find the ball.** A golf ball on a mat is a high-contrast sphere of known diameter — which also
   makes it a second scale reference alongside the bullseye.
2. **Find the target.** A printed bullseye of known size is a textbook fiducial: it yields the
   pixels-to-inches scale AND the camera's pose relative to the canvas, with no calibration step and
   nothing for the player to measure.
3. **Find the strike.** The ball's last tracked position before it meets the canvas, cross-checked
   against the acoustic hit.

**We already do the far harder version of this.** `services/swing/clubPath` tracks a CLUBHEAD through
impact — a small, motion-blurred, fast-moving object — and reports per-frame coverage honestly. A
stationary bullseye and a stationary ball are easier problems than the one already shipped. The
capability is proven; it has simply never been pointed at the target.

That also re-casts the acoustic work rather than replacing it. If vision reports WHERE, the
microphone is free to do what it is uniquely good at: WHEN (sub-millisecond, which is where ball
speed comes from) and HOW WELL IT WAS STRUCK. Two instruments answering different questions and
cross-checking each other beats one instrument being asked to guess position from a sound.

**What the tapping becomes:** a correction, not an input. The player taps only when the AI got it
wrong — which is also how the training set keeps growing, from real disagreements rather than from a
chore.

### The gap that matters

**`targetSamples` has no exit.** It is written by the calibration screen and read only by that same
screen, for its own scatter plot and counts. The file header says the dataset *"can be batch-sent to
/api/acoustic-detect"* — "can be", and nothing does. So every labelled sample Tim has patiently
collected stays on one device and teaches nothing.

**And its audio was not durable.** `wavUri` pointed at whatever expo-av's Recording chose, a file
this app never owned the lifetime of (`acousticImpactDetector`'s own contract is "call
cleanupImpactRecording(uri) to discard"). The labels persist in AsyncStorage, so after a cache
eviction the store would show 200 carefully tapped positions with every WAV behind them gone — the
worst shape for a training set, because it still looks complete. **Fixed 2026-09-12:** samples are
copied into `documentDirectory/cage-calibration/` on save, the same reasoning
`services/clipStorageGc` already applies to swing clips.

The export path remains open, and it is the smallest piece of real work standing between a collected
dataset and a model that could place a strike on the canvas from sound alone.
