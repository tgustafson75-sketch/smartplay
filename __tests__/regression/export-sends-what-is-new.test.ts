/**
 * 2026-08-29 — a manual issue-log export must send what is NEW.
 *
 * Tim tapped Send and got five entries: a Jul 18 empty-transcript that works as designed, an Aug 7
 * SmartMotion crash fixed on Aug 9, and an Aug 28 TTS drop fixed that afternoon. Three closed
 * defects arriving as a live pile, with the one genuinely new entry indistinguishable among them.
 *
 * `buildIssueLogBody` sent every retained reportable entry and knew nothing about what had already
 * gone, while `exportAllIssues` set `lastExportedAt` right afterwards — so the marker was written
 * and never read. `OwnerIssueLogPrompt` had been counting the right thing all along to decide when
 * to nudge ("5 piled up") and then sent forty.
 *
 *      THE COUNT THE TESTER IS SHOWN AND THE PAYLOAD THEY SEND ARE THE SAME SET.
 *
 * The first export still sends everything, and nothing is deleted from the device.
 */

import { useIssueLogStore } from '../../store/issueLogStore';
import { buildIssueLogBody, exportAllIssues } from '../../services/issueLogExport';

const ctx = {
  route: 'caddie', persona: 'kevin', isRoundActive: false,
  courseId: null, currentHole: null, appVersion: '1.0.0',
} as never;

const OLD = 1_700_000_000_000;
const NEW = OLD + 60 * 60 * 1000;

const entry = (id: string, timestamp: number, text: string) => ({
  id, timestamp, text, kind: 'voice_silent_fail' as const, stage: 'x', details: {}, context: ctx,
});

const seed = (lastExportedAt: number) => {
  useIssueLogStore.setState({
    entries: [
      entry('n1', NEW, 'voice_silent_fail: the new one'),
      entry('o1', OLD, 'voice_silent_fail: the closed one'),
      entry('o2', OLD - 1000, 'voice_silent_fail: the other closed one'),
    ],
    lastExportedAt,
  } as never);
};

describe('the manual export carries only what has not been sent', () => {
  it('excludes entries from before the last export', () => {
    seed(OLD + 1);
    const { body, count } = buildIssueLogBody();
    expect(count).toBe(1);
    expect(body).toContain('the new one');
    expect(body).not.toContain('the closed one');
    expect(body).not.toContain('the other closed one');
    // The header count must agree with what is actually in the body — the two disagreeing is the
    // original defect in miniature.
    expect(body).toContain('Entries: 1');
  });

  it('still sends everything on a first export', () => {
    seed(0);
    const { count, body } = buildIssueLogBody();
    expect(count).toBe(3);
    expect(body).toContain('the closed one');
  });

  it('treats a missing marker as a first export rather than sending nothing', () => {
    seed(0);
    useIssueLogStore.setState({ lastExportedAt: undefined } as never);
    expect(buildIssueLogBody().count).toBe(3);
  });

  it('reports "nothing new" as its own outcome, not as a failure', async () => {
    seed(NEW + 1);
    expect(buildIssueLogBody().count).toBe(0);
    // The caller alerts "Export failed" on 'failed'; saying that when everything already went is
    // telling a tester something broke.
    await expect(exportAllIssues()).resolves.toBe('nothing_new');
  });

  it('leaves the device log untouched — filtering is about the payload, not retention', () => {
    seed(OLD + 1);
    buildIssueLogBody();
    expect(useIssueLogStore.getState().entries.length).toBe(3);
  });
});
