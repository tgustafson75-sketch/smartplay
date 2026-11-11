/**
 * 2026-11-10 — SELF-HEAL v1: "Report a problem" (services/issueLogExport.sendProblemReport, the
 * Settings → Help & About row).
 *
 * Pins what the standard asks for: one tap, available to EVERY player (so not gated on the
 * shareDiagnostics auto-send consent), sent through the existing path (/api/issue-report + the
 * Sentry feedback mirror), carrying the version/build and the last errors, and no name, email or
 * spoken words.
 *
 * Break test: remove sendProblemReport, or the Settings row that calls it, and this file fails.
 */
import * as fs from 'fs';
import * as path from 'path';

const sentry: Record<string, jest.Mock> = {};
jest.mock('@sentry/react-native', () => new Proxy({}, {
  get: (_t, k: string) => (sentry[k] ??= jest.fn()),
}));

import { useIssueLogStore } from '../../store/issueLogStore';
import { useSettingsStore } from '../../store/settingsStore';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { sendProblemReport } from '../../services/issueLogExport';

const ctx = {
  route: 'caddie', persona: 'kevin', isRoundActive: false,
  courseId: null, currentHole: null, appVersion: '1.0.4',
} as never;

/** isTestRunner() blocks real sends from a suite; defeat it for one call, as the diagnostics test does. */
async function asApp<T>(fn: () => Promise<T>): Promise<T> {
  const realJest = process.env.JEST_WORKER_ID;
  const realNode = process.env.NODE_ENV;
  delete process.env.JEST_WORKER_ID;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try { return await fn(); } finally {
    if (realJest !== undefined) process.env.JEST_WORKER_ID = realJest;
    if (realNode !== undefined) (process.env as Record<string, string>).NODE_ENV = realNode;
  }
}

describe('Report a problem', () => {
  it('sends version, build and the last errors through /api/issue-report and Sentry, with consent OFF and no PII', async () => {
    useSettingsStore.setState({ shareDiagnostics: false } as never);
    usePlayerProfileStore.setState({ email: 'tim@example.com', name: 'Tim G' } as never);
    useIssueLogStore.setState({
      entries: [
        { id: 'a', timestamp: 3, text: 'app_error: TypeError x is undefined', kind: 'app_error', context: ctx },
        { id: 'b', timestamp: 2, text: 'my wife says the caddie is rude', kind: 'user', context: ctx },
        { id: 'c', timestamp: 1, text: 'heard "call my brother"', kind: 'voice_miss', context: ctx },
      ],
      lastExportedAt: 0,
    } as never);

    const calls: { url: string; body: { entries: Record<string, any>[] } }[] = [];
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), body: JSON.parse(String((init as { body?: unknown }).body)) });
      return { ok: true, json: async () => ({ ok: true }) } as never;
    }) as never;
    let sent: boolean;
    try {
      sent = await asApp(() => sendProblemReport());
    } finally {
      global.fetch = realFetch;
    }

    expect(sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/issue-report$/);
    const [entry] = calls[0].body.entries;
    expect(entry.details.source).toBe('report_a_problem');
    // Version + build ride in the diagnostic snapshot; the version also in the entry context.
    expect(entry.context.diag.build).toBeTruthy();
    expect(entry.context).toHaveProperty('appVersion');
    // Last errors: the machine error, not the player's note or spoken words.
    expect(entry.details.lastErrors.map((e: { kind: string }) => e.kind)).toEqual(['app_error']);
    const blob = JSON.stringify(calls[0].body).toLowerCase();
    for (const banned of ['tim@example.com', 'tim g', 'my wife', 'my brother']) expect(blob).not.toContain(banned);
    // The same Sentry mirror as the automatic channel.
    expect(sentry.captureFeedback).toHaveBeenCalledTimes(1);
  });

  it('says it failed when the server does not take it', async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as never;
    try {
      expect(await asApp(() => sendProblemReport())).toBe(false);
    } finally {
      global.fetch = realFetch;
    }
  });

  it('is a one-tap row in Settings → Help & About for every player', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../app/settings.tsx'), 'utf8');
    expect(src).toMatch(/const sent = await sendProblemReport\(\);/);
    const row = src.indexOf("t('settings.text.report_a_problem')");
    expect(row).toBeGreaterThan(-1);
    const help = src.indexOf("title={t('settings.title.help_about')}");
    const ownerTools = src.indexOf('const showOwner = isOwnerBuild();');
    // Inside the public Help & About section, before the owner-only block.
    expect(row).toBeGreaterThan(help);
    expect(row).toBeLessThan(ownerTools);
    expect(src.slice(row - 900, row)).toMatch(/onPress=\{onReportProblem\}/);
  });
});
