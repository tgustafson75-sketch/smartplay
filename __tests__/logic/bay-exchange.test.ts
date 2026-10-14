/**
 * SmartBay exchange v1 (services/bayExchange). The fixtures are byte copies of
 * smartbay-ai/docs/exchange/*.example.json, which smartbay-ai's own tests also parse: the two copies
 * of the parser must accept the same files.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPlayerExport, importBayLesson, parseBayLesson, parsePlayer, tendenciesFrom, bayLessonLabel } from '../../services/bayExchange';
import { usePracticeSessionStore } from '../../store/practiceSessionStore';
import { useBayLessonStore } from '../../store/bayLessonStore';
import { useSwingSessionStore } from '../../store/swingSessionStore';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));
jest.mock('../../services/installId', () => ({ getInstallId: async () => 'spc-test' }));

const fixture = (f: string) => readFileSync(join(__dirname, '..', 'fixtures', 'bayExchange', f), 'utf8');
const lessonJson = fixture('bay-lesson.example.json');

beforeEach(() => {
  usePracticeSessionStore.setState({ history: [] });
  useBayLessonStore.setState({ lessons: [] });
});

describe('bay lesson import', () => {
  it('parses the documented example', () => {
    const x = parseBayLesson(lessonJson);
    expect(x?.lesson.targetFault).toBe('early_extension');
    expect(x?.lesson.drill?.name).toBe('Choke down');
  });

  it('writes exactly one practice record, dated at the lesson, labelled by the fix not the instructor', () => {
    const x = parseBayLesson(lessonJson)!;
    const r = importBayLesson(x, x.player!.playerId);
    expect(r).toEqual({ ok: true, label: 'SmartBay lesson · Early extension', duplicate: false });
    const h = usePracticeSessionStore.getState().history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: 'focus', focus: null, environment: 'bay', swingCount: 11, startedAt: x.lesson.at, drillId: null });
    expect(h[0].label).not.toMatch(/tank/i);
    expect(bayLessonLabel(x)).not.toMatch(/tank|kevin|serena/i);
    expect(h[0].swings.map((s) => s.tempoRatio)).toEqual([2.4, 3]);
    expect(useBayLessonStore.getState().lessons).toHaveLength(1);
  });

  it('importing the same file twice adds nothing', () => {
    const x = parseBayLesson(lessonJson)!;
    importBayLesson(x, x.player!.playerId);
    expect(importBayLesson(x, x.player!.playerId)).toMatchObject({ ok: true, duplicate: true });
    expect(usePracticeSessionStore.getState().history).toHaveLength(1);
  });

  it('refuses a lesson paired to a different player', () => {
    const x = parseBayLesson(lessonJson)!;
    expect(importBayLesson(x, 'someone-else')).toEqual({ ok: false, reason: 'other_player' });
    expect(usePracticeSessionStore.getState().history).toHaveLength(0);
  });

  it('rejects anything that is not exactly the format', () => {
    const j = JSON.parse(lessonJson);
    expect(parseBayLesson('{')).toBeNull();
    expect(parseBayLesson({ ...j, version: 2 })).toBeNull();
    expect(parseBayLesson({ ...j, lesson: { ...j.lesson, targetFault: 'shank' } })).toBeNull();
    expect(parseBayLesson({ ...j, source: { ...j.source, coach: '' } })).toBeNull();
  });
});

describe('player export', () => {
  it('parses the documented example', () => {
    expect(parsePlayer(fixture('player.example.json'))?.tendencies[0]).toEqual({ fault: 'over_the_top', count: 23 });
  });

  it('counts this player’s faults only, worst first, skipping non-faults', () => {
    const t = tendenciesFrom(
      [
        { player_id: 'me', primary_issue: { primary_fault: 'casting' } },
        { player_id: 'me', primary_issue: { primary_fault: 'over_the_top' } },
        { player_id: 'me', primary_issue: { primary_fault: 'over_the_top' } },
        { player_id: 'me', primary_issue: { primary_fault: 'no_dominant_fault' } },
        { player_id: 'guest', primary_issue: { primary_fault: 'sway' } },
      ],
      'me',
    );
    expect(t).toEqual([{ fault: 'over_the_top', count: 2 }, { fault: 'casting', count: 1 }]);
  });

  it('the export this app builds passes the bay parser', async () => {
    useSwingSessionStore.setState({ sessionHistory: [{ player_id: 'account_holder', primary_issue: { primary_fault: 'casting' } }] } as never);
    const built = await buildPlayerExport(1);
    expect(built.source).toEqual({ app: 'smartplay-caddie', appVersion: '9.9.9' });
    expect(built.player.installId).toBe('spc-test');
    expect(built.tendencies).toEqual([{ fault: 'casting', count: 1 }]);
    expect(parsePlayer(JSON.stringify(built))).toEqual(built);
  });
});
