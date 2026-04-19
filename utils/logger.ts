/**
 * utils/logger.ts
 *
 * Lightweight structured event logger for on-course telemetry.
 *
 * Tracks: shot events, errors, and intent classifications.
 * Dev: writes to console. Production: silent (no external service required).
 *
 * Usage:
 *   import { logEvent } from '../utils/logger';
 *   logEvent('shot', { result: 'left', club: '7 iron', hole: 4, distance: 155 });
 *   logEvent('error', { source: 'focusEngine', message: e.message });
 *   logEvent('intent', { query: 'what club', detected: 'golf' });
 */

export type LogEventType = 'shot' | 'error' | 'intent' | 'gps' | 'session' | 'voice';

export interface LogPayload {
  [key: string]: unknown;
}

/**
 * Log a structured event. In development the event is printed to the console
 * with a prefixed tag. In production this is a no-op — add a remote sink here
 * (e.g. Sentry, Amplitude) when ready without changing any call sites.
 */
export function logEvent(type: LogEventType, payload: LogPayload): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[${type.toUpperCase()}]`, { ts: Date.now(), ...payload });
  }
  // Production telemetry hook — wire a remote service here when needed:
  // remoteSink.capture(type, payload);
}
