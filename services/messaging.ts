/**
 * 2026-06-30 — Minimal in-app messaging client (Tim ↔ Tank to start). Talks to
 * /api/messages (Supabase-backed). Identity = account email. Best-effort: every call
 * degrades to false/[] on any error so the UI never throws.
 */
import { getApiBaseUrl } from './apiBase';

export interface ChatMessage {
  id: number;
  from_email: string;
  to_email: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export async function sendMessage(from: string, to: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, body }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = await res.json().catch(() => ({})) as { ok?: boolean };
    return j.ok === true;
  } catch {
    return false;
  }
}

/** Fetch the user's thread (optionally narrowed to the 2-person convo with `withUser`). */
export async function fetchThread(user: string, withUser?: string): Promise<ChatMessage[]> {
  try {
    const qs = `user=${encodeURIComponent(user)}${withUser ? `&with=${encodeURIComponent(withUser)}` : ''}`;
    const res = await fetch(`${getApiBaseUrl()}/api/messages?${qs}`, { signal: AbortSignal.timeout(12_000) });
    const j = await res.json().catch(() => ({ messages: [] })) as { messages?: ChatMessage[] };
    return Array.isArray(j.messages) ? j.messages : [];
  } catch {
    return [];
  }
}
