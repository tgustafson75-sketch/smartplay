// 2026-08-19 — expo-router stub for the pure-logic jest project.
//
// expo-router ships JSX, so `require('expo-router')` throws "Unexpected token '<'" under the plain
// ts-jest transform. That single unloadable import walled off every module that imports `router` at
// top level — including services/voice/conversationalToolDispatch, which is the ONE dispatcher every
// voice tool on every mic path runs through. The most safety-critical switch in the app had no unit
// coverage because of a transform error, and `recommend_club` was silently dropped at three separate
// seams while that was true.
//
// Scoped deliberately, per the note in jest.config.js: a blanket '^expo-.*' mapper stubs modules
// other tests rely on for real behaviour. Nothing in the logic project can depend on expo-router's
// real behaviour today, because it cannot load at all.
//
// Navigation calls are recorded so a test can assert a tool navigated, rather than only that it
// didn't throw.
const calls = [];
const record = (method) => (...args) => { calls.push({ method, args }); };

module.exports = {
  router: {
    push: record('push'),
    replace: record('replace'),
    back: record('back'),
    dismissAll: record('dismissAll'),
    navigate: record('navigate'),
    setParams: record('setParams'),
  },
  useRouter: () => module.exports.router,
  useLocalSearchParams: () => ({}),
  useSegments: () => [],
  usePathname: () => '/',
  Link: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
  Tabs: Object.assign(() => null, { Screen: () => null }),
  __calls: calls,
  __reset: () => { calls.length = 0; },
};
