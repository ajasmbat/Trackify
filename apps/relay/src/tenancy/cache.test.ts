import { describe, expect, it } from "vitest";
import { createTtlCache } from "./cache";

describe("createTtlCache", () => {
  it("caches loads and reuses them within the TTL", async () => {
    let clock = 1000;
    let calls = 0;
    const cache = createTtlCache(
      async (key) => {
        calls += 1;
        return `v-${key}-${calls}`;
      },
      { ttlMs: 30_000, now: () => clock },
    );

    const a = await cache.get("shop.acme.test");
    const b = await cache.get("shop.acme.test");
    expect(a).toBe("v-shop.acme.test-1");
    expect(b).toBe("v-shop.acme.test-1");
    expect(calls).toBe(1);

    clock += 29_000;
    const c = await cache.get("shop.acme.test");
    expect(c).toBe("v-shop.acme.test-1");
    expect(calls).toBe(1);
  });

  it("reloads after TTL expiry", async () => {
    let clock = 1000;
    let calls = 0;
    const cache = createTtlCache(
      async () => {
        calls += 1;
        return `v-${calls}`;
      },
      { ttlMs: 30_000, now: () => clock },
    );

    await cache.get("k");
    expect(calls).toBe(1);

    clock += 30_001;
    const reloaded = await cache.get("k");
    expect(calls).toBe(2);
    expect(reloaded).toBe("v-2");
  });

  it("coalesces concurrent misses into a single load", async () => {
    let calls = 0;
    let resolveFn: ((v: string) => void) = () => {};
    const cache = createTtlCache(
      () =>
        new Promise<string>((resolve) => {
          calls += 1;
          resolveFn = resolve;
        }),
      { ttlMs: 30_000 },
    );

    const p1 = cache.get("k");
    const p2 = cache.get("k");
    expect(calls).toBe(1);
    resolveFn("shared");
    expect(await p1).toBe("shared");
    expect(await p2).toBe("shared");
    expect(calls).toBe(1);
  });

  it("does not cache errors — next call retries", async () => {
    let clock = 1000;
    let calls = 0;
    const cache = createTtlCache(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return "ok";
      },
      { ttlMs: 30_000, now: () => clock },
    );

    await expect(cache.get("k")).rejects.toThrow("boom");
    expect(await cache.get("k")).toBe("ok");
    expect(calls).toBe(2);
  });

  it("invalidate(key) drops one entry; invalidate() clears all", async () => {
    let calls = 0;
    const cache = createTtlCache(
      async () => `v-${++calls}`,
      { ttlMs: 30_000 },
    );

    await cache.get("a");
    await cache.get("b");
    expect(cache.size()).toBe(2);

    cache.invalidate("a");
    expect(cache.size()).toBe(1);
    await cache.get("a");
    expect(calls).toBe(3);

    cache.invalidate();
    expect(cache.size()).toBe(0);
  });

  it("rejects a non-positive TTL", () => {
    expect(() => createTtlCache(async () => "x", { ttlMs: 0 })).toThrow(
      /ttlMs/,
    );
  });
});
