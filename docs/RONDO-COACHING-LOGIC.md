# Rondo Coaching Logic — Platform Spec

Status: SPEC (extracted 2026-11-01).
Rondo stays a product: a coaching platform for any sport, built to suit per sport or per client. Soccer is the first sport pack, not the product.
This spec is Rondo's sport-independent core. Caddie and Bay reuse the same rules.
Source of truth: local repo `~/rondo` at commit `628447d` (no remote). Every rule below cites the Rondo file it came from.
Reuse targets: Caddie (`~/smartplay`) and Bay (`~/smartbay-ai`). Nothing here is built in either yet.

---

## 1. The sport-independent core

Rondo's value is not soccer. It is a coaching loop:

1. A coach (or Kevin) makes a short observation.
2. The observation is distilled into a named **development thread** on that player.
3. A thread only becomes **active** after it is corroborated by a second, separate observation.
4. Active threads drive the next session's **cues**, each naming the player.
5. Homework is prescribed **only** when solo practice can actually fix the issue.
6. Completed reps are written back against the assignment that asked for them, closing the loop.

One persona, one memory, one retrieval function feed all of it.

---

## 2. The rules

### R1. One persona, two registers — never two personas
Source: `src/lib/ai/gio.ts`
- One system prompt core plus a register flag: `coach` or `player`.
- `coach` register: assistant coach. Short, specific, names the player, never explains the sport to someone who knows it.
- `player` register: the coach. Direct, warm, one correction at a time, praise only what was actually good and name it precisely. No hype words, no exclamation marks.
- Caddie mapping: Kevin already exists. Add the register flag to Kevin; do not create a second "coach" character. `player` = golfer using the app; `coach` = Tank or any instructor in Coach Mode (`watching_someone` perspective).
- Bay mapping: the bay instructor persona runs in `player` register by default; a facility pro reviewing a lesson gets `coach`.

### R2. Advice must reference the specific situation
Source: `gio.ts` CORE, `src/lib/read/scenarios.ts`
- Generic advice is a defect ("play it wide" / "aim center"). Every answer references the concrete state: for golf, hole, lie, distance, wind, score vs. target, and hole number in the round.
- Never invent a fact about a player that is not in the memory block. If memory is thin, say less.

### R3. Notes are append-only; threads are distilled from them
Source: `src/lib/state/rondoStore.ts`
- Raw observations are never edited or overwritten. Threads are a derived layer on top.
- Keyed `coach_id → team_id → player_id`, present in every model even with one user. Caddie mapping: this matches the existing 1.0 rule that `player_id`, `speaker_id` and roster fields exist everywhere.

### R4. Corroboration gate — two separate observations before "active"
Source: `rondoStore.ts` (`addNote`), `CLAUDE.md` Honesty gate 1
- A new thread starts as `watching` with `support: 1`.
- It becomes `active` only when a second, separate observation supports **that same thread**.
- UI states "not yet corroborated" for `watching` threads. No cue fixes a `watching` thread; at most it says "worth a look."
- Caddie mapping: one bad swing or one bad hole opens a `watching` thread. A tendency (e.g. "misses right under pressure") is only stated by Kevin once a second round or session supports it.

### R5. Prescribe solo work only for technique gaps
Source: `src/app/api/note/route.ts`
- Distilling a note returns `move_ids: []` when the issue is a decision, positioning or movement problem, and says so to the coach.
- Drills are prescribed only for technique gaps solo practice can fix.
- Prescribed drill IDs are validated against the real drill library; unknown IDs are dropped.
- Caddie mapping: course-management issues (club choice, target, aggression) get no SwingLab drill. Swing-mechanics issues map to SwingLab drills only. Bay mapping: same split — a lesson fix is mechanics; a strategy observation is a talking point, not a drill.

### R6. Cues name a player and say what to DO, not what is wrong
Source: `src/app/api/session/route.ts`
- A session plan is scaffolding; the cues are the product.
- Every cue names a real player from the memory block. Never invent a name.
- Cue form: an action for this session ("put the ball on her left side"), not a diagnosis ("work on weak foot").
- Bay mapping: the "one fix" in a bay lesson is a cue in this form, built from that golfer's active threads.

### R7. One retrieval function, one prompt block — no split brain
Source: `src/lib/coach/getCoachContext.ts`
- One synchronous function that never throws builds a single `promptBlock`.
- The LLM and the visible UI cards read the SAME block, so what the user sees always matches what the model was told.
- Priority ordering: players with `active` threads first, then by corroboration count.
- Caddie mapping: Kevin's round/session context and the dashboard's "Kevin's Read" card come from one function.

### R8. The loop closes by writing results back to the assignment
Source: `rondoStore.ts` (`addResult`)
- A completed rep is credited against the newest open assignment that includes that drill.
- The next session's context lists completed homework, so the coach (or Kevin) can reference it.

### R9. Honest degradation with no AI key
Source: every route in `src/app/api/`
- With no key, each route returns a clearly labeled STUB built from the same context, and the full path still runs.
- The keyword stub only prescribes on an unambiguous technique keyword; otherwise it prescribes nothing rather than guessing.

### R10. Measurement honesty
Source: `src/lib/mastery/repCounter.ts`, `CLAUDE.md` Honesty gate 3
- A sensor reports only what it actually measures. Rondo's camera counts motion cycles; it never reports which foot or touch quality.
- Anything not measured is shown as a coaching cue, never as data.
- Caddie mapping: aligns with existing honest-fallback rules (SmartFinder, GPS). Applies to SwingLab and cage audio.

### R11. Fairness is arithmetic, not judgment
Source: `src/lib/scrimmage/rotation.ts`
- Most-time off, least-time on; spread reported in minutes with a plain verdict. Coach can always override.
- Caddie/Bay mapping: multi-player features (1.1) that share bay time or practice reps use the same rule.

---

## 3. Known defects in Rondo — do NOT port these

Verified in `~/rondo` at `628447d`:

1. **New threads are never saved.** `/api/note` returns `thread` and `extends_existing`, but the touchline save handler (`src/app/coach/touchline/page.tsx`, `onSave`) only calls `addNote` and `addAssignment`. There is no `addThread`. The only threads that exist are the three seed threads.
2. **Corroboration is not topic-matched.** `addNote` bumps support on EVERY `watching` thread for that player, whatever the note is about. A note about shooting would promote a scanning thread to `active`.

Consequence: the R4 corroboration gate is described in Rondo's docs but does not work in its code. When porting, implement R4 as written above: the distilled thread label must match before support increments, and a non-matching note opens a new `watching` thread.

---

## 4. Sport packs — building Rondo to suit

The core (R1–R11) never changes per sport. Everything sport-specific lives in a sport pack. Soccer is the only pack built today; its files are the template.

| A sport pack supplies | Feeds rule | Soccer pack today (in `~/rondo`) |
| --- | --- | --- |
| Roles/positions and player attributes | R3, R7 | `Position`, `Foot` in `src/lib/types.ts` |
| The situation fields every answer must reference | R2 | position, scoreline, minute (`src/lib/read/scenarios.ts`) |
| Authored decision scenarios, incl. mirror pairs | R2 | 8 scenarios in `src/lib/read/scenarios.ts` |
| Solo drill library, each drill tagged technique-only | R5, R8 | 6 moves in `src/lib/mastery/moves.ts` |
| Rules reference | R2 | `src/lib/rules/laws.ts` |
| Sensors, each declaring what it can and cannot measure | R10 | `repCounter.ts`, `keeper/shotDetector.ts` |
| Playing-time rule, if the sport rotates players | R11 | `src/lib/scrimmage/rotation.ts` |
| Persona name and register prompts | R1 | Gio (`src/lib/ai/gio.ts`) |

Deployment choices, not sport choices: storage (Rondo uses localStorage; a client build swaps `rondoStore.ts` only) and voice (Rondo uses browser speech; Caddie keeps Deepgram STT + `onyx` TTS).

Code gap today: soccer content is imported directly by the core routes (e.g. `/api/note` imports `MOVES`). A second sport pack requires moving these behind a pack interface first.

---

## 5. Success criterion

This spec is complete when every rule R1–R11 cites a Rondo source file that exists at commit `628447d`, both defects in Section 3 are reproducible by reading the named files, a new sport can be scoped by filling only the Section 4 table, and a Caddie or Bay build prompt can reference rules by ID (e.g. "implement R4 and R5 for SwingLab") without opening the Rondo repo.
