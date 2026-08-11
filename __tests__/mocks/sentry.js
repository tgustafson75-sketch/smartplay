/**
 * 2026-08-10 — @sentry/react-native stub for the LOGIC test project. Ships ESM that plain node can't
 * parse, so every module importing services/analytics (which imports Sentry) was unreachable from the
 * logic suite — including services/clubRecognition, where all spoken-club parsing lives.
 */
const noop = () => undefined;
module.exports = new Proxy({}, { get: () => noop });
