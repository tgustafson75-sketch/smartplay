/**
 * 2026-08-10 (Tim added a Gemini key for search grounding — "so the caddie can search info about
 * courses near you or other areas we can capitalize on"). A GROUNDED web-search helper: Gemini +
 * Google Search grounding. Returns a concise answer plus the REAL source domains it was grounded on, so
 * the caddie speaks fact, not hallucination — and can attribute ("per the club's site…").
 *
 * HONESTY: this is only ever fed to the brain as tool RESULT text the model then speaks. It carries the
 * grounded answer + sources; when Google returns no grounding the caller should treat it as "couldn't
 * confirm" rather than let the model invent. Bounded timeout so it can't hang the serverless turn.
 */
import { GoogleGenAI } from '@google/genai';

export interface GroundedSearchResult {
  answer: string;
  /** Distinct source domains/titles the answer was grounded on (may be empty). */
  sources: string[];
  grounded: boolean;
}

function keyPresent(): boolean {
  return !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}

/**
 * Run a Google-Search-grounded query. `context` (e.g. "near Menifee, CA" or "at Berlin Country Club")
 * is folded into the prompt so location-relative questions resolve. Returns grounded:false on any
 * failure / missing key so the caller degrades honestly ("I couldn't look that up right now").
 */
export async function groundedSearch(
  query: string,
  opts?: { context?: string | null; timeoutMs?: number },
): Promise<GroundedSearchResult> {
  const q = (query ?? '').trim();
  if (!q) return { answer: '', sources: [], grounded: false };
  if (!keyPresent()) return { answer: '', sources: [], grounded: false };

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  const ctx = opts?.context?.trim() ? `\n\nContext: the player is ${opts.context.trim()}.` : '';
  const prompt =
    `You are the research arm of a golf caddie assistant. Answer this factual question using web search, ` +
    `concisely (2-4 sentences), with real, current facts only. If you cannot find a confident answer, say so plainly. ` +
    `Do not speculate.\n\nQuestion: ${q}${ctx}`;

  const timeoutMs = opts?.timeoutMs ?? 9_000;
  try {
    const resp = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          // Google Search grounding — the whole point of the key Tim added.
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
          maxOutputTokens: 500,
        },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('grounded-search timeout')), timeoutMs)),
    ]);

    const answer = (resp.text ?? '').trim();
    // Pull the grounded source domains from groundingMetadata (shape-tolerant across SDK minors).
    const sources = new Set<string>();
    try {
      const gm = (resp.candidates?.[0] as { groundingMetadata?: Record<string, unknown> } | undefined)?.groundingMetadata;
      const chunks = (gm?.groundingChunks as Array<{ web?: { uri?: string; title?: string } }> | undefined) ?? [];
      for (const c of chunks) {
        const uri = c.web?.uri;
        const title = c.web?.title;
        if (title) sources.add(title);
        else if (uri) {
          try { sources.add(new URL(uri).hostname.replace(/^www\./, '')); } catch { /* skip */ }
        }
      }
    } catch { /* grounding metadata optional */ }

    return { answer, sources: [...sources].slice(0, 4), grounded: answer.length > 0 };
  } catch {
    return { answer: '', sources: [], grounded: false };
  }
}

/** Format a grounded result as the brain's tool-result text (answer + a short source note). */
export function formatGroundedForBrain(r: GroundedSearchResult): string {
  if (!r.grounded || !r.answer) return 'WEB SEARCH: no confident result — tell the player you could not look that up right now; do not guess.';
  const src = r.sources.length ? ` (sources: ${r.sources.join(', ')})` : '';
  return `WEB SEARCH RESULT — speak this as your own knowledge, concisely${src}:\n${r.answer}`;
}
