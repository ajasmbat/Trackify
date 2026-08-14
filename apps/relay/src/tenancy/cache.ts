// In-memory TTL cache keyed by hostname. The relay is single-node (see
// DECISIONS.md); when we ever run multiple relay nodes, TTL still bounds
// staleness — no distributed cache is introduced.
//
// Semantics:
//  - `get(key)` returns the cached value if a fresh entry exists, otherwise
//    calls `load(key)` and caches the fresh result (single-flight per key so a
//    burst of concurrent misses only issues one load).
//  - Errors from `load` are NOT cached; the next call retries.
//  - The load function is opaque — a `tenant_not_found` throw from the
//    resolver propagates through `get` without being cached.

export interface TtlCacheOptions {
  ttlMs: number;
  now?: () => number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export interface TtlCache<T> {
  get(key: string): Promise<T>;
  invalidate(key?: string): void;
  size(): number;
}

export function createTtlCache<T>(
  load: (key: string) => Promise<T>,
  opts: TtlCacheOptions,
): TtlCache<T> {
  const now = opts.now ?? (() => Date.now());
  if (!(opts.ttlMs > 0)) {
    throw new Error(`ttlMs must be > 0 (got ${opts.ttlMs})`);
  }

  const entries = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  async function fill(key: string): Promise<T> {
    const existing = inflight.get(key);
    if (existing) return existing;

    const p = (async () => {
      try {
        const value = await load(key);
        entries.set(key, { value, expiresAt: now() + opts.ttlMs });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  return {
    async get(key) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > now()) return hit.value;
      if (hit) entries.delete(key);
      return fill(key);
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
    size() {
      return entries.size;
    },
  };
}
