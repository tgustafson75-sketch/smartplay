// The app key is sent on requests to OUR API and nowhere else. Most call sites
// build their own fetch() with no headers, so the wrapper in services/appKeyFetch
// is what puts the key on them. If it ever sent the key to a vendor (Google,
// Mapbox, OpenAI), the key would leak to a third party.

const API = 'https://api.example.test';
const KEY = 'test_app_key';

function loadWrapper(): { calls: Array<{ url: string; headers: Headers }> } {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const underlying = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, headers: new Headers(init?.headers) });
    return new Response('{}');
  });
  (globalThis as { fetch: unknown }).fetch = underlying;
  jest.isolateModules(() => {
    jest.doMock('../../services/apiBase', () => ({ APP_KEY: KEY, getApiBaseUrl: () => API }));
    require('../../services/appKeyFetch');
  });
  return { calls };
}

describe('app key is sent only to our API', () => {
  beforeEach(() => jest.resetModules());

  it('adds x-app-key to a request to our API', async () => {
    const { calls } = loadWrapper();
    await fetch(`${API}/api/kevin`, { method: 'POST' });
    expect(calls[0].headers.get('x-app-key')).toBe(KEY);
  });

  it('does not send the key to any other origin', async () => {
    const { calls } = loadWrapper();
    await fetch('https://maps.googleapis.com/maps/api/geocode/json?x=1');
    await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST' });
    expect(calls[0].headers.get('x-app-key')).toBeNull();
    expect(calls[1].headers.get('x-app-key')).toBeNull();
  });

  it('keeps a key a caller already set', async () => {
    const { calls } = loadWrapper();
    await fetch(`${API}/api/voice`, { headers: { 'x-app-key': 'caller_key' } });
    expect(calls[0].headers.get('x-app-key')).toBe('caller_key');
  });

  it('wraps only once when loaded twice', async () => {
    const { calls } = loadWrapper();
    jest.isolateModules(() => {
      jest.doMock('../../services/apiBase', () => ({ APP_KEY: KEY, getApiBaseUrl: () => API }));
      require('../../services/appKeyFetch');
    });
    await fetch(`${API}/api/health`);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.get('x-app-key')).toBe(KEY);
  });
});
