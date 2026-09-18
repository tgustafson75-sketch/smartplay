/**
 * 2026-09-17 — expo-av for the LOGIC project, deep rather than flat.
 *
 * expoGeneric returns a no-op FUNCTION for any property, which is enough for a module that only
 * CALLS into a native API. services/voiceService reads a nested enum at module load —
 * `Audio.AndroidOutputFormat.MPEG_4` — and a function has no such property, so the flat stub threw
 * before a single test could run.
 *
 * This proxy answers any depth, and any leaf reads as a harmless string. That is why voiceService
 * is importable here at all, and why the route-change speech guard finally has a test: the module
 * owning those timestamps was previously unreachable from the suite.
 */
const deep = () => new Proxy(function stub() {}, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined;              // never look thenable to `await`
    if (prop === Symbol.toPrimitive || prop === 'toString') return () => 'stub';
    return deep();
  },
  apply: () => deep(),
  construct: () => deep(),
});

module.exports = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === '__esModule') return true;
    return deep();
  },
});
