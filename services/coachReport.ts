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
  /** MIME of faultFrameUri. Defaults to image/jpeg (raw thumbnail); pass
   *  image/png when the frame is an overlay-baked composite (PNG). Data URLs
   *  are MIME-declarative, so this must match the real bytes or WebKit/print
   *  can render it blank. */
  faultFrameMime?: string;
  /** Real, measured metrics to show (tempo, etc.). Only pass values that exist — never fabricate. */
  metrics?: { label: string; value: string }[];
  analysis: {
    primaryFault?: string | null;
    observation?: string | null;
    cause?: string | null;
    fix?: string | null;
    drill?: string | null;
    confidence?: string | null;
    // 2026-08-08 (Tim — "a logical professional coaching swing report") — the honest extras the
    // session already carries; each section renders only when real data exists.
    severity?: string | null;
    strengths?: string[] | null;
    evidence?: string | null;
  } | null;
  coachNote: string | null;
  /** Named practice drills with steps (from the drill catalog for the diagnosed issue). */
  practicePlan?: { name: string; steps: string }[] | null;
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
      toDataUrl(input.faultFrameUri, input.faultFrameMime ?? 'image/jpeg'),
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
            /* 2026-08-08 (Tim — "needs to be white background… a logical professional coaching swing
               report"). Reversal of the same-day dark restyle by his order: clean WHITE professional
               document (what you'd hand a student), brand-green accents only. Structured like a real
               lesson write-up: header → session facts → swing frame → key numbers → assessment →
               what's working → what I see / why → the fix → practice plan → coach's note. */
            @page { size: letter; margin: 0.55in; }
            html, body { background: #ffffff; }
            body { font-family: -apple-system, system-ui, "Segoe UI", Georgia, serif; color: #111827; margin: 0; }
            .top { display: flex; align-items: center; gap: 12pt; border-bottom: 3pt solid #00936e; padding-bottom: 10pt; }
            .logo { width: 44pt; height: 44pt; border-radius: 9pt; }
            .brand { font-size: 10.5pt; color: #00936e; font-weight: 800; letter-spacing: 1.2pt; }
            .rtitle { font-size: 20pt; font-weight: 800; margin-top: 1pt; color: #111827; }
            .creds { font-size: 10pt; color: #6b7280; margin-top: 1pt; }
            .meta { display: flex; flex-wrap: wrap; gap: 4pt 16pt; font-size: 10pt; color: #374151; margin: 9pt 0 2pt; }
            .meta b { color: #111827; }
            .frame { display: block; width: auto; max-width: 100%; max-height: 4.2in; object-fit: contain;
                     background: #f3f4f6; border: 1pt solid #e5e7eb; border-radius: 10pt; margin: 10pt auto 2pt; }
            .framecap { text-align: center; font-size: 8.5pt; color: #6b7280; margin: 2pt 0 6pt; }
            .metrics { display: flex; flex-wrap: wrap; gap: 6pt 22pt; margin: 8pt 0 2pt; padding: 8pt 12pt;
                       background: #f0faf6; border: 1pt solid #ccebe0; border-radius: 10pt; }
            .metric { min-width: 1.15in; }
            .metric .mv { font-size: 16pt; font-weight: 800; color: #065f46; }
            .metric .ml { font-size: 8pt; font-weight: 700; letter-spacing: 0.7pt; color: #047857; text-transform: uppercase; }
            .card { page-break-inside: avoid; background: #ffffff; border: 1pt solid #e5e7eb; border-left: 3.5pt solid #d1d5db;
                    border-radius: 8pt; padding: 9pt 13pt; margin-top: 9pt; }
            .card.accent { border-left-color: #00936e; background: #f8fdfb; }
            .card.good { border-left-color: #2563eb; background: #f8fafc; }
            .label { font-size: 8.5pt; font-weight: 800; letter-spacing: 1pt; color: #00936e; text-transform: uppercase; }
            .card.good .label { color: #2563eb; }
            .body { font-size: 11.5pt; line-height: 1.5; margin-top: 3pt; color: #1f2937; }
            .fault { font-size: 16pt; font-weight: 800; margin-top: 2pt; color: #111827; }
            .sev { display: inline-block; margin-left: 8pt; font-size: 9pt; font-weight: 800; letter-spacing: 0.5pt;
                   color: #92400e; background: #fef3c7; border-radius: 6pt; padding: 2pt 8pt; vertical-align: middle; text-transform: uppercase; }
            .drill { margin-top: 6pt; }
            .drill .dn { font-size: 11.5pt; font-weight: 800; color: #111827; }
            .drill .ds { font-size: 11pt; line-height: 1.45; color: #374151; margin-top: 1pt; }
            ul.strengths { margin: 4pt 0 0 14pt; padding: 0; }
            ul.strengths li { font-size: 11.5pt; line-height: 1.5; color: #1f2937; }
            .foot { margin-top: 16pt; padding-top: 8pt; border-top: 1pt solid #e5e7eb; font-size: 8.5pt; color: #9ca3af; text-align: center; }
          </style>
        </head>
        <body>
          <div class="top">
            ${logoUrl ? `<img class="logo" src="${logoUrl}" />` : ''}
            <div>
              <div class="brand">SMARTPLAY CADDIE · SWING ANALYSIS REPORT</div>
              <div class="rtitle">${student ? esc(student) + "'s Swing Lesson" : 'Swing Lesson'}</div>
              <div class="creds">Prepared by ${esc(instructor)}${creds ? ' · ' + esc(creds) : ''}</div>
            </div>
          </div>
          <div class="meta">
            <span><b>Date:</b> ${esc(dateStr)} · ${esc(timeStr)}</span>
            ${input.sessionNumber != null ? `<span><b>Session:</b> #${input.sessionNumber}</span>` : ''}
            ${student ? `<span><b>Player:</b> ${esc(student)}</span>` : ''}
          </div>
          ${(input.metrics && input.metrics.length > 0)
            ? `<div class="metrics">${input.metrics.map(m => `<div class="metric"><div class="mv">${esc(m.value)}</div><div class="ml">${esc(m.label)}</div></div>`).join('')}</div>`
            : ''}
          ${frameUrl ? `<img class="frame" src="${frameUrl}" /><div class="framecap">Key frame from this session${fault ? ` — ${esc(fault.toLowerCase())} visible at this position` : ''}</div>` : ''}
          ${fault ? `<div class="card accent"><div class="label">Primary Focus</div><div class="fault">${esc(fault)}${a.severity && a.severity !== 'none' ? `<span class="sev">${esc(a.severity)}</span>` : ''}</div>${a.confidence ? `<div class="creds">Read confidence: ${esc(a.confidence)}</div>` : ''}</div>` : ''}
          ${(a.strengths && a.strengths.length > 0)
            ? `<div class="card good"><div class="label">What's Working</div><ul class="strengths">${a.strengths.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
            : ''}
          ${section('What I See', a.observation)}
          ${(() => {
            // 2026-08-08 — drop the cause section when it's near-identical to the observation
            // (word-set overlap), so the report never reads as padding.
            const words = (t: string | null | undefined) =>
              new Set((t ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3));
            const obs = words(a.observation); const cau = words(a.cause);
            if (cau.size > 0 && obs.size > 0) {
              let shared = 0; cau.forEach(w => { if (obs.has(w)) shared++; });
              if (shared / cau.size >= 0.7) return '';
            }
            return section('Why It Happens', a.cause);
          })()}
          ${a.evidence ? section('Seen In Your Video', a.evidence) : ''}
          ${section('The Fix', a.fix, true)}
          ${(input.practicePlan && input.practicePlan.length > 0)
            ? `<div class="card accent"><div class="label">Practice Plan</div>${input.practicePlan.map(d =>
                `<div class="drill"><div class="dn">${esc(d.name)}</div><div class="ds">${esc(d.steps)}</div></div>`).join('')}</div>`
            : section('Drill', a.drill)}
          ${section(`${instructor.split(' ')[0]}'s Note`, input.coachNote, true)}
          <div class="foot">SmartPlay Caddie · Swing Analysis Report — real measurements and observed mechanics only, honestly analyzed.</div>
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
