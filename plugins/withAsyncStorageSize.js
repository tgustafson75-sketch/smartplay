/**
 * 2026-06-30 (Tim — Greenhill: SQLITE_FULL "database or disk is full") — raise the
 * @react-native-async-storage/async-storage Android SQLite size limit.
 *
 * The library defaults to a 6 MB SQLite database. This app persists round history,
 * swing sessions, caddie memory, course books, etc. across many zustand stores that
 * all share that one DB — 6 MB fills up in real use, and once full EVERY store's
 * persist write fails (persist_write_failed / SQLITE_FULL[13]) and reads of an
 * oversized row throw ("exceeds maximum limit"). AsyncStorage reads
 * `AsyncStorage_db_size_in_MB` from gradle.properties at build time; this plugin sets
 * it so the DB has real headroom. (Paired with cageStore stripping raw pose frames,
 * which removes the biggest single source of bloat.)
 *
 * Managed Expo has no android/gradle.properties to edit by hand, so we set the
 * property via the config plugin at prebuild. Takes effect on the next native build.
 */

const { withGradleProperties } = require('expo/config-plugins');

const DEFAULT_SIZE_MB = 50;

module.exports = function withAsyncStorageSize(config, props = {}) {
  const sizeMB = Number(props.sizeMB) > 0 ? Math.floor(Number(props.sizeMB)) : DEFAULT_SIZE_MB;
  return withGradleProperties(config, (cfg) => {
    const key = 'AsyncStorage_db_size_in_MB';
    const list = cfg.modResults;
    const existing = list.find((item) => item.type === 'property' && item.key === key);
    if (existing) {
      existing.value = String(sizeMB);
    } else {
      list.push({ type: 'property', key, value: String(sizeMB) });
    }
    return cfg;
  });
};
