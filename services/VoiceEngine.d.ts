export const PRIORITY: { readonly AMBIENT: 1; readonly STRATEGY: 2; readonly SHOT: 3; readonly CRITICAL: 4 };
export function speakJob(message: string, priority?: number, gender?: string | null, setVoiceState?: ((s: string) => void) | null, eventId?: string | null): Promise<boolean>;
export function startListening(setVoiceState?: ((s: string) => void) | null): Promise<() => void>;
export function stopListening(setVoiceState?: ((s: string) => void) | null): void;
export function forceStop(setVoiceState?: ((s: string) => void) | null): Promise<void>;
export function cancelAll(setVoiceState?: ((s: string) => void) | null): Promise<void>;
export function canSpeak(message: string, priority?: number): boolean;
export function getEngineState(): 'idle' | 'speaking' | 'listening';
export function onStateChange(fn: (state: string) => void): () => void;
