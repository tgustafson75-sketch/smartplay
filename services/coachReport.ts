/**
 * 2026-06-08 — Coach swing report export.
 *
 * Katie's use case: instead of texting a student a raw clip + a separate
 * typed description, export ONE clean, friendly PDF — fault frame + the AI
 * read (which already folds in the coach's note) + the drill, headed with
 * the instructor's name + credentials and the SmartPlay logo, dated, with
 * the session count. Built on the same expo-print pattern as the round
 * recap (app/recap/[round_id].tsx).
 *
 * Honest: only renders fields that exist; never fabricates a metric.
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';

export interface CoachReportInput {
  studentName: string | null;
  instructorName: string | null;
  instructorCredentials: string | null;
  sessionDateMs: number;
  /** Nth session with this instructor (1-based). null = don't show. */
  sessionNumber: number | null;
  /** Local image URI of the fault/keyframe to feature. */
  faultFrameUri: string | null;
  /** Real, measured metrics to show (tempo, etc.). Only pass values that exist — never fabricate. */
  metrics?: { label: string; value: string }[];
  analysis: {
    primaryFault?: string | null;
    observation?: string | null;
    cause?: string | null;
    fix?: string | null;
    drill?: string | null;
    confidence?: string | null;
  } | null;
  coachNote: string | null;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const titleCase = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Read a local image URI into a data: URL for embedding in print HTML. */
async function toDataUrl(uri: string | null, mime: string): Promise<string | null> {
  if (!uri) return null;
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${mime};base64,${b64}`;
  } catch (e) {
    console.log('[coachReport] image read failed (non-fatal)', e);
    return null;
  }
}

/** SmartPlay logo as a data URL (bundled asset → base64). */
async function logoDataUrl(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = Asset.fromModule(require('../assets/images/icon.png'));
    await asset.downloadAsync();
    return asset.localUri ? toDataUrl(asset.localUri, 'image/png') : null;
  } catch (e) {
    console.log('[coachReport] logo load failed (non-fatal)', e);
    return null;
  }
}

export async function exportCoachReport(input: CoachReportInput): Promise<{ ok: boolean; reason?: string }> {
  try {
    const [frameUrl, logoUrl] = await Promise.all([
      toDataUrl(input.faultFrameUri, 'image/jpeg'),
      logoDataUrl(),
    ]);

    const d = new Date(input.sessionDateMs);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

    const instructor = (input.instructorName ?? '').trim() || 'Your Instructor';
    const creds = (input.instructorCredentials ?? '').trim();
    const student = (input.studentName ?? '').trim();
    const a = input.analysis ?? {};
    const fault = a.primaryFault && a.primaryFault !== 'inconclusive' && a.primaryFault !== 'no_dominant_fault'
      ? titleCase(a.primaryFault) : null;

    const section = (label: string, body: string | null | undefined, accent = false) =>
      body && body.trim().length > 0
        ? `<div class="card${accent ? ' accent' : ''}"><div class="label">${esc(label)}</div><div class="body">${esc(body.trim())}</div></div>`
        : '';

    const metaBits = [
      `${esc(dateStr)} · ${esc(timeStr)}`,
      input.sessionNumber != null ? `Session ${input.sessionNumber} with ${esc(instructor.split(' ')[0])}` : null,
      student ? `Player: ${esc(student)}` : null,
    ].filter(Boolean).join(' &nbsp;•&nbsp; ');

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { size: letter; margin: 0.5in; }
            body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; color: #0d1a0d; margin: 0; }
            .top { display: flex; align-items: center; gap: 12pt; border-bottom: 2pt solid #00C896; padding-bottom: 10pt; }
            .logo { width: 42pt; height: 42pt; border-radius: 9pt; }
            .brand { font-size: 11pt; color: #00936e; font-weight: 800; letter-spacing: 0.5pt; }
            .instructor { font-size: 18pt; font-weight: 800; margin-top: 1pt; }
            .creds { font-size: 10.5pt; color: #6b7280; margin-top: 1pt; }
            .meta { font-size: 10pt; color: #6b7280; margin: 10pt 0 4pt; }
            /* 2026-07-02 (Tim — "report is pretty bad") — the frame was full-width with NO height
               cap, so a portrait/odd keyframe rendered ~10in tall = a whole wasted page. Cap the
               height + contain so the featured frame is a tidy inline image, never a page-filler. */
            .frame { display: block; width: 100%; max-width: 7.5in; height: 3.2in; object-fit: contain;
                     background: #0d1a0d; border-radius: 12pt; margin: 8pt 0 4pt; }
            .metrics { display: flex; flex-wrap: wrap; gap: 6pt 18pt; margin: 8pt 0 2pt; }
            .metric { min-width: 1.2in; }
            .metric .mv { font-size: 15pt; font-weight: 800; color: #0d1a0d; }
            .metric .ml { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.6pt; color: #6b7280; text-transform: uppercase; }
            .card { page-break-inside: avoid; }
            .card { background: #f3faf6; border: 1pt solid #d7ece1; border-radius: 10pt; padding: 9pt 12pt; margin-top: 8pt; }
            .card.accent { background: #e9f9f2; border-color: #00C896; }
            .label { font-size: 9pt; font-weight: 800; letter-spacing: 0.8pt; color: #00936e; text-transform: uppercase; }
            .body { font-size: 12pt; line-height: 1.45; margin-top: 3pt; }
            .fault { font-size: 15pt; font-weight: 800; margin-top: 2pt; }
            .foot { margin-top: 14pt; font-size: 9pt; color: #9ca3af; text-align: center; }
          </style>
        </head>
        <body>
          <div class="top">
            ${logoUrl ? `<img class="logo" src="${logoUrl}" />` : ''}
            <div>
              <div class="brand">SMARTPLAY CADDIE · SWING REPORT</div>
              <div class="instructor">${esc(instructor)}</div>
              ${creds ? `<div class="creds">${esc(creds)}</div>` : ''}
            </div>
          </div>
          <div class="meta">${metaBits}</div>
          ${(input.metrics && input.metrics.length > 0)
            ? `<div class="metrics">${input.metrics.map(m => `<div class="metric"><div class="mv">${esc(m.value)}</div><div class="ml">${esc(m.label)}</div></div>`).join('')}</div>`
            : ''}
          ${frameUrl ? `<img class="frame" src="${frameUrl}" />` : ''}
          ${fault ? `<div class="card accent"><div class="label">Top Focus</div><div class="fault">${esc(fault)}</div>${a.confidence ? `<div class="creds">Confidence: ${esc(a.confidence)}</div>` : ''}</div>` : ''}
          ${section('What I see', a.observation)}
          ${section('Why it happens', a.cause)}
          ${section('The fix', a.fix, true)}
          ${section('Drill', a.drill)}
          ${section(`${instructor.split(' ')[0]}'s note`, input.coachNote, true)}
          <div class="foot">Built with SmartPlay Caddie — your swing, honestly analyzed.</div>
        </body>
      </html>
    `;

    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) return { ok: false, reason: 'sharing_unavailable' };
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Send swing report' });
    return { ok: true };
  } catch (e) {
    console.warn('[coachReport] export failed', e);
    return { ok: false, reason: e instanceof Error ? e.message : 'unknown' };
  }
}
