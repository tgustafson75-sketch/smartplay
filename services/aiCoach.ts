interface AICoachParams {
  shots: Array<{ result: string; [key: string]: any }>;
  mentalState: string;
  confidence: number;
  longTermPattern: string | null;
  playerProfile?: {
    commonMiss: string | null;
    miss: string | null;
    strength: string | null;
    preferredStrategy: string | null;
  } | null;
  coachingStyle?: 'calm' | 'aggressive' | 'encouraging' | 'focused' | null;
}

const responseCache: Record<string, string> = {};

export const getAIResponse = async ({
  shots,
  mentalState,
  confidence,
  longTermPattern,
  playerProfile,
  coachingStyle,
}: AICoachParams): Promise<string> => {
  const recentShots = shots.slice(-5).map((s) => s.result).join(', ');
  const rightCount = shots.slice(-5).filter((s) => s.result === 'right').length;
  const leftCount  = shots.slice(-5).filter((s) => s.result === 'left').length;

  const cacheKey = JSON.stringify({
    shots: shots.slice(-5).map((s) => s.result),
    mentalState,
    confidence,
    longTermPattern,
    coachingStyle,
  });
  if (responseCache[cacheKey]) return responseCache[cacheKey];

  const contextHints: string[] = [];
  if (longTermPattern === 'push' || rightCount >= 2)
    contextHints.push('Player tends to miss right — guide toward release and finishing on the front side.');
  if (longTermPattern === 'pull' || leftCount >= 2)
    contextHints.push('Player tends to miss left — guide toward swinging out to target, not cutting across.');
  if (confidence < 40)
    contextHints.push('Confidence is low — reinforce trust in the swing, keep it simple.');
  if (mentalState === 'rushed')
    contextHints.push('Player feels rushed — cue slow tempo and a full finish.');
  if (mentalState === 'nervous')
    contextHints.push('Player is nervous — keep tone calm, reinforce one simple feel.');
  if (playerProfile?.miss === 'right' || playerProfile?.commonMiss === 'right')
    contextHints.push('Profile confirms this player\'s established miss is right — reinforce front-side finish.');
  if (playerProfile?.miss === 'left' || playerProfile?.commonMiss === 'left')
    contextHints.push('Profile confirms this player\'s established miss is left — reinforce swinging out to target.');
  if (playerProfile?.strength === 'straight')
    contextHints.push('Player has been striking it straight — build on that confidence.');
  if (playerProfile?.preferredStrategy === 'aggressive')
    contextHints.push('Player plays aggressive — confident, committed cues.');
  if (playerProfile?.preferredStrategy === 'safe')
    contextHints.push('Player plays safe — calm, conservative cues.');

  const contextBlock = contextHints.length > 0
    ? `Situational context:\n${contextHints.map((h) => `- ${h}`).join('\n')}`
    : 'No specific concern — reinforce confidence and commitment.';

  const prompt = `You are a professional golf caddie. You have walked hundreds of rounds with this player and know their tendencies.

Coaching style: ${coachingStyle ?? 'calm'}

Personality rules based on coaching style:
${(!coachingStyle || coachingStyle === 'calm') ? `- Tone: Reassuring, unhurried, quiet confidence
- Language: Smooth and flowing — "easy tempo", "nice and smooth", "let it go"
- Avoid urgency or challenge` : ''}${coachingStyle === 'aggressive' ? `- Tone: Direct, challenging, forceful
- Language: Committed and bold — "attack it", "own this shot", "make it happen"
- Push the player to step up and commit fully` : ''}${coachingStyle === 'encouraging' ? `- Tone: Positive, warm, supportive
- Language: Confidence-building — "you've got this", "trust yourself", "looking good"
- Reinforce belief and self-trust above all else` : ''}${coachingStyle === 'focused' ? `- Tone: Precise, stripped back, no fluff
- Language: Target-driven and minimal — "see it, hit it", "pick a spot", "one target"
- Remove all noise — pure execution focus` : ''}

Shared rules regardless of style:
- Sounds like a seasoned tour caddie, not a coach
- Never technical, always feel-based
- Minimal words — never more than 12

Player snapshot:
- Recent shots (last 5): ${recentShots}
- Mental state: ${mentalState}
- Confidence level: ${confidence}/100
- Long-term miss pattern: ${longTermPattern ?? 'none identified'}

Player profile:
- Tendency: ${playerProfile?.miss ?? playerProfile?.commonMiss ?? 'unknown'}
- Preferred strategy: ${playerProfile?.preferredStrategy ?? 'unknown'}
- Ball-striking strength: ${playerProfile?.strength ?? 'none noted'}

${contextBlock}

Instructions based on profile:
- If tendency is right/push → bias cue toward release and front-side finish
- If tendency is left/pull → bias cue toward swinging out through target
- If confidence is below 50 → reinforce trust, keep cue simple and reassuring
- If mental state is rushed → emphasize tempo and a full finish

Your job:
Deliver ONE pre-shot cue. It should feel like a trusted caddie whispering something just before the player steps into the shot.

Rules:
- ONE sentence or phrase only
- Under 12 words
- No technical jargon (no "hip rotation", "swing path", etc.)
- Build confidence and focus
- Vary phrasing — don't repeat the same cue each time

Strong examples:
"Pick your spot. Smooth swing through it."
"You've made this shot a hundred times."
"Front side finish. Nothing else matters."
"Trust the yardage. Commit and go."
"Stay behind it. Let the club do the work."

Respond with ONLY the cue. No quotes, no explanation.`;

  try {
    // Base URL: set EXPO_PUBLIC_API_URL in .env for production (e.g. https://your-server.com)
    // Falls back to Expo dev server on localhost so API route works out of the box
    const base = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${base}/api/caddie`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, coachingStyle }),

      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return 'Stay smooth and commit to your target.';

    const data = await response.json();
    const message = (data.message as string)?.trim() || 'Stay smooth and commit to your target.';
    responseCache[cacheKey] = message;
    return message;
  } catch (error) {
    console.log('Backend error:', error);

    // Smart offline fallback — mirrors app personality
    const recent = shots.slice(-3).map((s) => s.result);

    if (recent.filter((r) => r === 'right').length >= 2) {
      return 'Finish on your front side. Let it release left.';
    }
    if (recent.filter((r) => r === 'left').length >= 2) {
      return 'Smooth tempo. Swing through your target.';
    }
    if (confidence > 70) {
      return "You're dialed in. Trust it.";
    }

    return 'Stay smooth and commit to your target.';
  }
};
