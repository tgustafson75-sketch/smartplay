/**
 * 2026-07-30 (Tim — "Serena has two speaking things racing… the old 'here when you're ready, just tap
 * to chat' needs to go for all caddies"). The caddie tab plays a proactive app-open opener once per
 * process (app/(tabs)/caddie.tsx, guarded by a module flag). A persona SWITCH fires its OWN unified
 * handoff (the bundled per-persona opener in store/settingsStore.setCaddiePersonality). On a fresh
 * launch + immediate "switch to Serena" the two stack — the app-open opener resolves LATER (after
 * awaitGreetingComplete / its 10s net) and speaks after the handoff, reading as a race.
 *
 * This tiny cross-module flag lets the switch (in the store, which can't import the route file) CLAIM
 * the opener slot so a not-yet-spoken app-open opener stands down. Zero deps → importable anywhere with
 * no circular risk. The caddie opener effect ORs isOpenerClaimed() into its existing guard.
 */
let openerClaimed = false;

/** Mark the one-per-process opener slot as taken (a switch handoff, or the opener itself). */
export function claimOpenerSlot(): void {
  openerClaimed = true;
}

/** True once the opener slot has been claimed this process. */
export function isOpenerClaimed(): boolean {
  return openerClaimed;
}

