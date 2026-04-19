/**
 * Caddie message map — tone and phrasing by personality mode.
 * Male: direct, ≤4 words. Female: composed, ≤7 words.
 * No randomization. Consistency is the identity.
 */

type CaddieMode = "male" | "female";

export const messages: Record<string, Record<CaddieMode, string>> = {
  driver: {
    male: "Start it right.",
    female: "Start it right. Let it fall.",
  },
  iron: {
    male: "158. Center.",
    female: "158 carry. Play center.",
  },
  missRight: {
    male: "Right.",
    female: "You pushed that right.",
  },
  missLeft: {
    male: "Left.",
    female: "You pulled that left.",
  },
  goodShot: {
    male: "That's it.",
    female: "That's your shot.",
  },
  patternRight: {
    male: "Everything's right.",
    female: "Everything's drifting right.",
  },
  patternLeft: {
    male: "Everything's left.",
    female: "Everything's drifting left.",
  },
  tempo: {
    male: "Good tempo.",
    female: "Good tempo. Stay smooth.",
  },
  alignment: {
    male: "Check your line.",
    female: "Check your start line.",
  },
  shortGame: {
    male: "Feel it.",
    female: "Feel the distance first.",
  },
  putting: {
    male: "Read it.",
    female: "Read the line carefully.",
  },
  swingDetect: {
    male: "Everything's right.",
    female: "Everything's drifting right.",
  },
  indoor: {
    male: "Stay focused.",
    female: "Stay in your routine.",
  },
  fade: {
    male: "That's your fade.",
    female: "That's your fade. Stay with it.",
  },
  draw: {
    male: "Good draw.",
    female: "Good draw. Right on line.",
  },
};

/**
 * Retrieve a caddie phrase by message type and personality mode.
 * Returns empty string if type is not found (triggers no speech).
 */
export function getCaddieMessage(type: string, mode: CaddieMode = "female"): string {
  return messages[type]?.[mode] ?? "";
}
