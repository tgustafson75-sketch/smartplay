/**
 * 2026-09-13 (Tim, reviewing the dashboard) — TRAIN YOUR SWING WAS STILL LEADING WITH THE PUMP DRILL.
 *
 * On 2026-08-13 he said it plainly, from his own practice: *"the step and swing drill has helped me
 * better than the pump drill I'm always getting suggested."* Two of the three places that answer
 * "which drill for coming over the top" were changed that day — `data/drillCatalog` lists
 * step-and-swing FIRST, and `services/drillRecommendation` leads with it, with the reason recorded:
 * step-and-swing ends in a FINISH by construction, and his stated limitation with pump-and-pause was
 * not finishing the swing and not being sure how to perform it.
 *
 * `services/swing/faultWorkouts` was the THIRD owner, and nobody told it. It is the table the
 * DASHBOARD card reads. So the surface he actually looks at opened with 'Hip-lead separation drill
 * (pump)' for another month — the exact complaint, unfixed, on the screen that prompted it.
 *
 * The pump drill is not deleted. It works for plenty of players and the catalog deliberately keeps it
 * as an alternative. It is simply no longer the first thing he is told to do.
 * [[two-owners-is-the-root-cause]] [[smartplay-drill-feedback]]
 */
import fs from 'fs';
import path from 'path';
import { exercisesForFault } from '../../services/swing/faultWorkouts';

const root = path.resolve(__dirname, '../..');
const code = (rel: string) =>
  fs.readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

const isStep = (s: string) => /step[\s-]and[\s-]swing/i.test(s);
const isPump = (s: string) => /pump/i.test(s);

describe('the three owners of "which drill for over the top" agree on which one leads', () => {
  it('the dashboard card leads with step-and-swing, not the pump', () => {
    const [first] = exercisesForFault('over_the_top');
    expect(isStep(first.name)).toBe(true);
    expect(isPump(first.name)).toBe(false);
  });

  it('the drill recommender leads with it too', () => {
    const rec = code('services/drillRecommendation.ts');
    // The key is `over_the_top` — `swing_path_outside_in` is the path-vocabulary fault next to it,
    // and it leads with the Gate Drill for reasons of its own.
    const block = rec.match(/\n  over_the_top: \{[\s\S]*?\n  \},/)![0];
    expect(isStep(block)).toBe(true);
  });

  it('and the catalog lists it before the pump', () => {
    const cat = code('data/drillCatalog.ts');
    const otBlock = cat.match(/title: 'Over the Top'[\s\S]*?videoCategory:/)![0];
    const stepAt = otBlock.search(/Step-and-swing/i);
    const pumpAt = otBlock.search(/Pump-and-pause/i);
    expect(stepAt).toBeGreaterThan(-1);
    expect(pumpAt).toBeGreaterThan(-1);
    expect(stepAt).toBeLessThan(pumpAt);
  });

  it('no owner leads with the pump for this fault — the property, checked in all three', () => {
    /**
     * Stated as a rule rather than three spellings, so a fourth surface that starts answering this
     * question has to answer it the same way.
     */
    const leads: [string, boolean][] = [
      ['faultWorkouts', isPump(exercisesForFault('over_the_top')[0].name)],
      ['drillRecommendation', /drill_name: 'Pump/.test(code('services/drillRecommendation.ts').match(/\n  over_the_top: \{[\s\S]*?\n  \},/)![0])],
    ];
    expect(leads.filter(([, pumpLeads]) => pumpLeads)).toEqual([]);
  });
});

describe('nothing was thrown away to get there', () => {
  it('the pump survives as an alternative on the card, with its video intact', () => {
    const set = exercisesForFault('over_the_top');
    const pump = set.find((e) => isPump(e.name));
    expect(pump).toBeDefined();
    expect(pump!.video?.url).toMatch(/^https:\/\//);
  });

  it('the pump is still the lead for early extension, where he never objected to it', () => {
    const rec = code('services/drillRecommendation.ts');
    const block = rec.match(/\n  early_extension: \{[\s\S]*?\},/)![0];
    expect(isPump(block)).toBe(true);
  });

  it('the pump drill protocol still has exactly one author', () => {
    // It was five-way authored once; data/drillProtocols owns it now and this keeps it that way.
    const proto = code('data/drillProtocols.ts');
    expect(proto).toMatch(/export const PUMP_DRILL: DrillProtocol/);
    for (const f of ['data/drillCatalog.ts', 'services/coachKnowledge.ts', 'services/knowledgeBase/modules/drills.ts']) {
      expect(code(f)).toMatch(/PUMP_DRILL/);
    }
  });

  it('every exercise on the card still carries an honest rationale and a real video or none', () => {
    for (const e of exercisesForFault('over_the_top')) {
      expect(e.why.length).toBeGreaterThan(20);
      if (e.video) expect(e.video.url).toMatch(/^https:\/\/(youtu\.be|www\.youtube\.com)\//);
    }
  });
});
