/**
 * WHAT THE CADDIE SAYS WHEN A TURN FAILS — ONE OWNER.
 *
 * 2026-10-15 (offline report, Tim: "I'm dead ass afraid to get some kind of local mode glitches back").
 *
 * Six failure paths each picked their own line: the tap mic, the caddie-tab mic, the earbud session,
 * the honest-failure notice and two brain-fallback branches. Between them they offered Local Mode
 * (a toggle that no longer exists), said "Good moment to sharpen your tempo" in answer to a question
 * nobody asked, blamed the connection on full 5G, and — on the main mic — said nothing useful at all.
 * Local Mode's history (06-10 breaker trap, 07-24 first-minute loop, 08-23 pre-brain answers) is the
 * same root: each path decided "offline" from one failed call, without knowing WHY it failed.
 *
 * The rules, in order. Nothing here runs before the brain; it runs only after a turn has failed.
 *   1. If the player's question is known and the phone can answer it from REAL data — the GPS, their
 *      logged bag, the green, the bundled golf knowledge — answer it. That is the caddie, not a mode.
 *   2. Otherwise ask services/reachability (hosts that are not ours) why it failed:
 *        internet_ok → the failure is OURS. Own it; never blame their signal.
 *        slow        → the connection is measured-slow. Say so.
 *        offline / captive → PROVEN no internet. On a round, the shot in front of them (measured);
 *                      off a round, the truth plus what still works.
 * No persisted flag, nothing to get stuck: the verdict is cached 20s and any success clears it.
 */
import { probeReachability, isProvenOffline, lastReachability, type NetVerdict } from './reachability';
import { CADDIE_NOTICE_CONNECTION, CADDIE_NOTICE_OFFLINE, CADDIE_NOTICE_ON_US } from './caddieAckLines';

type Lang = 'en' | 'es' | 'zh';

export type FailureReplySource = 'local_answer' | 'round_read' | 'on_us' | 'slow' | 'offline';

export type FailureReply = {
  text: string;
  source: FailureReplySource;
  /** Null when rule 1 answered and the network was never asked. */
  verdict: NetVerdict | null;
};

export function safeLang(language: string | null | undefined): Lang {
  return (['en', 'es', 'zh'] as const).includes(language as Lang) ? (language as Lang) : 'en';
}

export async function caddieFailureReply(opts: { heard?: string | null; language?: string | null }): Promise<FailureReply> {
  const lang = safeLang(opts.language);

  // 1 — the question, answered from real local data.
  const heard = opts.heard?.trim();
  if (heard) {
    try {
      const off = (require('./offlineCaddie') as typeof import('./offlineCaddie')).answerOffline(heard, lang);
      const text = off?.text?.trim();
      if (text) return record({ text, source: 'local_answer', verdict: null });
    } catch { /* the local answer is a bonus, never a dependency */ }
  }

  // 2 — why did it fail?
  const verdict = (await probeReachability()).verdict;
  if (verdict === 'internet_ok') return record({ text: CADDIE_NOTICE_ON_US[lang], source: 'on_us', verdict });
  if (verdict === 'slow') return record({ text: CADDIE_NOTICE_CONNECTION[lang], source: 'slow', verdict });
  if (isProvenOffline(verdict)) {
    try {
      const read = (require('./localStatusResponder') as typeof import('./localStatusResponder')).roundReadLine(lang);
      if (read) return record({ text: read, source: 'round_read', verdict });
    } catch { /* fall through to the truth */ }
  }
  return record({ text: CADDIE_NOTICE_OFFLINE[lang], source: 'offline', verdict });
}

function record(r: FailureReply): FailureReply {
  try {
    require('../store/issueLogStore').useIssueLogStore.getState()
      .addAppEvent('caddie_failure_reply', { source: r.source, verdict: r.verdict }, 'diag');
  } catch { /* a diagnostic never breaks the reply */ }
  return r;
}

/** The notice alone (no local answer, no round read) for a verdict. */
export function failureNoticeFor(verdict: NetVerdict, language?: string | null): string {
  const lang = safeLang(language);
  if (verdict === 'internet_ok') return CADDIE_NOTICE_ON_US[lang];
  if (verdict === 'slow') return CADDIE_NOTICE_CONNECTION[lang];
  return CADDIE_NOTICE_OFFLINE[lang];
}

/** The honest notice, asking reachability why the turn failed. Never throws. */
export async function failureNotice(language?: string | null): Promise<string> {
  try {
    return failureNoticeFor((await probeReachability()).verdict, language);
  } catch {
    return CADDIE_NOTICE_ON_US[safeLang(language)];
  }
}

/**
 * Synchronous form for caption-only paths that cannot wait: a verdict from the last 20s if there is
 * one; otherwise the failure is owned (ON_US) — never "trouble connecting" without evidence.
 */
export function failureNoticeSync(language?: string | null): string {
  const r = lastReachability();
  if (r && Date.now() - r.at < 20_000) return failureNoticeFor(r.verdict, language);
  return CADDIE_NOTICE_ON_US[safeLang(language)];
}
