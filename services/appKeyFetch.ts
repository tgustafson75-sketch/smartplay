// Sends the app key on every request to our own API, from one place.
//
// The app key (services/apiBase.ts) is what the server checks before it spends
// money on inference. Most of the ~70 call sites build their own fetch() with no
// headers, so rather than editing each one this wraps the global fetch: any
// request whose URL starts with the API base gets x-app-key, unless the caller
// already set one. Requests to any other origin (Google, Mapbox, vendors) are
// untouched, so the key never leaves our own API.
//
// Imported from app/_layout.tsx right after the polyfills, so it is in place
// before any screen fetches.

import { APP_KEY, getApiBaseUrl } from './apiBase';

type FetchFn = typeof fetch;
const MARK = '__appKeyWrapped';

const current = globalThis.fetch as FetchFn & { [MARK]?: true };
if (typeof current === 'function' && !current[MARK]) {
  const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const base = getApiBaseUrl();
    if (!base || !url.startsWith(base)) return current(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('x-app-key')) headers.set('x-app-key', APP_KEY);
    return current(input, { ...init, headers });
  }) as FetchFn & { [MARK]?: true };
  wrapped[MARK] = true;
  globalThis.fetch = wrapped;
}
