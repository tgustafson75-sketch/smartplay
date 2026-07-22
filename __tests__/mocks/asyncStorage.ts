// In-memory AsyncStorage mock for pure-logic store tests.
const mem = new Map<string, string>();
export default {
  getItem: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: async (k: string, v: string) => { mem.set(k, v); },
  removeItem: async (k: string) => { mem.delete(k); },
  getAllKeys: async () => Array.from(mem.keys()),
  multiGet: async (ks: string[]) => ks.map((k) => [k, mem.get(k) ?? null]),
  multiSet: async (pairs: [string, string][]) => { for (const [k, v] of pairs) mem.set(k, v); },
  multiRemove: async (ks: string[]) => { for (const k of ks) mem.delete(k); },
  clear: async () => { mem.clear(); },
  __dump: () => Object.fromEntries(mem),
};
