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
import { CADDIE_NOTICE_CONNECTION, CADDIE_NOTICE_OFFLINE, CADDIE_NOTICE_ON_US, CADDIE_NOTICE_SAVED_OFFLINE, CADDIE_NOTICE_SCORE_NOT_LOGGED } from './caddieAckLines';

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
  const local = localAnswer(opts.heard, lang);
  if (local) return record({ text: local, source: 'local_answer', verdict: null });

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

/**
 * Rule 1 alone, synchronous and network-free: the question answered from real local data (GPS, bag,
 * green, bundled knowledge), or null. A "no data" reply ("I don't have a wind reading") answers
 * nothing, so it is null too — the caller then says why the turn failed.
 *
 * `kept`: the score in the words was already saved as an offline note (keepScoreIfProvenOffline), so the
 * line is the saved-offline line, not "say it again", with whatever answer is left after it.
 */
export function localAnswer(heard: string | null | undefined, language?: string | null, kept = false): string | null {
  const q = heard?.trim();
  if (!q) return null;
  const lang = safeLang(language);
  /**
   * 2026-10-31 (Brain recheck r19, BRAIN-B) — a score said with a question was held for the brain, which is
   * the one turn that failed, so the score is not on the card. Said first, with whatever answer is left.
   */
  const unlogged = kept ? CADDIE_NOTICE_SAVED_OFFLINE[lang] : scoreNotLoggedLine(q, lang);
  try {
    const text = (require('./offlineCaddie') as typeof import('./offlineCaddie')).answerOffline(q, lang)?.text?.trim();
    const answer = text && !(require('./localStatusResponder') as typeof import('./localStatusResponder')).isNoDataReply(text, lang) ? text : null;
    return [unlogged, answer].filter((x): x is string => !!x).join(' ') || null;
  } catch {
    return unlogged; // the local answer is a bonus, never a dependency
  }
}

/**
 * 2026-10-31 (Brain recheck r20, BRAIN-R20-1) — A SCORE SAID WITH A QUESTION IS KEPT BEFORE ANYTHING IS SAID.
 *
 * localAnswer returned the "didn't get your score down" notice for this utterance, and both mic paths returned
 * on it, so captureOfflineStatement never ran: a proven-offline "I got a 5, what's my play" lost the 5, and the
 * player was told to repeat it while still offline. When the phone can PROVE it is offline, the words are kept
 * as an offline note first and the caller speaks the saved line (localAnswer(…, true)). Online, nothing is kept
 * and the notice says what is true. Only a score-shaped question probes the network; every other utterance
 * returns false with no wait. Never throws.
 */
export async function keepScoreIfProvenOffline(heard: string | null | undefined): Promise<boolean> {
  const q = heard?.trim();
  if (!q || !scoreSaidUnlogged(q)) return false;
  try {
    if (!isProvenOffline((await probeReachability()).verdict)) return false;
    return (require('./voiceLogService') as typeof import('./voiceLogService')).captureOfflineStatement(q);
  } catch {
    return false;
  }
}

function scoreSaidUnlogged(q: string): boolean {
  try {
    return (require('./localIntentPrecheck') as typeof import('./localIntentPrecheck')).scoreSaidButNotLogged(q);
  } catch {
    return false;
  }
}

function scoreNotLoggedLine(q: string, lang: Lang): string | null {
  return scoreSaidUnlogged(q) ? CADDIE_NOTICE_SCORE_NOT_LOGGED[lang] : null;
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
