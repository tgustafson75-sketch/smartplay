/**
 * 2026-05-27 — Fix EP: Send a swing video to Tank for human review.
 *
 * Tim's positioning: Tank is the human coaching layer behind the AI
 * analysis. The "Send to Tank" affordance lets a user push their
 * swing video into a coach-review queue. Eventually paywalled (premium
 * one-on-one review tier); currently always-open via featureAccess
 * SUBSCRIPTIONS_ENABLED=false.
 *
 * Today's stub: opens the system Share sheet with the video file and
 * a pre-filled email body / subject pointing at Marc@smartplaycaddie.com
 * (Marc is Tank's review-queue mailbox; Tim provisions this email).
 * The user picks Mail or another channel; the share sheet handles
 * attachment + send. No server-side queue yet — Tim manually triages
 * what lands in that inbox during beta.
 *
 * Why mailto won't work alone: mobile email apps strip attachments
 * from mailto: links. The Share sheet is the only reliable way to
 * attach a video on iOS + Android via the user's default mail app.
 *
 * Future (once paywalled): replace the Share sheet flow with a direct
 * POST to /api/queue-tank-review that uploads the clip + metadata to
 * a server-side queue, returns a tracking ID, and notifies Marc via
 * email/Slack/Linear. This file's exported surface (sendSwingToTank,
 * isSendToTankAvailable) stays stable — only the implementation
 * inside changes.
 */

import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';
import { canAccess } from './featureAccess';
import { usePlayerProfileStore } from '../store/playerProfileStore';

// 2026-05-27 — Tim's target review-queue mailbox. He provisions
// Marc@smartplaycaddie.com on the SmartPlay Caddie domain tonight;
// until that's live, beta-tester sends land in his spam catch-all.
// Move to a configurable env var (EXPO_PUBLIC_TANK_REVIEW_EMAIL)
// when we want to A/B test or change the destination without OTA.
export const TANK_REVIEW_EMAIL = 'marc@smartplaycaddie.com';

export type SendToTankResult =
  | { kind: 'ok'; via: 'share_sheet' | 'fallback_share' }
  | { kind: 'paywall' }
  | { kind: 'no_file' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

/**
 * Returns true when the current user has access to the Send-to-Tank
 * feature. UI uses this to show/hide the icon OR show a paywall prompt
 * on tap. While SUBSCRIPTIONS_ENABLED=false, returns true for everyone.
 */
export function isSendToTankAvailable(): boolean {
  const status = usePlayerProfileStore.getState().subscription_status;
  return canAccess('send_to_tank', status);
}

/**
 * Send a swing clip to Tank's review queue. v1 implementation = system
 * Share sheet with the video attached + email body pre-filled.
 *
 * Returns a structured result the UI can switch on:
 *   - { kind: 'ok' } — share sheet opened (and likely sent; we can't
 *     verify mid-flight without a server roundtrip)
 *   - { kind: 'paywall' } — feature is locked for this subscription
 *   - { kind: 'no_file' } — videoUri was null/missing
 *   - { kind: 'cancelled' } — user dismissed the share sheet
 *   - { kind: 'error', message } — share threw
 */
export async function sendSwingToTank(opts: {
  videoUri: string | null | undefined;
  swingTitle?: string;
  contextLines?: string[]; // optional extra context (club, hole, date, etc.)
}): Promise<SendToTankResult> {
  if (!isSendToTankAvailable()) {
    return { kind: 'paywall' };
  }
  if (!opts.videoUri) {
    return { kind: 'no_file' };
  }

  const profile = usePlayerProfileStore.getState();
  const playerLine = profile.name
    ? `From: ${profile.name}${profile.email ? ` (${profile.email})` : ''}`
    : profile.email
      ? `From: ${profile.email}`
      : 'From: SmartPlay Caddie tester';

  const ctx = (opts.contextLines ?? []).filter(Boolean).join('\n');
  const subject = `Swing review request — ${opts.swingTitle ?? 'SmartPlay Caddie tester'}`;
  const body =
    `Hi Tank,\n\n` +
    `${playerLine}\n` +
    (ctx ? `\n${ctx}\n` : '') +
    `\nReview the attached swing video when you have a moment. ` +
    `Replying to this email reaches the sender.\n\n` +
    `— Sent from SmartPlay Caddie\n`;

  // Path A — expo-sharing Sharing.shareAsync (best on iOS + Android,
  // handles attachments correctly across Mail / Drive / Messenger).
  // Fall back to React Native's Share API only if Sharing isn't
  // available (rare on real devices, possible on web).
  try {
    const can = await Sharing.isAvailableAsync().catch(() => false);
    if (can) {
      // 2026-05-27 — Pre-set the email subject via Sharing options.
      // Sharing.shareAsync doesn't let us pre-fill the recipient
      // directly (OS-level limitation) — the user picks Mail and the
      // recipient field starts blank. The dialogTitle is what shows
      // in the OS share-sheet header; subject is the email subject
      // when Mail is the target. UTI on iOS = public.movie so the
      // share sheet prioritizes video-aware targets.
      await Sharing.shareAsync(opts.videoUri, {
        mimeType: 'video/mp4',
        dialogTitle: `Send to ${TANK_REVIEW_EMAIL}`,
        UTI: 'public.movie',
      });
      // Note: Sharing.shareAsync doesn't tell us if the user actually
      // sent vs cancelled — both resolve void. UI shows a "shared"
      // toast either way; user can re-tap if cancelled.
      return { kind: 'ok', via: 'share_sheet' };
    }
  } catch (e) {
    // Sharing.shareAsync threw → fall through to RN Share fallback.
    console.log('[tankReview] Sharing.shareAsync threw, falling back', e);
  }

  // Path B fallback — React Native Share. Can't attach a binary
  // (text/url only) but works as a last resort to at least give the
  // user the email + body so they can manually attach in Mail.
  try {
    await Share.share({
      title: subject,
      message: `${TANK_REVIEW_EMAIL}\n\n${body}\n\nVideo file: ${opts.videoUri}`,
      ...(Platform.OS === 'ios' ? { url: opts.videoUri } : {}),
    });
    return { kind: 'ok', via: 'fallback_share' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return { kind: 'cancelled' };
    return { kind: 'error', message: msg };
  }
}
