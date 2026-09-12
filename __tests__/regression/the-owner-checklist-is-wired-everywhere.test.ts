/**
 * 2026-09-09 (Tim: "put my checklists of to dos on the phone in owners tool with a reminder when I
 * open… And have it so the Caddie can read the reminder if I want. We should have done that months
 * ago") — FOUR SURFACES, AND A LIST THAT MUST BE ABLE TO GROW.
 *
 * The feature is only real if all of it is connected: a screen, a row that reaches it, a reminder
 * that fires on launch, and the caddie able to read it aloud. This sprint has spent most of its time
 * on features wired at three of four points, so this asserts all four.
 *
 * The subtle one is the SEED MERGE. The list is persisted (a tick must survive a round) and shipped
 * in code (a new session must be able to add items). A naive persisted store keeps the first seed
 * forever and silently ignores everything added later — a checklist that cannot receive new work,
 * which is worse than none because it looks complete.
 */
import fs from 'fs';
import path from 'path';
import { useOwnerChecklistStore } from '../../store/ownerChecklistStore';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('the list can grow without losing ticks', () => {
  it('ships items', () => {
    expect(useOwnerChecklistStore.getState().items.length).toBeGreaterThanOrEqual(5);
  });

  it('a tick is recorded with a timestamp, and unticking clears it', () => {
    const id = useOwnerChecklistStore.getState().items[0].id;
    useOwnerChecklistStore.getState().toggle(id);
    const on = useOwnerChecklistStore.getState().items.find(i => i.id === id)!;
    expect(on.done).toBe(true);
    expect(typeof on.doneAt).toBe('number');
    useOwnerChecklistStore.getState().toggle(id);
    const off = useOwnerChecklistStore.getState().items.find(i => i.id === id)!;
    expect(off.done).toBe(false);
    expect(off.doneAt).toBeNull();
  });

  it('rehydration MERGES the seed rather than trusting what was stored', () => {
    // The failure this prevents: a device that saw an older seed keeps it forever, so every item
    // added later is invisible and the list reads complete while work is missing.
    const src = code('store/ownerChecklistStore.ts');
    expect(src).toContain('onRehydrateStorage');
    expect(src).toContain('mergeSeed(state.items ?? [])');
    // Merge is driven by the SEED, so a removed item disappears and a new one appears.
    expect(src).toMatch(/return SEED\.map/);
    expect(src).toContain('done: prev?.done ?? false');
  });

  it('resetAll clears every tick — a fresh test round starts clean', () => {
    useOwnerChecklistStore.getState().toggle(useOwnerChecklistStore.getState().items[0].id);
    useOwnerChecklistStore.getState().resetAll();
    expect(useOwnerChecklistStore.getState().items.every(i => !i.done && i.doneAt === null)).toBe(true);
  });
});

describe('all four surfaces are connected', () => {
  it('the screen exists and gates on the OWNER at the render, not just the menu', () => {
    const screen = code('app/owner-checklist.tsx');
    expect(screen).toContain('isOwnerEmail(email)');
    expect(screen).toContain('Owner tools only.');
  });

  it('the route is in the owner-only gate list — voice and deep links reach routes too', () => {
    expect(code('app/_layout.tsx')).toContain("'/owner-checklist'");
  });

  it('Owner Tools reaches it, carrying the open count', () => {
    /**
     * 2026-09-11 — this used to require settings to push '/owner-checklist' DIRECTLY. The sixteen
     * owner routes were condensed into app/owner-console.tsx (Tim: "condense this into one card
     * that's more dashboard style"), so the hop moved. What has to stay true is the REACHABILITY
     * and the count: Tim must still see there is work without opening anything.
     */
    const settings = code('app/settings.tsx');
    expect(settings).toContain("router.push('/owner-console' as never)");
    // the open count still rides the settings row itself — that is the point of it
    expect(settings).toContain('checklistOpen');

    // ...and the console actually reaches the checklist.
    const consoleSrc = code('app/owner-console.tsx');
    expect(consoleSrc).toContain("'/owner-checklist'");
    expect(consoleSrc).toContain('useOwnerChecklistStore');
  });

  it('the launch reminder waits for the profile to HYDRATE before deciding', () => {
    // email is async-persisted: reading it at mount gives null on a cold boot, the owner check fails,
    // and the reminder never fires. Exactly the bug watchRoundSync had on 08-24.
    const layout = code('app/_layout.tsx');
    expect(layout).toContain('on your checklist — ask me to read it');
    expect(layout).toContain('usePlayerProfileStore.persist?.onFinishHydration');
  });
});

describe('the caddie can read it aloud', () => {
  const handler = code('services/intents/ownerChecklistHandler.ts');

  it('is registered in the router', () => {
    expect(code('services/intents/index.ts')).toContain('voiceCommandRouter.registerHandler(ownerChecklistHandler)');
  });

  it('the cloud classifier can emit it AND has prompt guidance beyond the enum line', () => {
    const api = read('api/voice-intent.ts');
    expect(api).toContain("'owner_checklist'");
    const withoutEnum = api.replace(/const INTENT_TYPE_ENUM = \[[\s\S]*?\] as const;/, '');
    expect(withoutEnum).toContain('owner_checklist');
  });

  it('reads only what is OUTSTANDING — reciting finished work buries the part that matters', () => {
    expect(handler).toContain('items.filter((i) => !i.done)');
  });

  it('caps what it speaks, because a spoken list past ~5 communicates nothing', () => {
    expect(handler).toContain('SPOKEN_CAP');
  });

  it('a non-owner falls THROUGH to the brain rather than being told a list exists', () => {
    expect(handler).toContain('owner_checklist:not_owner');
    expect(handler).toMatch(/success:\s*false[\s\S]{0,80}not_owner/);
  });
});

describe('the checklist survives a device swap', () => {
  it('the backup decision is explicit, as the allowlist guard demands', () => {
    expect(code('services/cloudSync/snapshot.ts')).toContain("'owner-checklist-v1'");
  });
});
