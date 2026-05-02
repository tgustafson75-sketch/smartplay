/**
 * Phase T — Rules of Golf reference data.
 *
 * Authority: USGA / R&A Rules of Golf, 2023 edition (currently in effect
 * through end of 2027 when the next major revision lands). Every entry
 * is verified against the current Rules; common-misconception fields
 * surface where amateur understanding tends to drift.
 *
 * When the 2027 rules update lands, this file is the single point of
 * data refresh — handler logic + UI consume the structure unchanged.
 *
 * Coverage scope is the realistic question surface during a recreational
 * round. Tournament-rules variants and modified Stableford / match-play
 * specifics are deferred to 1.x.
 */

export const RULES_EDITION = '2023';

export type RuleCategory =
  | 'relief_free'
  | 'relief_penalty'
  | 'ball_at_rest'
  | 'putting_green'
  | 'pace_of_play'
  | 'penalty_areas'
  | 'unplayable';

export interface RuleEntry {
  rule_id: string;
  category: RuleCategory;
  /** Short title for the reference list. */
  title: string;
  /** One-sentence answer to "what do I do here?" — what Kevin says first. */
  rule_summary: string;
  /** Paragraph for follow-up questions / detail surface. */
  detailed_explanation: string;
  /** What a smart player does — beyond the rule, what's the play? */
  tactical_advice: string;
  /** Official Rule reference per Rules of Golf 2023. */
  official_reference: string;
  /** Common amateur misconceptions vs. the actual rule. */
  common_misconceptions?: string;
  /** Search keywords for the reference surface + intent matching. */
  keywords: string[];
}

export const RULES_REFERENCE: RuleEntry[] = [
  // ─── FREE RELIEF ──────────────────────────────────────────────────
  {
    rule_id: 'casual_water',
    category: 'relief_free',
    title: 'Casual water (temporary water)',
    rule_summary: 'Free relief from casual water. Drop within one club length of the nearest point of complete relief, no closer to the hole.',
    detailed_explanation: 'Casual water is any temporary accumulation of water on the course (after rain, sprinkler overflow, etc.) that is visible before or after you take your stance. It is an "abnormal course condition" and you get free relief in the general area, in bunkers (with constraints), and on the putting green.',
    tactical_advice: 'Take the relief. Casual water under your stance ruins balance and contact. Find the nearest point of complete relief (foot AND ball both clear of the water), then drop within one club length, no closer to the hole.',
    official_reference: 'Rule 16.1',
    common_misconceptions: 'You do NOT have to take relief — it is optional. You also do NOT need to play the ball as it lies if water just affects your stance; relief is available even if the ball is dry as long as the water interferes with your stance or swing.',
    keywords: ['casual water', 'temporary water', 'puddle', 'standing water', 'wet', 'rain'],
  },
  {
    rule_id: 'ground_under_repair',
    category: 'relief_free',
    title: 'Ground under repair (GUR)',
    rule_summary: 'Free relief from marked GUR. Drop within one club length of the nearest point of complete relief, no closer to the hole.',
    detailed_explanation: 'Ground under repair is any area marked as such by the committee (typically white painted lines or "GUR" signs). Includes damaged turf the course is in the process of repairing, material piled for removal, and areas the committee has declared GUR.',
    tactical_advice: 'If GUR is marked, take the relief — it is free. If you think the area should be GUR but is not marked, you must play it as it lies. Bare patches and divots are not GUR unless explicitly marked.',
    official_reference: 'Rule 16.1',
    common_misconceptions: 'A bare patch, divot, or worn area is NOT automatically GUR. Only areas the committee has marked or declared as GUR qualify.',
    keywords: ['ground under repair', 'gur', 'marked', 'white line', 'damaged turf'],
  },
  {
    rule_id: 'embedded_ball',
    category: 'relief_free',
    title: 'Embedded ball (plugged) in general area',
    rule_summary: 'Free relief if your ball is embedded in its own pitch mark in the general area. Drop within one club length of the spot, no closer to the hole.',
    detailed_explanation: 'Since 2019, embedded ball relief is available anywhere in the general area — not just the fairway. The ball must be in its own pitch mark and at least part of the ball below ground level. Embedded relief does NOT apply in bunkers or on the putting green (different rules cover those).',
    tactical_advice: 'Verify the ball is actually embedded (in its own pitch mark, partly below ground) before claiming relief. Mark, lift, then drop within one club length of where it sat, no closer to the hole.',
    official_reference: 'Rule 16.3',
    common_misconceptions: 'Pre-2019 the rule limited relief to the fairway only. Now it applies anywhere in the general area including the rough. But still NOT in bunkers — a plugged ball in the bunker does not get free relief.',
    keywords: ['embedded', 'plugged', 'pitch mark', 'rough', 'fairway', 'buried', 'plug'],
  },
  {
    rule_id: 'animal_hole',
    category: 'relief_free',
    title: 'Animal hole / burrowing animal damage',
    rule_summary: 'Free relief from a burrowing animal hole. Drop within one club length of the nearest point of complete relief, no closer to the hole.',
    detailed_explanation: 'Holes made by burrowing animals (gophers, moles, prairie dogs, etc.) and any associated mounds, casts, or runways count as "abnormal course conditions" and qualify for free relief. Bird, dog, and rabbit damage typically does too.',
    tactical_advice: 'Take the relief — animal damage is unpredictable. Same procedure as casual water and GUR: nearest point of complete relief, one club length, no closer to the hole.',
    official_reference: 'Rule 16.1',
    common_misconceptions: 'Footprints from animals do not count as animal hole damage — only actual burrowing.',
    keywords: ['animal hole', 'burrowing', 'gopher', 'mole', 'rabbit', 'prairie dog'],
  },
  {
    rule_id: 'cart_path',
    category: 'relief_free',
    title: 'Cart path / paved area',
    rule_summary: 'Optional free relief from a cart path. Find the nearest point of complete relief, then drop within one club length, no closer to the hole.',
    detailed_explanation: 'Cart paths are immovable obstructions. Relief is available when the path interferes with your ball, stance, or swing. The relief is OPTIONAL — you can choose to play off the path if it suits the shot.',
    tactical_advice: 'Take the relief on most shots — full swings off pavement risk damaging the club and produce unpredictable bounces. But on a delicate chip near the green, sometimes the path lie is acceptable. Check the nearest point of complete relief location before deciding — it sometimes drops you in worse trouble.',
    official_reference: 'Rule 16.1',
    common_misconceptions: 'You must take the FULL relief — you cannot just step off the path partially. The drop zone is one club length from the nearest point of complete relief, no closer to the hole.',
    keywords: ['cart path', 'paved', 'asphalt', 'concrete', 'obstruction'],
  },
  {
    rule_id: 'movable_obstruction',
    category: 'relief_free',
    title: 'Movable obstruction',
    rule_summary: 'Move the obstruction. No drop required; no penalty.',
    detailed_explanation: 'Movable obstructions include rakes, loose course furniture, fallen branches that are not embedded, etc. Anything you can lift and move without unreasonable effort. Just move it. If the ball moves while you remove the obstruction, replace the ball without penalty.',
    tactical_advice: 'Move the obstruction first, then play. If the ball is on or against an obstruction (e.g., resting on a rake), lift the ball, move the obstruction, then place the ball as close as possible to its original spot.',
    official_reference: 'Rule 15.2',
    common_misconceptions: 'Rakes left in or near bunkers ARE movable obstructions — you can move them. If the ball moves as a result, no penalty.',
    keywords: ['movable obstruction', 'rake', 'loose impediment', 'branch', 'movable'],
  },
  {
    rule_id: 'boundary_objects',
    category: 'relief_free',
    title: 'Boundary objects (fences, walls, OB stakes)',
    rule_summary: 'No relief from boundary objects. Play the ball as it lies or take unplayable lie penalty.',
    detailed_explanation: 'Boundary objects (white stakes, fences, walls defining out-of-bounds) are NOT obstructions. You get no relief for stance, swing, or line of play interference from boundary objects.',
    tactical_advice: 'If a boundary object blocks your shot, you have two real options: play the ball as it lies (find a creative shot around or over) or declare unplayable lie for one stroke and use one of the unplayable relief options.',
    official_reference: 'Rule 8.1, Rule 19',
    common_misconceptions: 'White stakes are NOT obstructions. They are boundary markers and you cannot move them or claim relief from them.',
    keywords: ['boundary', 'fence', 'wall', 'ob stake', 'white stake', 'no relief'],
  },

  // ─── PENALTY RELIEF ──────────────────────────────────────────────
  {
    rule_id: 'ob_stroke_distance',
    category: 'relief_penalty',
    title: 'Out of bounds (OB)',
    rule_summary: 'Stroke and distance. Play your next shot from where you played the original — count one penalty stroke plus the lost shot.',
    detailed_explanation: 'Ball is out of bounds when the entire ball lies past the boundary line (white stakes, white lines, or course boundary feature). Penalty is stroke and distance: replay from the previous spot, with one penalty stroke added. After tee shot OB, you are hitting your third from the tee.',
    tactical_advice: 'If you suspect a tee shot might be OB, ALWAYS hit a provisional ball before walking forward. Saves a long walk back if the original is lost. If a course uses Model Local Rule E-5 (alternative to stroke and distance), you may instead drop in the fairway with two penalty strokes — check the local rules.',
    official_reference: 'Rule 18.2',
    common_misconceptions: 'You cannot drop near where the ball went OB — it is not a penalty area. The only standard option is stroke and distance back to the previous spot.',
    keywords: ['ob', 'out of bounds', 'white stake', 'lost ball', 'stroke and distance', 'provisional'],
  },
  {
    rule_id: 'lost_ball',
    category: 'relief_penalty',
    title: 'Lost ball',
    rule_summary: 'Three minute search. If not found, stroke and distance — replay from the previous spot with one penalty stroke.',
    detailed_explanation: 'Since 2019, search time is 3 minutes (was 5 minutes pre-2019). The clock starts when you or your caddie begin searching. If the ball is not found within 3 minutes, it is lost and you must take stroke-and-distance penalty.',
    tactical_advice: 'Hit a provisional ball whenever a shot might be lost — saves the long walk back. If you find the original within 3 minutes, the provisional is abandoned with no penalty. If you cannot find it, the provisional is your ball with the standard one-stroke penalty.',
    official_reference: 'Rule 18.2',
    common_misconceptions: 'The 5-minute search rule is gone since 2019. It is now 3 minutes, and the clock starts the moment search begins.',
    keywords: ['lost ball', 'cannot find', '3 minute', 'three minute', 'search', 'gone'],
  },
  {
    rule_id: 'red_penalty_area',
    category: 'penalty_areas',
    title: 'Red penalty area (lateral water)',
    rule_summary: 'One penalty stroke plus three relief options.',
    detailed_explanation: 'Red penalty areas (formerly "lateral water hazards") give you three relief options for one penalty stroke: (1) replay the previous shot from where it was last played, (2) drop on the line from the hole through the point where the ball last crossed the edge of the penalty area, going as far back as you want, or (3) drop within two club lengths of where the ball last crossed the edge, no closer to the hole.',
    tactical_advice: 'Option 3 (two-club-length drop near where it crossed) is usually the play unless the lie or stance would be terrible. The opposite-side option was REMOVED in 2019 — you cannot drop on the other side of a red penalty area unless the local committee has reinstated it as a local rule.',
    official_reference: 'Rule 17',
    common_misconceptions: 'The "opposite side" relief option was removed in 2019. You also do not have to play from inside the penalty area — none of these options require it (though you can if you choose).',
    keywords: ['red', 'lateral', 'water hazard', 'penalty area', 'two club lengths', 'drop'],
  },
  {
    rule_id: 'yellow_penalty_area',
    category: 'penalty_areas',
    title: 'Yellow penalty area',
    rule_summary: 'One penalty stroke plus two relief options.',
    detailed_explanation: 'Yellow penalty areas give you two relief options for one penalty stroke: (1) replay the previous shot from where it was last played, or (2) drop on the line from the hole through the point where the ball last crossed the edge of the penalty area, going as far back as you want.',
    tactical_advice: 'Option 2 is usually the play. Pick a comfortable distance back from the crossing point that gives you a clean lie and a yardage you like. Yellow penalty areas do NOT have the two-club-length option that red areas do.',
    official_reference: 'Rule 17',
    common_misconceptions: 'Yellow does NOT have the lateral two-club-length option. That is only for red. Get the color right before deciding.',
    keywords: ['yellow', 'water hazard', 'penalty area', 'back on line'],
  },
  {
    rule_id: 'unplayable_lie',
    category: 'unplayable',
    title: 'Unplayable lie',
    rule_summary: 'One penalty stroke plus three relief options. You decide your ball is unplayable; nothing forces it.',
    detailed_explanation: 'You can declare your ball unplayable anywhere except inside a penalty area. For one penalty stroke, choose: (1) replay the previous shot, (2) drop on the line from the hole through the ball going as far back as you want, or (3) drop within two club lengths of the ball, no closer to the hole. In a bunker, there is also an extra option for two penalty strokes to drop OUTSIDE the bunker on a back-on-line option.',
    tactical_advice: 'When stuck under a tree, against a wall, or in deep brush, the unplayable option is often the smart play. Most amateurs try the heroic recovery and turn one bad shot into three. Take the stroke; live to fight on the next shot.',
    official_reference: 'Rule 19',
    common_misconceptions: 'You cannot declare unplayable inside a penalty area — different rules apply there. But anywhere else (general area, bunker), the choice is yours alone.',
    keywords: ['unplayable', 'unplayable lie', 'stuck', 'tree', 'against', 'declare'],
  },
  {
    rule_id: 'provisional_ball',
    category: 'relief_penalty',
    title: 'Provisional ball',
    rule_summary: 'Play a second ball when the original might be lost or OB. Announce it as a provisional before you hit.',
    detailed_explanation: 'A provisional saves the long walk back if the original is lost or out of bounds. You must announce "I am playing a provisional" before hitting; otherwise the new ball is automatically considered the ball in play under stroke and distance. If you find the original within the 3-minute search window and it is in bounds, the provisional is abandoned — pick it up, no penalty.',
    tactical_advice: 'Always hit a provisional when a tee shot might be lost or OB. Two minutes of caution saves twenty minutes of walking. Aim conservatively with the provisional — get it in play.',
    official_reference: 'Rule 18.3',
    common_misconceptions: 'You CANNOT play a provisional when the ball is known to be in a penalty area — provisionals are only for "lost or OB" situations.',
    keywords: ['provisional', 'second ball', 'might be ob', 'might be lost', 'declare'],
  },

  // ─── BALL AT REST ─────────────────────────────────────────────────
  {
    rule_id: 'ball_moved_address',
    category: 'ball_at_rest',
    title: 'Ball moves at address',
    rule_summary: 'No penalty if the movement was accidental. Play from the new spot.',
    detailed_explanation: 'Since 2019, accidental movement of the ball at address (e.g., grounding the club causes the ball to roll) carries no penalty. The penalty applies only if you are virtually certain the player CAUSED the movement (e.g., touched the ball with the club).',
    tactical_advice: 'Play from the new position without panic. The 2019 change was specifically meant to remove this trap — you no longer have to call a penalty on yourself for ground vibrations or wind pushing the ball during setup.',
    official_reference: 'Rule 9.4',
    common_misconceptions: 'Pre-2019 this was almost always a one-stroke penalty. The new rule reverses the presumption: no penalty unless you clearly caused the movement.',
    keywords: ['ball moved', 'address', 'accidental', 'rolled', 'no penalty'],
  },
  {
    rule_id: 'ball_moved_outside_agency',
    category: 'ball_at_rest',
    title: 'Ball moved by outside agency',
    rule_summary: 'Replace the ball at its original spot. No penalty.',
    detailed_explanation: 'Outside agency means anyone or anything other than you, your caddie, your equipment, or natural forces — e.g., another player, an animal, a spectator. If they move your ball at rest, replace it where it was and play on with no penalty.',
    tactical_advice: 'Mark the original spot before lifting if there is any ambiguity about location. If the spot is unknown, estimate the original spot reasonably and place the ball there.',
    official_reference: 'Rule 9.6',
    keywords: ['outside agency', 'animal', 'another player', 'moved', 'replace'],
  },
  {
    rule_id: 'ball_moved_wind_water',
    category: 'ball_at_rest',
    title: 'Ball moved by wind or water',
    rule_summary: 'Play from the new position. No penalty.',
    detailed_explanation: 'Wind and water are natural forces. If they move your ball at rest, you play from where it ends up — no penalty, no replacement. The exception is on the putting green: if you have already marked and replaced the ball, and then wind moves it, you replace it back to the marked spot.',
    tactical_advice: 'On a windy day on a fast green, mark and replace the ball promptly so you have a defined spot if wind moves it again.',
    official_reference: 'Rule 9.3',
    keywords: ['wind', 'water', 'moved', 'natural', 'no penalty'],
  },
  {
    rule_id: 'divot_in_fairway',
    category: 'ball_at_rest',
    title: 'Ball in a divot',
    rule_summary: 'No relief. Play it as it lies.',
    detailed_explanation: 'Divots are not ground under repair unless specifically marked by the committee. A ball that comes to rest in a divot (whether sand-filled or open) gets no free relief. Your only choice is to play it as it lies or declare unplayable for one penalty stroke.',
    tactical_advice: 'Take less club, swing slightly steeper, and accept reduced spin. Aim safely — distance control will be off. If the divot is severe and a green is unreachable, consider an unplayable for a clean lie.',
    official_reference: 'Rule 8.1',
    common_misconceptions: 'Many amateurs believe divots qualify for free relief — they do not, no matter how unfair it feels.',
    keywords: ['divot', 'fairway', 'no relief', 'unfair', 'sand filled'],
  },
  {
    rule_id: 'identifying_ball',
    category: 'ball_at_rest',
    title: 'Identifying your ball',
    rule_summary: 'Mark the spot and lift the ball to identify if needed. No penalty.',
    detailed_explanation: 'You may mark and lift the ball to identify it any time you reasonably need to verify it is yours. Tell your playing partner before lifting if practical. Place the ball back at the original spot.',
    tactical_advice: 'Always put a unique mark on your ball before each round (a colored dot, your initials) so identification is fast and unambiguous.',
    official_reference: 'Rule 7.3',
    keywords: ['identify', 'mark and lift', 'verify', 'my ball'],
  },

  // ─── PUTTING GREEN ────────────────────────────────────────────────
  {
    rule_id: 'spike_marks',
    category: 'putting_green',
    title: 'Spike marks and damage on the green',
    rule_summary: 'Repair anything you can. Spike marks, ball marks, animal damage — all repairable since 2019.',
    detailed_explanation: 'Since 2019, you may repair any damage on the putting green — spike marks, ball marks, indentations from old hole locations, animal damage, etc. The only exception is natural surface imperfections (the inherent grain or condition of the green).',
    tactical_advice: 'Repair what is on your line before putting. The 2019 change removed a frustrating loophole — there is no longer any rule against fixing spike marks on your line.',
    official_reference: 'Rule 13.1c',
    common_misconceptions: 'Pre-2019 you could NOT repair spike marks. The change is one of the most welcomed in the modern rule revisions.',
    keywords: ['spike marks', 'ball marks', 'damage', 'green', 'repair', 'fix'],
  },
  {
    rule_id: 'flagstick_in',
    category: 'putting_green',
    title: 'Putting with the flagstick in',
    rule_summary: 'Allowed since 2019. Putt with it in or have it tended/removed — your choice.',
    detailed_explanation: 'Since 2019, there is no penalty for hitting the flagstick while putting from the green. You may leave it in, have it tended (held), or have it removed entirely. The choice is yours; check with playing partners as a courtesy.',
    tactical_advice: 'Leaving the flagstick in often helps with distance control on long putts — the stick can act as a backstop for slightly long approaches. Most pros leave it in for putts over 20 feet, take it out for putts inside 10.',
    official_reference: 'Rule 13.2',
    common_misconceptions: 'Pre-2019 hitting the flagstick from a putt on the green was a 2-stroke penalty. The change opens up the strategic choice.',
    keywords: ['flagstick', 'flag', 'pin', 'putt', 'leave in', 'take out'],
  },
  {
    rule_id: 'caddie_alignment',
    category: 'putting_green',
    title: 'Caddie cannot stand behind player on line',
    rule_summary: 'Two-stroke penalty if your caddie stands behind you on your intended line as you take your stance.',
    detailed_explanation: 'Once you begin to take your stance, your caddie may not be positioned behind you on the line of play (or on its extension behind you). This applies anywhere on the course including the putting green. If the caddie is set up there and you back off and reset, no penalty.',
    tactical_advice: 'Caddies should clear the line as soon as the player begins to take their stance. The penalty applies when the caddie is in position when the stance is set, not just present in the area.',
    official_reference: 'Rule 10.2b(4)',
    common_misconceptions: 'The caddie may verify alignment BEFORE you take your stance — the rule only kicks in once you have begun the stance.',
    keywords: ['caddie', 'alignment', 'behind', 'line', 'stance', 'penalty'],
  },
  {
    rule_id: 'mark_lift_replace',
    category: 'putting_green',
    title: 'Marking and lifting on the green',
    rule_summary: 'Mark the ball with a small object (coin, marker), lift, replace at the same spot.',
    detailed_explanation: 'On the putting green you may always mark, lift, and clean your ball. Use a small object (typically a coin or commercial ball marker) placed directly behind or beside the ball. After cleaning or after others have putted, replace the ball at the marked spot.',
    tactical_advice: 'Standard procedure: mark behind the ball, lift, clean if needed, replace before putting. If your marker is on a partner\'s line, move it to the side along the line of a club head, then move it back before you putt.',
    official_reference: 'Rule 14.1',
    keywords: ['mark', 'lift', 'replace', 'green', 'coin', 'marker'],
  },

  // ─── PACE OF PLAY ────────────────────────────────────────────────
  {
    rule_id: 'pace_ready_golf',
    category: 'pace_of_play',
    title: 'Ready golf',
    rule_summary: 'Play when you are ready, regardless of strict honors. Saves time, no penalty.',
    detailed_explanation: 'Ready golf means whoever is ready plays first, rather than strictly observing the "honor" (lowest score on the previous hole tees off first). Encouraged in stroke play and casual rounds. Maintains pace, reduces dead time.',
    tactical_advice: 'Be ready when it is your turn. Walk to your ball with the right club already chosen, line up while others play. Hit when others are at safe distance and you are not in their line of sight.',
    official_reference: 'Rule 6.4 (recommendation)',
    keywords: ['ready golf', 'pace', 'honors', 'speed up'],
  },
  {
    rule_id: 'max_score_handicap',
    category: 'pace_of_play',
    title: 'Maximum score for handicap (net double bogey)',
    rule_summary: 'Pick up at net double bogey for handicap-posting purposes. Saves pace and protects your handicap.',
    detailed_explanation: 'For handicap posting under the World Handicap System, the maximum score on any hole is "net double bogey" = par + 2 + strokes received on that hole. Once you have reached or will exceed that, pick up — it cannot count for more.',
    tactical_advice: 'Keep track of the cap as you play tough holes. When you reach the cap and have not finished, pick up — saves time, holds up your handicap correctly, lets the group keep moving.',
    official_reference: 'Rules of Handicapping 3.1, Rule 3.3 (max score format)',
    common_misconceptions: 'Net double bogey is for HANDICAP posting only. In a tournament playing stroke play, you must hole out (or take double-par max if tournament uses that format).',
    keywords: ['max score', 'net double bogey', 'pick up', 'handicap', 'cap'],
  },
];

// Quick lookup helpers
export function getRuleById(id: string): RuleEntry | null {
  return RULES_REFERENCE.find(r => r.rule_id === id) ?? null;
}

export function searchRules(query: string): RuleEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  return RULES_REFERENCE.filter(r =>
    r.title.toLowerCase().includes(q) ||
    r.rule_summary.toLowerCase().includes(q) ||
    r.keywords.some(k => k.includes(q) || q.includes(k))
  );
}

export function rulesByCategory(category: RuleCategory): RuleEntry[] {
  return RULES_REFERENCE.filter(r => r.category === category);
}

/**
 * Best-match lookup for a free-form rule query (used by rulesQueryHandler
 * to provide grounding context to Sonnet). Returns the top 3 matches by
 * keyword overlap so Sonnet has the right rule + similar variants in
 * front of it.
 */
export function findRelevantRules(query: string, limit = 3): RuleEntry[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(t => t.length > 2);
  const scored = RULES_REFERENCE.map(r => {
    let score = 0;
    for (const k of r.keywords) {
      if (q.includes(k)) score += 5;
      else if (tokens.some(t => k.includes(t))) score += 2;
    }
    if (r.title.toLowerCase().includes(q)) score += 8;
    if (r.rule_summary.toLowerCase().includes(q)) score += 3;
    return { rule: r, score };
  })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(x => x.rule);
}
