import type { LieAnalysisContext } from './lieAnalysisContext';
import * as Sentry from '@sentry/react-native';
import { bumpToActive } from './gpsManager';

/**
 * Phase H — client-side fetcher for the lie-analysis endpoint.
 *
 * Returns the full analysis payload on success, or a typed error result the
 * UI can render directly (no-network → "save for later" flow; failures →
 * "try again" affordance). Never throws — surfaces all failure modes as
 * structured results.
 */

export type LieAnalysis = {
  situation_description: string;
  tactical_advice: string;
  recommended_club: string | null;
  alternative_play: string | null;
  confidence_level: 'high' | 'medium' | 'low';
  conservative_call: boolean;
  follow_up_question?: string | null;
  // Phase H v2 — populated only when goal context affected the call.
  goal_aware_note?: string | null;
};

export type LieAnalysisResult =
  | { kind: 'ok'; analysis: LieAnalysis }
  | { kind: 'no_network' }
  | { kind: 'too_large' }
  | { kind: 'low_quality'; follow_up: string }
  | { kind: 'error'; message: string };

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Pre-beta — single-flight controller for Sonnet vision calls. Cancel-and-
 * replace policy: a newer analyze() aborts the in-flight one. Newer request
 * reflects newer user intent. Cancellations log a Sentry breadcrumb so we
 * can see if users are firing too many in a row.
 */
class VisionRequestController {
  private currentRequest: AbortController | null = null;
  private listeners = new Set<(active: boolean) => void>();

  subscribe(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  isActive(): boolean {
    return this.currentRequest !== null;
  }

  beginNew(): AbortSignal {
    if (this.currentRequest) {
      this.currentRequest.abort();
      try { Sentry.addBreadcrumb({ category: 'vision', level: 'info', message: 'cancel_replace' }); } catch {}
      console.log('[vision] cancel-and-replace');
    }
    const ctrl = new AbortController();
    this.currentRequest = ctrl;
    this.notify(true);
    return ctrl.signal;
  }

  end(ctrl: AbortController | null): void {
    if (ctrl && this.currentRequest === ctrl) {
      this.currentRequest = null;
      this.notify(false);
    }
  }

  private notify(active: boolean): void {
    for (const cb of this.listeners) {
      try { cb(active); } catch {}
    }
  }
}

const visionController = new VisionRequestController();

export const subscribeVisionActive = (cb: (active: boolean) => void): (() => void) =>
  visionController.subscribe(cb);

export const isVisionActive = (): boolean => visionController.isActive();

export async function analyzeLie(
  imageBase64: string,
  context: LieAnalysisContext,
  imageMediaType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<LieAnalysisResult> {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

  // Lie analysis tap is a shot-intent signal — bump GPS to active.
  try { bumpToActive('lie_analysis'); } catch {}

  // Cancel any in-flight vision request and start a new one.
  const signal = visionController.beginNew();
  // Track our controller so we can clear it cleanly on resolve/reject.
  const myController = (visionController as unknown as { currentRequest: AbortController }).currentRequest;

  try {
    const timeoutId = setTimeout(() => myController.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${apiUrl}/api/lie-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_b64: imageBase64,
        image_media_type: imageMediaType,
        context,
      }),
      signal,
    }).finally(() => clearTimeout(timeoutId));

    if (res.status === 413) return { kind: 'too_large' };
    if (!res.ok) {
      return { kind: 'error', message: `Server returned ${res.status}` };
    }

    const data = (await res.json()) as LieAnalysis;

    // Low-confidence + follow_up_question = the model couldn't read the
    // image. Surface as low_quality so the UI prompts a retry rather than
    // speaking iffy advice aloud.
    if (data.confidence_level === 'low' && data.follow_up_question) {
      return { kind: 'low_quality', follow_up: data.follow_up_question };
    }

    return { kind: 'ok', analysis: data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/network|abort|timeout|fetch/i.test(msg)) {
      return { kind: 'no_network' };
    }
    return { kind: 'error', message: msg };
  } finally {
    visionController.end(myController);
  }
}
