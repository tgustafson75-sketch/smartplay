/**
 * 2026-11-01 — THE GOLF ROUTINE IS REACHABLE FROM THE PRE-ROUND SCREEN.
 *
 * The routine was ported from SmartPump as a component and data module. A component that compiles but
 * is never mounted, or a Loosen Up step that ticks without the routine, is built-but-unreachable.
 * This pins the whole path: the data, the component, the screen that mounts it, the step completion
 * that follows from it, and the translation keys it reads.
 *
 * Comments are stripped before matching so the prose above cannot satisfy a guard.
 */
import fs from 'fs';
import path from 'path';
import { GOLF_PRE_ROUND_ROUTINE, golfRoutineComplete } from '../../services/practice/golfRoutine';

const ROOT = path.resolve(__dirname, '../..');
const code = (f: string) =>
  fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const screen = code('app/practice/preround.tsx');
const card = code('components/practice/GolfRoutineCard.tsx');
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/locales/en.json'), 'utf8'));

describe('the routine data', () => {
  it('has the three SmartPump-ported moves, mobility first', () => {
    expect(GOLF_PRE_ROUND_ROUTINE.map((m) => m.sourceExerciseId)).toEqual([
      'thoracicRotation',
      'hipMobility90',
      'pallofPress',
    ]);
    expect(GOLF_PRE_ROUND_ROUTINE.map((m) => m.group)).toEqual(['mobility', 'mobility', 'activation']);
  });

  it('is complete only when every move is checked', () => {
    expect(golfRoutineComplete(new Set())).toBe(false);
    expect(golfRoutineComplete(new Set(['thoracic-rotation', 'hip-mobility-90']))).toBe(false);
    expect(golfRoutineComplete(new Set(GOLF_PRE_ROUND_ROUTINE.map((m) => m.id)))).toBe(true);
  });
});

describe('the pre-round screen mounts the routine', () => {
  it('imports the component and the data', () => {
    expect(screen).toMatch(/import \{ GolfRoutineCard \} from '\.\.\/\.\.\/components\/practice\/GolfRoutineCard'/);
    expect(screen).toMatch(/GOLF_PRE_ROUND_ROUTINE/);
  });

  it('renders the card only for the stretch step, and only while the routine is open', () => {
    expect(screen).toMatch(/step\.kind === 'stretch' && routineOpen \? \(/);
    expect(screen).toMatch(/<GolfRoutineCard moves=\{GOLF_PRE_ROUND_ROUTINE\} done=\{routineDone\} onToggle=\{toggleRoutineMove\} \/>/);
  });

  it('the stretch step opens the routine instead of leaving for another tab', () => {
    const stretchCase = screen.slice(screen.indexOf("case 'stretch':"), screen.indexOf("case 'setup':"));
    expect(stretchCase).toMatch(/setRoutineOpen/);
    expect(stretchCase).not.toMatch(/goToTab/);
  });

  it('keeps the caddie one tap away, so the old route is not lost', () => {
    expect(screen).toMatch(/onPress=\{\(\) => goToTab\('caddie'\)\}/);
  });

  it('Loosen Up completes from the routine, not from a separate tick', () => {
    expect(screen).toMatch(/golfRoutineComplete\(routineDone\)/);
    expect(screen).toMatch(/next\.add\('stretch'\)/);
    expect(screen).toMatch(/next\.delete\('stretch'\)/);
  });

  it('resets routine progress with the plan, like every other step', () => {
    expect(screen).toMatch(/setCompleted\(new Set\(\)\); setRoutineDone\(new Set\(\)\);/);
  });
});

describe('the card is presentational and its strings exist', () => {
  it('takes its moves and done-set from props and owns no store', () => {
    expect(card).toMatch(/moves: readonly GolfRoutineMove\[\]/);
    expect(card).not.toMatch(/store\//);
  });

  it('every translation key the card and screen read is in en.json', () => {
    const golf = en.practice_preround.golf_routine;
    for (const key of ['group_mobility', 'group_activation', 'start', 'hide', 'ask_caddie']) {
      expect(typeof golf[key]).toBe('string');
    }
    const used = [...card.matchAll(/t\('practice_preround\.golf_routine\.(\w+)'\)/g), ...screen.matchAll(/t\('practice_preround\.golf_routine\.(\w+)'\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) expect(golf[key]).toBeDefined();
  });
});
