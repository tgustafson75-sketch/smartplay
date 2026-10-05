/**
 * 2026-10-04 (Tim, after an evening of uploads that failed with nothing in his issue log):
 *   "make sure that everything can be diagnostically checked in my issue log in owners tools from now
 *    on when i try smartmotion analysis or uploads in swing library"
 *   "all the upload settings like pov, dtl, club, player, etc was set correctly. Make sure those are
 *    all wired correctly. no band aids"
 *   "Once an uploaded video gets a high confidence finding successfully, it should be marked as
 *    essentially done … in terms of opening it and predicting action"
 *   "those [body / swing path] should be off by default and only activated … when user activates them"
 */
import fs from 'fs';
import path from 'path';
import { beginAnalysisTrace, traceStep, endAnalysisTrace, _resetAnalysisTracesForTest } from '../../services/analysisTrace';
import { useIssueLogStore } from '../../store/issueLogStore';
import { isAnalysisSettled } from '../../services/swing/analysisSettled';
import { swingerForSession } from '../../services/swing/sessionSwinger';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { useFamilyStore } from '../../store/familyStore';
import { derivePlayerId, OTHER_PLAYER_ID } from '../../store/swingSessionStore';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

beforeEach(() => { _resetAnalysisTracesForTest(); useIssueLogStore.setState({ entries: [] } as never); });

describe('every analysis leaves ONE trace in the issue log, timeline included', () => {
  it('a clean run is kept (Owner Tools → Analysis) but not flagged', () => {
    beginAnalysisTrace('t1', 'upload', { clip_s: 14.5 });
    traceStep('window chosen', { via: 'on_device', start_s: 5.6, end_s: 8.4 });
    traceStep('read 4 — analysis parsed', { detected_issue: 'over_the_top', confidence: 'high' });
    endAnalysisTrace('t1', { result: 'ok', issue: 'over_the_top', confidence: 'high' });
    const [e] = useIssueLogStore.getState().entries;
    expect(e.kind).toBe('analysis_trace');
    expect(e.details?.problem).toBe(false);
    expect((e.details?.timeline as string[]).join('\n')).toMatch(/window chosen · via=on_device start_s=5\.60 end_s=8\.40/);
  });

  it('a "successful" run that read the wrong thing is flagged from its own timeline (tentative / no frames)', () => {
    beginAnalysisTrace('t2', 'upload');
    traceStep('read 3 SKIP — no_frames (no usable frames extracted)');
    traceStep('TENTATIVE STAGE 4 — parsed', { confidence: 'low' });
    endAnalysisTrace('t2', { result: 'ok', issue: 'none', confidence: 'low' });
    const [e] = useIssueLogStore.getState().entries;
    expect(e.details?.problem).toBe(true);
    expect(e.text).toMatch(/PROBLEM/);
  });

  it('a run that never finishes still writes its trace', () => {
    jest.useFakeTimers();
    beginAnalysisTrace('t3', 'smartmotion');
    traceStep('find swing window');
    jest.advanceTimersByTime(4 * 60_000 + 10);
    const [e] = useIssueLogStore.getState().entries;
    expect(e.details?.result).toBe('never_finished');
    expect(e.details?.problem).toBe(true);
    jest.useRealTimers();
  });

  it('the breadcrumbs the analysis already writes feed it — V6, uploadLog, the finder, pose frames, the pipeline', () => {
    expect(code('services/poseDetection.ts')).toMatch(/traceStep\(msg\.replace\(\/\^STAGE \/, 'read '\), data \?\? null\)/);
    expect(code('services/uploadDiagnostic.ts')).toMatch(/traceStep\(`upload \$\{stage\}`/);
    expect(code('services/swing/analysisOrchestrator.ts')).toMatch(/traceStep\('window chosen'/);
    expect(code('services/swing/analysisPipeline.ts')).toMatch(/traceStep\(`\$\{stage\} \$\{status\}`/);
    expect(code('services/swing/orchestrator/uploadRun.ts')).toMatch(/beginAnalysisTrace\(traceId, 'upload'/);
    expect(code('app/swinglab/smartmotion.tsx')).toMatch(/beginAnalysisTrace\(traceId, 'smartmotion'/);
  });

  it('it goes out with Send Report as a readable timeline, and auto-sends only when it went wrong', () => {
    const ex = code('services/issueLogExport.ts');
    expect(ex).toMatch(/'analysis_trace',\s*\]\);/);
    expect(ex).toMatch(/return e\.kind !== 'analysis_trace' \|\| e\.details\?\.problem === true;/);
    expect(ex).toMatch(/timeline\.join\('\\n    '\)/);
    expect(code('app/owner-logs.tsx')).toMatch(/label: 'Analysis'/);
  });
});

describe('the upload settings reach every analysis of a saved swing', () => {
  beforeEach(() => {
    usePlayerProfileStore.setState({ handedness: 'right', firstName: 'Tim', handicap_index: 8, dominantMiss: 'right', experienceContext: 'competitive' } as never);
    useFamilyStore.setState({ members: [{ id: 'm-matt', firstName: 'Matt', handedness: 'left', approximate_handicap: 22 }], active_member_id: null } as never);
  });

  it('self → the profile; a family member → THEIR hand and handicap, not Tim\'s; a guest → unknown hand', () => {
    expect(swingerForSession({ player_id: derivePlayerId(), upload: { swinger: 'Me' } } as never))
      .toEqual(expect.objectContaining({ who: 'self', handedness: 'right', handicap: 8, dominantMiss: 'right' }));
    expect(swingerForSession({ player_id: 'm-matt', upload: { swinger: 'Matt' } } as never))
      .toEqual(expect.objectContaining({ who: 'member', handedness: 'left', handicap: 22, dominantMiss: null, firstName: 'Matt' }));
    expect(swingerForSession({ player_id: OTHER_PLAYER_ID, upload: { swinger: 'Bob' } } as never))
      .toEqual(expect.objectContaining({ who: 'guest', handedness: null, handicap: null, firstName: 'Bob' }));
  });

  it('the read sends the tagged golfer\'s hand, context and the language; the pose passes use the same hand', () => {
    const up = code('services/videoUpload.ts');
    expect(up).toMatch(/handedness: swinger\.handedness,/);
    expect(up).toMatch(/\.\.\.\(readLanguage \? \{ language: readLanguage \} : \{\}\),/);
    expect(up).toMatch(/first_name: swinger\.firstName,/);
    expect(up).not.toMatch(/resolveSwingerHandedness\(\)/);
    expect(code('app/swinglab/swing/[swing_id].tsx')).not.toMatch(/resolveSwingerHandedness\(\)/);
    // angle (DTL / face-on) and the tag were already wired; pin them so they stay
    expect(up).toMatch(/const uploadAngle = session\.upload\?\.angleOverride \?\? null;/);
    expect(up).toMatch(/swing_tag: swingTag,/);
  });
});

describe('a saved swing: settled, its windows, and what opening it does', () => {
  it('settled = ok with a HIGH-confidence named finding', () => {
    expect(isAnalysisSettled({ analysis_status: 'ok', primary_issue: { issue_id: 'over_the_top', confidence: 'high' } })).toBe(true);
    expect(isAnalysisSettled({ analysis_status: 'ok', primary_issue: { issue_id: 'over_the_top', confidence: 'low' } })).toBe(false);
    expect(isAnalysisSettled({ analysis_status: 'ok', primary_issue: { issue_id: 'smartmotion_observation', confidence: 'high' } })).toBe(false);
    expect(isAnalysisSettled({ analysis_status: 'failed', primary_issue: null })).toBe(false);
  });

  it('opening a settled swing does no analysis work; body and trace start OFF and nothing switches them on', () => {
    const d = code('app/swinglab/swing/[swing_id].tsx');
    expect(d).toMatch(/settledOnOpenRef\.current = isAnalysisSettled\(st\);\s*if \(settledOnOpenRef\.current\) return;/);
    expect(d).toMatch(/const \[showTrace, setShowTrace\] = useState\(false\);/);
    expect(d).toMatch(/const \[showSkeleton, setShowSkeleton\] = useState\(false\);/);
    expect((d.match(/setShowTrace\(/g) ?? []).length).toBe(1);        // the player's toggle only
    expect((d.match(/setShowSkeleton\(/g) ?? []).length).toBe(1);
  });

  it('only a window the PLAYER chose survives a re-analyze; the finder\'s own answer is re-found', () => {
    const run = code('services/swing/orchestrator/uploadRun.ts');
    expect(run).toMatch(/if \(shot\.clipWindowSource === 'user' && shot\.clipStartSeconds != null/);
    expect(run).toMatch(/setShotClipBoundaries\(input\.sessionId, shot\.id, w\.startSec, w\.endSec, w\.impactSec, 'auto'\)/);
    expect(code('app/swinglab/trim.tsx')).toMatch(/setShotClipBoundaries\(session_id, shot\.id, startSec, endSec, null, 'user'\)/);
    expect(code('app/swinglab/swing/[swing_id].tsx')).toMatch(/setShotClipBoundaries\(swing_id, shot\.id, startSec, endSec, center, 'user'\)/);
  });
});
