/**
 * apiFetch — drop-in fetch wrapper that injects the AI provider header.
 *
 * Usage (replace existing pattern):
 *   // Before:
 *   const apiUrl = getApiBaseUrl();
 *   fetch(apiUrl + '/api/kevin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
 *
 *   // After:
 *   apiFetch('/api/kevin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
 *
 * The wrapper reads the current aiProvider setting and injects it as
 * X-AI-Provider on every request. TTS/STT routes (/api/voice, /api/transcribe)
 * still receive the header but the server ignores it — those are always OpenAI.
 *
 * Phase 1: infrastructure only. Routes are migrated to read the header in
 * Phases 2–5 as each API route is migrated off Anthropic.
 */

import { API_BASE_URL } from './apiBase';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Fetches an API route with the AI provider header injected.
 *
 * @param path  Relative path starting with '/api/', e.g. '/api/kevin'
 * @param init  Standard RequestInit (method, headers, body, signal, etc.)
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const aiProvider = useSettingsStore.getState().aiProvider ?? 'gemini';

  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-AI-Provider', aiProvider);

  return fetch(API_BASE_URL + path, { ...init, headers });
}
