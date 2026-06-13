/**
 * 2026-06-13 — SmartTrace read (confidence-tiered, never dark).
 *
 * Tim's rule: SmartTrace is for beginners and mid/high handicappers, not tour
 * players — so it must DEGRADE, not go dark (memory overstrict-gate-lens). The old
 * trace was binary: no detected ball departure → nothing. This composes an honest
 * read at whatever tier the signals support:
 *
 *   flight  — the ball was seen leaving: real initial DEPARTURE direction off the
 *             aim line (services/swing/ballTrace). The full read.
 *   contact — no clean flight, but a real acoustic STRIKE fired: show that contact
 *             happened + tempo, FLAGGED that flight wasn't seen. Still useful.
 *   none    — neither: an honest "no read", with a nudge to keep the ball in frame.
 *
 * Pure / sync / offline-safe / never-throws (cnsShotRead discipline): no React, no
 * stores — the caller passes the signals in, so it unit-tests and runs with no
 * network. SmartTrace surfaces (smartmotion review, Open Range) are display only.
 * Honesty: claims ONLY initial direction + that a strike happened — never a
 * fabricated arc, curve, carry, or dispersion (memory smartmotion-metrics-honesty).
 */

export type TraceTier = 'flight' | 'contact' | 'none';

export interface SmartTraceInput {
  isPutt: boolean;
  /** SmartTrace reads flight down-the-line only (nothing to see face-on / in a putt). */
  isDownTheLine: boolean;
  /** Real initial departure direction when the ball was seen leaving, else null. */
  direction: { side: 'left' | 'right' | 'straight'; divergenceDeg: number } | null;
  /** A real acoustic strike fired (peakDb !== 0 — video-located swings carry 0). */
  strikeDetected: boolean;
  /** Tempo ratio (backswing:downswing) when measured, else null. */
  tempoRatio: number | null;
}

export interface SmartTraceRead {
  tier: TraceTier;
  /** Compact value for the BALL RESULT badge. null → badge shows "—". */
  badge: string | null;
  /** One honest line for a caption/headline. */
  headline: string;
  /** The flag shown when flight wasn't seen (the "never dark" signal). null at flight tier. */
  note: string | null;
  /** 0–1 — how much to trust this read. */
  confidence: number;
}

function dirBadge(d: { side: 'left' | 'right' | 'straight'; divergenceDeg: number }): string {
  if (d.side === 'straight') return 'ON LINE';
  return `${Math.round(d.divergenceDeg)}° ${d.side === 'left' ? 'L' : 'R'}`;
}

export function composeSmartTrace(input: SmartTraceInput): SmartTraceRead {
  const { isPutt, isDownTheLine, direction, strikeDetected, tempoRatio } = input;
  const tempoStr = typeof tempoRatio === 'number' && tempoRatio > 0 ? `, tempo ${tempoRatio.toFixed(1)}:1` : '';

  // SmartTrace's flight read only applies down-the-line; face-on / putt have no
  // flight to see. Not "dark" — just not this surface's job, so no false flag.
  if (isPutt || !isDownTheLine) {
    return { tier: 'none', badge: null, headline: '', note: null, confidence: 0 };
  }

  if (direction) {
    const onLine = direction.side === 'straight';
    return {
      tier: 'flight',
      badge: dirBadge(direction),
      headline: onLine
        ? 'Started on your line.'
        : `Started ${direction.side} — ${Math.round(direction.divergenceDeg)}° off your aim.`,
      note: null,
      confidence: 0.8,
    };
  }

  if (strikeDetected) {
    return {
      tier: 'contact',
      // Surface the tier in the EXISTING BALL RESULT badge instead of a dark "—":
      // we know the ball was struck, we just couldn't read the flight. The note
      // carries the full honest explanation for a caption.
      badge: 'STRUCK',
      headline: `Solid contact${tempoStr} — couldn't see flight this one.`,
      note: 'Strike detected, but the ball wasn’t visible leaving — showing contact + tempo only. Keep it in frame for a flight read.',
      confidence: 0.45,
    };
  }

  return {
    tier: 'none',
    badge: null,
    headline: 'No clean read this swing.',
    note: 'No flight and no clear strike — anchor the ball box and keep the ball in frame.',
    confidence: 0.15,
  };
}
