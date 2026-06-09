/**
 * Open External Service voice intent handler.
 *
 * 2026-05-24 — Voice path to launch a music / video app from inside the
 * round. Tim's framing: "if someone wants to talk to Caddie, they tell
 * the music to stop" — i.e. NO audio-session coordination in v1. The
 * music drowns out Caddie's voice while it plays; user manages it
 * verbally / by tabbing back to SmartPlay. Avoiding native audio-session
 * config keeps this OTA-shippable.
 *
 * Why https URLs (not app deep links like youtube://):
 *   - Custom URL schemes need Info.plist LSApplicationQueriesSchemes
 *     entries on iOS — that's a native rebuild. https universal links
 *     open the app when installed and the browser otherwise, with no
 *     native config and no permission changes.
 *
 * Examples:
 *   "open YouTube"                          → youtube, no query
 *   "play music"                            → youtube_music (default), no query
 *   "play some Sinatra"                     → youtube_music, query="Sinatra"
 *   "open Spotify"                          → spotify, no query
 *   "play Yacht Rock on YouTube"            → youtube, query="Yacht Rock"
 *   "open Apple Music"                      → apple_music, no query
 */

import { Linking } from 'react-native';
import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { getInstructorVideo, type IssueCategory } from '../../constants/instructorVideos';

type ExternalService = 'youtube' | 'youtube_music' | 'spotify' | 'apple_music';

// 2026-06-08 — "pull up a good video for chipping" → bring up a REPUTABLE
// golf-instruction video, not a random search. Curated topics resolve to
// our vetted instructor videos (constants/instructorVideos); other golf
// topics fall back to a focused YouTube search. Non-golf queries are left
// to the normal music/video flow below.
const CURATED_TOPICS: { kw: string[]; category: IssueCategory }[] = [
  { kw: ['slice', 'over the top', 'over-the-top', 'out to in', 'out-to-in', 'swing path', 'club path', 'coming over', 'casting'], category: 'swing_path' },
  { kw: ['weight', 'transfer', 'weight shift', 'hang back', 'sway', 'reverse pivot'], category: 'weight_transfer' },
  { kw: ['tempo', 'rhythm', 'timing', 'transition'], category: 'tempo' },
  { kw: ['ball position'], category: 'ball_position' },
  { kw: ['grip'], category: 'grip' },
  { kw: ['posture', 'setup', 'stance', 'early extension', 'spine angle'], category: 'posture' },
];
const GOLF_TOPIC_KW = [
  'chip', 'chipping', 'short game', 'putt', 'putting', 'bunker', 'sand', 'pitch',
  'pitching', 'wedge', 'flop', 'lag', 'driver', 'driving', 'iron', 'approach',
  'distance control', 'green read', 'hook', 'fade', 'draw', 'swing', 'golf',
];

function pickGolfVideo(query: string): { url: string; title: string; instructor: string | null } | null {
  const q = query.toLowerCase();
  for (const c of CURATED_TOPICS) {
    if (c.kw.some(k => q.includes(k))) {
      const v = getInstructorVideo(c.category);
      return { url: v.url, title: v.title, instructor: v.instructor };
    }
  }
  if (GOLF_TOPIC_KW.some(k => q.includes(k))) {
    const topic = query
      .replace(/\b(a|good|great|me|us|the|some|video|youtube|on|of|for|pull|up|show|find|play|please|how|to)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim() || query;
    return {
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${topic} golf lesson`)}`,
      title: topic,
      instructor: null,
    };
  }
  return null;
}

const SERVICE_LABEL: Record<ExternalService, string> = {
  youtube:       'YouTube',
  youtube_music: 'YouTube Music',
  spotify:       'Spotify',
  apple_music:   'Apple Music',
};

function buildUrl(service: ExternalService, query: string | null): string {
  const q = query ? encodeURIComponent(query) : null;
  switch (service) {
    case 'youtube':
      return q ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com/';
    case 'youtube_music':
      return q ? `https://music.youtube.com/search?q=${q}` : 'https://music.youtube.com/';
    case 'spotify':
      return q ? `https://open.spotify.com/search/${q}` : 'https://open.spotify.com/';
    case 'apple_music':
      return q ? `https://music.apple.com/us/search?term=${q}` : 'https://music.apple.com/';
  }
}

function normalizeService(raw: unknown): ExternalService | null {
  const s = String(raw ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'youtube' || s === 'yt') return 'youtube';
  if (s === 'youtube_music' || s === 'yt_music' || s === 'ytmusic') return 'youtube_music';
  if (s === 'spotify') return 'spotify';
  if (s === 'apple_music' || s === 'applemusic' || s === 'music') return 'apple_music';
  return null;
}

export const openExternalHandler: IntentHandler = {
  intent_type: 'open_external',

  parameter_schema: {
    service: 'one of: youtube, youtube_music, spotify, apple_music',
    query: 'optional search query string',
  },

  examples: [
    'open YouTube',
    'play music',
    'play some Sinatra',
    'play Yacht Rock on YouTube',
    'open Spotify',
    'open Apple Music',
    'show me a good video of short game on YouTube',
    'pull up a good YouTube video for chipping',
    'find me a video on fixing my slice',
    'pull up a tempo video',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const service = normalizeService(intent.parameters.service) ?? 'youtube_music';
    const queryRaw = intent.parameters.query;
    const query: string | null = typeof queryRaw === 'string' && queryRaw.trim().length > 0
      ? queryRaw.trim()
      : null;

    // Golf-instruction video request → open a reputable curated video (or
    // a focused golf search), regardless of which media service the
    // classifier guessed. One of our vetted instructors brings it up.
    const golf = query ? pickGolfVideo(query) : null;
    if (golf) {
      try {
        await Linking.openURL(golf.url);
      } catch (e) {
        console.log('[openExternalHandler] golf video open failed:', e);
        return {
          success: false,
          voice_response: `Couldn't pull up that video.`,
          side_effects: ['open_external:failed:youtube_golf'],
          follow_up_needed: false,
        };
      }
      const voice = golf.instructor
        ? `Here's a good one — "${golf.title}" by ${golf.instructor}. Pulling it up now.`
        : `Pulling up a good ${golf.title} video for you.`;
      return {
        success: true,
        voice_response: voice,
        side_effects: ['open_external:youtube_golf', `open_external:topic=${golf.title.slice(0, 40)}`],
        follow_up_needed: false,
      };
    }

    const url = buildUrl(service, query);
    const label = SERVICE_LABEL[service];

    try {
      await Linking.openURL(url);
    } catch (e) {
      console.log('[openExternalHandler] Linking.openURL failed:', e);
      return {
        success: false,
        voice_response: `Couldn't open ${label}.`,
        side_effects: [`open_external:failed:${service}`],
        follow_up_needed: false,
      };
    }

    const voice = query
      ? `Playing ${query} on ${label}. Tell the music to stop if you want to talk to me.`
      : `Opening ${label}. Tell the music to stop if you want to talk to me.`;

    return {
      success: true,
      voice_response: voice,
      side_effects: [
        `open_external:${service}`,
        ...(query ? [`open_external:query=${query.slice(0, 40)}`] : []),
      ],
      follow_up_needed: false,
    };
  },
};
