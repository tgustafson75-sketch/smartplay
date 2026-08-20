/**
 * `zoom_target` — the ask half of "tap or ask to zoom the pin flag", proved rather than assumed.
 *
 * 2026-08-20. Tim: "Should be able to tap or ask to zoom the pin flag and get a tight read. We could
 * be so much more connected and intelligent with the structure we have built."
 *
 * This tool is written against a known failure history rather than from scratch. `recommend_club` and
 * `register_bag` were the ONLY two UI tools that lacked a `ToolAction` member, and they were the only
 * two ever silently dropped — three separate seams between them, every one invisible to the compiler
 * because the payload had no type. So the type-parity assertion below is not bookkeeping; it is the
 * guard that ends that class, and it covers every UI tool rather than just this one.
 *
 * And `recommend_club` taught the other lesson: reachable is not called. It was live on 5/5 probes
 * across both brains and fired zero times, because nothing in the prompt told the model to use it.
 * So this tool ships WITH its instruction, and the test asserts the description actually contains
 * trigger phrases a player would say.
 */
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import {
  subscribeSmartFinderCommand,
  setSmartFinderActive,
  type SmartFinderCommand,
} from '../../services/smartFinderCommandBus';
import * as fs from 'fs';
import * as path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

describe('zoom_target reaches the rangefinder', () => {
  let seen: SmartFinderCommand[];
  let unsub: () => void;

  beforeEach(() => {
    seen = [];
    unsub = subscribeSmartFinderCommand(c => seen.push(c));
    setSmartFinderActive(true);
  });
  afterEach(() => { unsub(); setSmartFinderActive(false); });

  it('an open rangefinder is nudged directly, with "in" as the default', () => {
    dispatchConversationalToolActions([{ type: 'zoom_target' } as never]);
    expect(seen).toEqual(['zoomIn']);
  });

  it('carries the direction the player actually asked for', () => {
    dispatchConversationalToolActions([{ type: 'zoom_target', level: 'out' } as never]);
    dispatchConversationalToolActions([{ type: 'zoom_target', level: 'reset' } as never]);
    expect(seen).toEqual(['zoomOut', 'zoomReset']);
  });

  it('a CLOSED rangefinder does not swallow the command', () => {
    // The screen is not mounted, so an immediate emit would land in an empty listener set and the
    // player would have to ask twice. The dispatcher must open SmartFinder and emit after it mounts.
    setSmartFinderActive(false);
    expect(() => dispatchConversationalToolActions([{ type: 'zoom_target' } as never])).not.toThrow();
    expect(seen).toEqual([]); // nothing yet — it is deferred, not dropped
    const dispatch = read('services/voice/conversationalToolDispatch.ts');
    const zoomCase = dispatch.slice(dispatch.indexOf("case 'zoom_target'"));
    expect(zoomCase).toMatch(/gatedOpen\('smartfinder'/);
    expect(zoomCase.slice(0, zoomCase.indexOf('break;'))).toMatch(/setTimeout/);
  });
});

describe('the drop class stays closed', () => {
  // Every UI tool must be declared, dispatchable, AND typed. The first two are already covered by
  // voice-intent-parity; the THIRD is the one that actually did the damage, and nothing asserted it.
  it('every UI tool has a ToolAction member', () => {
    const tools = read('api/_brainTools.ts');
    const uiSet = tools.match(/export const UI_TOOLS = new Set\(\[([\s\S]*?)\]\);/);
    if (!uiSet) throw new Error('UI_TOOLS not found in api/_brainTools.ts');
    const uiTools = [...uiSet[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);

    const contract = read('types/toolAction.ts');
    const untyped = uiTools.filter(t => !new RegExp(`type: '${t}'`).test(contract));
    expect(untyped).toEqual([]);
  });

  it('zoom_target is declared on the one brain-tool owner, so both brains get it', () => {
    // kevin.ts and pipecat-turn.ts drifted by 2 tools and ~255 description lines before
    // api/_brainTools.ts became the single owner — turn 1 and the follow-up ran different tool sets.
    const tools = read('api/_brainTools.ts');
    expect(tools).toMatch(/name: 'zoom_target'/);
    expect(tools).toMatch(/'zoom_target',/); // and it is in UI_TOOLS, not just declared
  });

  it('ships with an instruction, because reachable is not called', () => {
    const tools = read('api/_brainTools.ts');
    const def = tools.slice(tools.indexOf("name: 'zoom_target'"));
    const description = def.slice(0, def.indexOf('parameters:'));
    // Phrases a player would actually say, not a restatement of the function name.
    expect(description).toMatch(/zoom in on the pin|zoom in on the flag/i);
    // And it must say what it does NOT do — the yardage is GPS geometry, not pixels, so a zoom
    // must never read as "now the distance is more accurate".
    expect(description).toMatch(/does not change the measured yardage/i);
  });
});
