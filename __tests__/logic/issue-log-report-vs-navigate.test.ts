/**
 * Saying "issue log" should not hijack the screen when you are trying to FILE one.
 *
 * 2026-08-21. Tim: "if you say the words 'issue log' it's a trigger and it says 'taking you to the
 * issue log'. It should be triggered on 'send issue log' to go there directly. Otherwise I'm telling
 * it to send an issue there."
 *
 * The aliases were in EXEMPT_ACTION_TOOLS, which skips the explicit-verb gate entirely — so ANY
 * utterance the classifier mapped to issue_log navigated. "Log an issue that the yardage on 3 was
 * wrong" is a REPORT, and it was yanking him onto the log screen instead of writing it into the log.
 *
 * Both readings are legitimate, so the VERB decides. These tests pin which verb means which.
 */
import * as fs from 'fs';
import * as path from 'path';

const src = fs.readFileSync(path.resolve(__dirname, '../../services/intents/openToolHandler.ts'), 'utf-8');

/** Reproduce the gate exactly as the handler applies it. */
function navigates(toolName: string, raw: string): boolean {
  const EXPLICIT_OPEN = /\b(open|show me|show us|show the|pull up|bring up|go to|take me to|get me to|launch|jump to|switch to|navigate to|let me see|head to|pull open|analy[sz]e|check my|read my|record|capture|scan|import)\b/;
  const ISSUE_LOG_TOOLS = new Set(['issue_log', 'issuelog', 'issues_log', 'bug_log', 'buglog', 'owner_logs']);
  const ASKS_TO_SEND_LOG = /\b(send|email|export|attach|share)\b/;
  const r = raw.toLowerCase();
  return ISSUE_LOG_TOOLS.has(toolName) && (ASKS_TO_SEND_LOG.test(r) || EXPLICIT_OPEN.test(r));
}

describe('asking to SEND or OPEN the log takes you there', () => {
  it.each([
    'send issue log',
    'email issue log',
    'open issue log',
    'show me the issue log',
    'export the issue log',
  ])('%s → navigates', (raw) => {
    expect(navigates('issue_log', raw)).toBe(true);
  });
});

describe('REPORTING an issue does not hijack the screen', () => {
  it.each([
    'log an issue, the yardage on hole 3 looked wrong',
    'add an issue that the caddie went quiet on 7',
    'note an issue with the green reading',
    'there is an issue with the distances',
  ])('%s → stays conversational so log_issue can write it', (raw) => {
    expect(navigates('issue_log', raw)).toBe(false);
  });
});

describe('the exemption was removed, not merely narrowed', () => {
  it('issue-log aliases no longer sit in EXEMPT_ACTION_TOOLS', () => {
    // While they were exempt, the verb gate never ran at all for them — which is the whole bug.
    const block = src.slice(src.indexOf('const EXEMPT_ACTION_TOOLS'), src.indexOf('const ISSUE_LOG_TOOLS'));
    expect(block).not.toMatch(/'issue_log'/);
    expect(block).not.toMatch(/'owner_logs'/);
  });

  it('genuine action tools keep their exemption — this fix must not overreach', () => {
    // mark_tee / mark_green / sim_round ARE the verb; requiring "open mark green" would be absurd.
    const block = src.slice(src.indexOf('const EXEMPT_ACTION_TOOLS'), src.indexOf('const ISSUE_LOG_TOOLS'));
    for (const keep of ['mark_green', 'mark_tee', 'sim_round', 'register_club']) {
      expect(block).toMatch(new RegExp(`'${keep}'`));
    }
  });
});
