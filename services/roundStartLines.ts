/**
 * 2026-09-23 — what to say when the map did not load, from what the round ACTUALLY holds. Both lines
 * used to promise "scorecard yardages" unconditionally, including on a round that started with zero
 * holes (course record unreachable, or a card with no tees) — so the caddie claimed numbers it did
 * not have, par unknown on every hole. [[state-what-you-measured-not-what-you-intended]]
 */
export function noMapLine(courseLabel: string, startedWithoutHoles: boolean): string {
  return startedWithoutHoles
    ? `I couldn't load ${courseLabel}'s scorecard or its map, so I don't have hole yardages or pars yet. Keep score as normal and tell me distances you see — I won't guess.`
    : `Heads up — I couldn't pull full GPS mapping for ${courseLabel}. You've got scorecard yardages, and I'll flag any distance I can't confirm rather than guess.`;
}

