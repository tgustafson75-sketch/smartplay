import * as fs from 'fs';
import * as path from 'path';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim — the day-one concept) — "then actually being able to talk about courses that
 * aren't within our thing and use the tools within our app and APIs to go: okay, I was thinking
 * about going to play some course in Nevada, and Caddie knows that course, and we talk about it
 * relative to my game. And then you could say, hey, well, let's pull that up into my course engine."
 *
 * Half of that worked. lookup_course / lookup_hole have fetched any public US course for a long
 * time. The other half did not exist: services/courseDownloadEngine has pulled a course's geometry,
 * content, intelligence and imagery into offline availability since 08-06, and its only three
 * callers were ARRIVING at a course, PICKING one to play, and STARTING a round. A course he was only
 * thinking about had no way in — the conversation could reach the data and never the engine.
 */
describe('a course he is only thinking about can reach the course engine', () => {
  const tools = read('api/_brainTools.ts');

  it('the brain has a tool for it', () => {
    expect(tools).toMatch(/name: 'download_course'/);
  });

  it('and it is routed to the client, not silently dropped', () => {
    const ui = tools.slice(tools.indexOf('UI_TOOLS = new Set('), tools.indexOf(']);', tools.indexOf('UI_TOOLS = new Set(')));
    expect(ui).toMatch(/'download_course'/);
  });

  /**
   * BOTH dispatchers. app/(tabs)/caddie.tsx is the tab-mounted twin of
   * services/voice/conversationalToolDispatch, and a tool wired in only one of them is a tool the
   * caddie confirms on one surface and silently drops on the other.
   */
  it.each([
    ['services/voice/conversationalToolDispatch.ts'],
    ['app/(tabs)/caddie.tsx'],
  ])('%s dispatches it', (file) => {
    expect(read(file)).toMatch(/case 'download_course'/);
  });

  it('both dispatchers call the engine that already does the work', () => {
    for (const f of ['services/voice/conversationalToolDispatch.ts', 'app/(tabs)/caddie.tsx']) {
      const c = read(f);
      const block = c.slice(c.indexOf("case 'download_course'"), c.indexOf("case 'download_course'") + 1600);
      expect(block).toMatch(/courseDownloadEngine/);
      expect(block).toMatch(/downloadCourse\(/);
      // `fresh` is why the engine returns it — a caller must not claim a download that did not
      // happen, which is the bug the arrival toast shipped with.
      expect(block).toMatch(/\bfresh\b/);
    }
  });

  it('the typed action carries what the engine needs', () => {
    expect(read('types/toolAction.ts')).toMatch(/type: 'download_course'; name: string; course_id\?: string/);
  });

  /**
   * Consent is the design, not a nicety: this is the app going and fetching something on his
   * behalf. The standing rule everywhere else in this prompt is offer once, then wait for a yes.
   */
  it('is gated on an explicit yes in both the tool description and the prompt', () => {
    const desc = tools.slice(tools.indexOf("name: 'download_course'"), tools.indexOf("name: 'download_course'") + 1400);
    expect(desc).toMatch(/ONLY after the player explicitly agrees/);
    expect(desc).toMatch(/Never call this unprompted/);

    const kevin = read('api/kevin.ts');
    expect(kevin).toMatch(/ADDING A COURSE — OFFER, THEN WAIT/);
    expect(kevin).toMatch(/Call download_course only on an explicit yes/);
  });

  /**
   * The other half of what he asked for: a course is DISCUSSED against his game, not recited. The
   * prompt previously said "translate yardages and pars into friendly, conversational form", which
   * is a scorecard with a nicer voice.
   */
  it('the prompt tells the caddie to read a course against this player', () => {
    const kevin = read('api/kevin.ts');
    expect(kevin).toMatch(/A COURSE IS DISCUSSED RELATIVE TO THEIR GAME, NEVER RECITED/);
    expect(kevin).toMatch(/Never invent a course's character/);
  });
});
