# PuttingLab — Integration Guide

**Status:** Service shipped 2026-05-22. Voice route active. UI surface = `app/cage-review/[review_session_id].tsx` (next).

---

## Architecture

```
glasses video / phone capture
        ↓
glassesVisionInput.submitVisionFrame  (existing stub)
        ↓
puttingAnalysisService.analyzePutt({ frames_base64, spoken_read, ... })
        ↓
/api/putting-analysis  (Claude Sonnet 4.5 multimodal)
        ↓
PuttingAnalysis { alignment, stroke_path, speed, recommended_line, ... }
        ↓
voiceService.speak(voice_summary)  +  cage-review UI render
```

The service is **bootstrap-friendly**: if no frames are available it falls back to course-context + spoken-read analysis with confidence ~25, so the player always gets *something*.

---

## Calling from a UI screen

```tsx
import { analyzePutt } from '../services/puttingAnalysisService';

const handleAnalyzePutt = async (frames: string[], spokenRead: string | null) => {
  setAnalyzing(true);
  const result = await analyzePutt({
    frames_base64: frames,
    spoken_read: spokenRead,
    notes: null,
  });
  setAnalyzing(false);
  if (!result) {
    useToastStore.getState().show("Couldn't analyze the putt.");
    return;
  }
  setPuttingResult(result);
  // Voice summary already-spoken iff caller used speakPuttingAnalysis(),
  // but analyzePutt itself is silent — speak here when desired:
  // void voiceService.speak(result.voice_summary, ...);
};
```

Renderable fields on the screen:

| Field | Source | Use |
|---|---|---|
| `alignment` | vision | Badge: ✓ Square / ⟵ Open / ⟶ Closed / ? |
| `stroke_path` | vision | Stroke-path diagram |
| `speed` | vision + read | Tempo coach tip |
| `recommended_line` | vision + read + geometry | Big banner: "Outside left edge" |
| `break_estimate` | vision + read | "~12 inches L→R" pill |
| `mental_cue` | persona | Pre-shot rehearsal text |
| `alignment_note` / `stroke_note` | vision | Coaching bullets |
| `confidence` | model | "85% confidence" badge |
| `sources_used` | service | "Vision + Read" chip |
| `voice_summary` | persona | Auto-played by `speakPuttingAnalysis()` |

---

## Voice intent

Routes through `query_status` with `query_topic: 'putt_analysis'`.

Recognized utterances (per `app/api/voice-intent+api.ts` examples):
- "analyze my putt"
- "how's my putting stroke"
- "how's my read"
- "look at my putt"

Handler: `services/intents/queryStatusHandler.ts` case `'putt_analysis'`.

The voice handler always pulls the freshest glasses-attached frame via `getActiveVisionContext()` (TTL 30s in `services/glassesVisionInput.ts`) plus the spoken-read string. The player can say "analyze my putt — left edge, 12 inches break, slow green" and the read travels in `spoken_read`.

---

## Cage-review screen integration

Add a "Putting" tab next to the existing Swing analysis tabs. When selected, render:

```tsx
import { analyzePutt, type PuttingAnalysis } from '../../services/puttingAnalysisService';

// Inside the cage-review screen:
const [puttingResult, setPuttingResult] = useState<PuttingAnalysis | null>(null);

useEffect(() => {
  if (!session?.putting_clip_uri) return;
  // Convert the clip frames to base64 (existing helper in services/clipFrameExtractor TBD)
  // or pass the video_url through directly:
  void analyzePutt({
    video_url: session.putting_clip_uri,
    spoken_read: session.putting_voice_read ?? null,
    hole_number: session.hole_number,
    course_id: session.course_id,
  }).then(setPuttingResult);
}, [session?.putting_clip_uri]);
```

Layout suggestion (matches the existing cage-review card style):

```
┌─────────────────────────────────────┐
│  PUTTING                            │
│  ✓ Square · Slight arc · On pace    │  ← alignment / path / speed badges
│                                     │
│  "Two ball-widths outside left      │  ← recommended_line banner
│   edge · ~12 inches L→R"            │
│                                     │
│  • Face was open ~2° at address     │  ← alignment_note
│  • Slight deceleration through      │  ← stroke_note
│    impact — accelerate gently       │
│                                     │
│  💭  Smooth pendulum, eyes still     │  ← mental_cue
│                                     │
│  Vision + Read · 85% confidence     │  ← sources_used + confidence
└─────────────────────────────────────┘
```

Persist `puttingResult` onto the cage session record so the recap and future "learn the golfer over time" patterns can pick it up:

```ts
useCageStore.getState().addPuttingAnalysis(sessionId, puttingResult);
```

(Add `addPuttingAnalysis(sessionId, result)` to `store/cageStore.ts` next sprint.)

---

## Example output (from the user's example video)

For a video showing solid setup, slightly decelerating stroke, good line:

```json
{
  "alignment": "square",
  "stroke_path": "straight",
  "speed": "firmer",
  "recommended_line": "Inside left, dying speed.",
  "break_estimate": "~6 inches L→R",
  "mental_cue": "Smooth pendulum, eyes through the line.",
  "alignment_note": "Setup looks solid — face square to line at address.",
  "stroke_note": "Slight deceleration through impact — commit and let the putter swing through.",
  "confidence": 78,
  "sources_used": ["vision_frames", "spoken_read", "course_geometry"],
  "voice_summary": "Setup looks good. Stroke decelerated a touch through impact — commit and let it swing. Smooth pendulum, eyes still."
}
```

---

## Bootstrap checklist

- [x] `services/puttingAnalysisService.ts` — client service
- [x] `app/api/putting-analysis+api.ts` — Claude Sonnet endpoint
- [x] `app/api/voice-intent+api.ts` — utterance examples
- [x] `services/intents/queryStatusHandler.ts` — `putt_analysis` case
- [x] Defensive fallback when no frames + no read
- [ ] `store/cageStore.ts.addPuttingAnalysis()` — store action (next sprint)
- [ ] Cage-review "Putting" tab UI (next sprint)
- [ ] Frame-extractor helper for video → base64[] (next sprint)
