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

type ExternalService = 'youtube' | 'youtube_music' | 'spotify' | 'apple_music';

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
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const service = normalizeService(intent.parameters.service) ?? 'youtube_music';
    const queryRaw = intent.parameters.query;
    const query: string | null = typeof queryRaw === 'string' && queryRaw.trim().length > 0
      ? queryRaw.trim()
      : null;

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
