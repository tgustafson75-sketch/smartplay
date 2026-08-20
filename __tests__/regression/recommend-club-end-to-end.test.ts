/**
 * `recommend_club` — the whole chain, proved rather than assumed.
 *
 * 2026-08-19. Tim: "it's saying recommend_club is never called, and I don't know how that's the case
 * because we've been working on club shape, logic, distance forever… these things have to work."
 *
 * Both were true at once. The tool DID work — on the first turn of a conversation. It did not exist
 * on the brain that answers FOLLOW-UP turns (api/kevin), so "what club here?" recorded the advice and
 * "what about into the wind?" recorded nothing. Club logic was never broken; the follow-up half of it
 * was missing, which is why months of work on distances and shapes never surfaced the gap.
 *
 * That is now the THIRD seam this same tool has been dropped at (service dispatcher 08-08, Caddie tab
 * 08-17, kevin brain 08-19). Every one was invisible to the compiler because the payload had no type.
 * These tests pin the chain end to end AND the type parity that ends the class.
 */
import { dispatchConversationalToolActions } from '../../services/voice/conversationalToolDispatch';
import { resolveShotClub } from '../../services/shotClubResolver';
import { useRoundStore } from '../../store/roundStore';

const startRound = () => {
  const r = useRoundStore.getState();
  r.clearPendingKevinRec();
  useRoundStore.setState({ isRoundActive: true, currentHole: 1, club: null, clubSetAt: null });
};

describe('recommend_club reaches the shot record', () => {
  beforeEach(startRound);

  it('a spoken recommendation is stamped as advice with a timestamp', () => {
    dispatchConversationalToolActions([{ type: 'recommend_club', club: '8 iron', shape: 'fade' } as never]);
    const rec = useRoundStore.getState().pendingKevinRec;
    expect(rec).not.toBeNull();
    expect(rec!.club).toBe('8 iron');
    expect(rec!.shape).toBe('fade');
    expect(rec!.kind).toBe('spoken');
    // The freshness window the resolver arbitrates on is useless without this.
    expect(typeof rec!.at).toBe('number');
    expect(rec!.at).toBeGreaterThan(0);
  });

  it('hitting the advised club records the advice AND scores adherence', () => {
    dispatchConversationalToolActions([{ type: 'recommend_club', club: '8 iron' } as never]);
    const resolved = resolveShotClub('8 iron');
    expect(resolved.recClub).toBe('8 iron');   // what the caddie said → kevin_rec_club
    expect(resolved.adhered).toBe(true);       // → kevin_adhered
  });

  it('hitting a different club still records the advice, and scores non-adherence', () => {
    dispatchConversationalToolActions([{ type: 'recommend_club', club: '8 iron' } as never]);
    const resolved = resolveShotClub('7 iron');
    expect(resolved.recClub).toBe('8 iron');
    expect(resolved.adhered).toBe(false);
  });

  it('an app-INFERRED club is attributed but never scored as advice followed', () => {
    // queryStatusHandler stamps a distance proxy through the same slot. Scoring adherence on it
    // would credit the caddie for advice it never gave.
    useRoundStore.getState().setPendingKevinRec({ club: '9 iron', shape: null, aimPoint: null, kind: 'inferred' });
    const resolved = resolveShotClub('9 iron');
    expect(resolved.recClub).toBeNull();
    expect(resolved.adhered).toBeNull();
  });

  it('does nothing off-round, and never throws', () => {
    useRoundStore.setState({ isRoundActive: false });
    useRoundStore.getState().clearPendingKevinRec();
    expect(() => dispatchConversationalToolActions([{ type: 'recommend_club', club: '8 iron' } as never])).not.toThrow();
    expect(useRoundStore.getState().pendingKevinRec).toBeNull();
  });
});

describe('type parity — the guard that ends the class', () => {
  it('every UI_TOOL the brain can emit has a ToolAction member', () => {
    const fs = require('fs'), path = require('path');
    const brain = fs.readFileSync(path.resolve(__dirname, '../../api/_brainTools.ts'), 'utf-8');
    const union = fs.readFileSync(path.resolve(__dirname, '../../types/toolAction.ts'), 'utf-8');

    const uiBlock = brain.slice(brain.indexOf('UI_TOOLS = new Set('), brain.indexOf(']);', brain.indexOf('UI_TOOLS = new Set(')));
    const uiTools: string[] = (uiBlock.match(/'([a-z_]+)'/g) ?? []).map((q: string) => q.replace(/'/g, ''));
    expect(uiTools.length).toBeGreaterThan(15); // sanity: we actually parsed the set

    const typed = new Set<string>((union.match(/type: '([a-z_]+)'/g) ?? []).map((q: string) => q.replace(/type: '|'/g, '')));
    const untyped = uiTools.filter((t) => !typed.has(t));

    // recommend_club and register_bag were the ONLY two missing, and the only two ever dropped.
    expect(untyped).toEqual([]);
  });
});

/**
 * 2026-08-20 (Tim's OK on the prompt change; QA pass). The tool was reachable on both brains and
 * fired ZERO times — probed live before the fix, on the deployed brain:
 *     "I'm 150 out, what should I hit"    → "I'd go with a smooth 8-iron here."   tool_actions: []
 *     "165 to the pin into a little wind" → "Sounds like a solid 7 iron."          tool_actions: []
 * Explicit advice every time, nothing recorded. Reachability was never the problem; INSTRUCTION was.
 */
describe('the caddie is told to record the club it advises', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const readApi = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../../', rel), 'utf-8');

  it('the instruction lives in ONE shared block, not hand-copied per brain', () => {
    const brain = readApi('api/_brain.ts');
    expect(brain).toMatch(/export function clubAdviceBlock\(\): string/);
    // kevin.ts and pipecat-turn.ts drifted by 2 tools and ~255 description lines while each
    // hand-maintained its own prompt copy — and the FOLLOW-UP turn is exactly where this tool went
    // missing before. Shared construction is what makes that drift impossible rather than unlikely.
    for (const f of ['api/kevin.ts', 'api/pipecat-turn.ts']) {
      expect(readApi(f)).toMatch(/\$\{clubAdviceBlock\(\)\}/);
    }
  });

  it('the instruction says to call it IN ADDITION to answering, and names the tool', () => {
    const brain = readApi('api/_brain.ts');
    const block = brain.slice(brain.indexOf('export function clubAdviceBlock'));
    const body = block.slice(0, block.indexOf('\n}'));
    expect(body).toMatch(/recommend_club/);
    // The failure mode is the model treating a spoken answer as a complete turn. The prompt has to
    // say the tool is ADDITIONAL, or the tool description's own "IN ADDITION" keeps losing.
    expect(body).toMatch(/never\s+replaces|IN ADDITION|additional/i);
    // ...and it must NOT tell the caddie to change what it says out loud. A prompt that alters the
    // spoken answer to satisfy a data tool would trade the thing players hear for telemetry.
    expect(body).toMatch(/exactly as you normally would|does NOT change what you say/i);
  });

  it('still tells the caddie when NOT to call it', () => {
    const brain = readApi('api/_brain.ts');
    const block = brain.slice(brain.indexOf('export function clubAdviceBlock'));
    const body = block.slice(0, block.indexOf('\n}'));
    // Over-firing is its own defect: "how far does my 7 go" is club TALK, not advice on a shot, and
    // recording it as advice would poison adherence with recommendations never actually made.
    expect(body).toMatch(/how far does my 7 go|general club talk/i);
  });
});
