# 3.0 — Immersion control: talk to your own swing video

Tim, 2026-08-26: *"full immersion control where you could say, hey Caddie, show me my shoulder
rotation, and it automatically comes on the screen and gets zoomed up, and you can ask it to forward
that motion, slow-mo that motion, go forward three steps, etcetera. It's gonna take, like, more
advanced work on the computer vision, so it's definitely probably three point o."*

**Half-agreed on the timing, and the reason matters: the computer vision is largely already done.**
What is missing is mostly plumbing and a voice grammar, plus one genuinely new piece (the zoom).
That is worth knowing before it gets scheduled as a research project.

---

## What already exists

| The ask decomposes into | Substrate today |
|---|---|
| know where a body part IS, per frame | **33 BlazePose landmarks per frame**, on-device MediaPipe, live since the 07-21 build (`mediaPipePoseService`, projected to COCO-17) |
| know what "shoulder rotation" MEANS | `poseAnalysisApi` already derives `shoulderTurnDeg`, `hipTurnDeg`, lead-shoulder tilt — with a plausibility gate (`biomechPlausibility`) that refuses impossible reads rather than clamping them |
| "slow-mo that motion" | `playbackRate` cycles 1 / ½ / ¼ on the review player today |
| "go forward three steps" | `setPositionAsync` seeks the review video; **frame duration is now derivable** from `captureEngineStore.capturedFps` (wired 08-26) |
| swing boundaries to step within | per-swing `seg.startMs` / `seg.endMs` already drive the windowed review loop |
| a voice channel into the screen | `smartMotionRecordBus.SmartMotionCommand` already carries start/stop/scanClub/angle/close, and Smart Motion subscribes |
| the caddie knowing what is on screen | `screen_context` reaches the brain on every payload |

## What is genuinely new

**1. A body-part → region map.** "Shoulders", "hands", "hips", "wrists", "the club" → landmark index
sets → a bounding box per frame. Mechanical, but it must be *stable*: a box that jitters frame to
frame is unwatchable, so it needs temporal smoothing, and it must degrade to "I can't see your hands
in this frame" rather than zooming to a guess. (`biomechPlausibility` is the precedent — refuse,
don't fabricate.)

**2. The zoom itself.** Crop + scale the review player around that box, animated, tracking through
playback. 2D geometry on landmarks we already compute, not new CV — but the hard part is that it has
to feel good. Fast zoom on a slow-mo swing is nauseating. Expect this to be the real work.

**3. The voice grammar, and the fact that it is CONTINUOUS.** Every voice surface today is one-shot:
say a thing, get a thing. This is a *conversation about an artifact* — "closer", "back a bit",
"stop", "again", "now the hips" — where each command is relative to the last. That is a new
interaction mode, and it is the part most likely to be underestimated. It also has to not fight the
existing round-voice loop for the mic.

**4. Extending `SmartMotionCommand`.** It is a flat string union today. This needs commands with
parameters (`{ type: 'focus', region: 'shoulders' }`, `{ type: 'step', frames: -3 }`), which is a
shape change, not an addition.

## The 2.0 stepping stone, already logged

OPEN-ITEMS §14 holds Tim's earlier, smaller version of this: after an analysis completes, let the
player **circle** a region on the still and re-run the read on just that motion. Tap instead of talk,
one-shot instead of continuous.

**That is the right first build**, and not only because it is smaller: it forces the body-part →
region map and the "refuse when the landmarks aren't there" behaviour into existence with a UI that
cannot mis-hear you. Voice on top of a working region-focus is a grammar problem. Voice *and* region
focus at once is two unknowns multiplied.

## Order

1. **§14 first** — circle a region, re-read that region. Tap-driven. Proves the region map.
2. **Playback verbs by voice** — "slower", "back three", "again". These map onto controls that
   already exist and need no CV at all. Ships the continuous-command grammar against the easy half.
3. **Zoom + track** — the part that has to feel good, once there is something to point it at.
4. **"Show me my shoulder rotation"** — which by then is (1) + (2) + (3) with a noun in front.

## Why this belongs in the product, not just in the backlog

It is the app's ethos applied to review: [[smartplay-core-ethos]] asks whether a thing adds a SENSE,
CLOSES THE LOOP, or REDUCES LOAD. This reduces load — the player stops hunting a scrubber for the
frame that matters and asks for it. And it closes a loop we currently leave open: today the analysis
tells the player what it saw, and the player has no way to ask *show me*.

**Prerequisite:** the 120fps native build (OPEN-ITEMS §17). "Go forward three steps" is a
meaningless instruction at 30fps — three frames is a tenth of a second and nothing has moved. This
feature wants the dense capture, which is another reason it is 3.0 and not sooner.

---

# 3.0 — A FULL AGENT AVATAR, NOT SCREENSHOTS (Tim, 2026-08-31)

> *"Eventually I want a full agent avatar not screenshots but that is 3.0."*

Stated when closing the emotional-art item at eight Serena expressions
(`docs/TODO-CADDIE-EMOTIONAL-ART.md`). The two decisions are the same decision: **stop investing in
pre-rendered stills, because stills are the thing being replaced.**

## What exists today, and what it actually is

`components/CaddieAvatar.tsx` maps 22 mood slots onto a fixed set of still images per persona —
Kevin 20 distinct, Harry 18, Serena 8, Tank 11 — with unmatched moods falling back to a neutral
studio portrait. It is a **lookup table pretending to be a face.** Its ceiling is hard:

- The caddie's state is continuous (confidence, concern, warmth, how the round is going) and the
  avatar is discrete. Everything between two moods renders as one of them.
- It cannot show *transition*, which is most of what reading a face is. A caddie who goes from
  concerned to pleased shows a cut, not a change.
- Every new expression is an asset, a bundle cost and an OTA payload. **N moods × M personas** is a
  drawing bill that grows multiplicatively and is paid again for every persona added.
- Nothing about it is derived from what the caddie is actually doing. The mood is chosen by code and
  then *illustrated*; the picture carries no information the code did not already have.

## What 3.0 means instead

An avatar **driven by the caddie's state** rather than selected from it — speech-synced, with
expression as a continuous parameter, so the face is an output of the same signals that produce the
words. That is what makes it an *agent* avatar rather than an illustrated one.

Two properties matter more than fidelity:

1. **It must be driven by the SAME state the voice is.** A face that disagrees with the tone is
   worse than no face — [[feels-like-a-real-caddie]] treats robotic moments as defects, and a smile
   over bad news is exactly that.
2. **It must degrade to a still.** Offline, cold, low battery, cheap device: fall back to the
   portrait we already ship. The still set is therefore not wasted work — it becomes the floor.

## Why it is 3.0 and not sooner

- It is a rendering and animation problem, not a golf problem. It adds no SENSE, closes no LOOP, and
  reduces no LOAD — it fails all three tests in [[smartplay-core-ethos]]. It is *immersion*, which is
  why it belongs in this document.
- It almost certainly needs a native build and real GPU work, which is the opposite of the OTA-safe
  posture 1.0 is in.
- The eight Serena stills are enough to ship. Tim's call on 2026-08-31 makes that explicit.

**The one thing not to do in the meantime:** commission the remaining ten Serena expressions, or a
full 22 for Tank. That is spending on the stand-in.
