import { describe, expect, it } from "vitest";
import { waitForHealthy } from "./health";

describe("waitForHealthy", () => {
  it("resolves ok once fetch returns 200 — retries in the meantime", async () => {
    let call = 0;
    const now = { t: 0 };
    const res = await waitForHealthy({
      hostPort: 12345,
      totalTimeoutMs: 5_000,
      intervalMs: 100,
      fetch: async () => {
        call += 1;
        if (call < 3) throw new Error("ECONNREFUSED");
        return { status: 200 };
      },
      now: () => now.t,
      sleep: async (ms) => {
        now.t += ms;
      },
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
    expect(res.lastStatus).toBe(200);
  });

  it("gives up once the deadline elapses and returns the last error", async () => {
    const now = { t: 0 };
    const res = await waitForHealthy({
      hostPort: 12345,
      totalTimeoutMs: 500,
      intervalMs: 100,
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      now: () => now.t,
      sleep: async (ms) => {
        now.t += ms;
      },
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBeGreaterThanOrEqual(1);
    expect(res.lastError).toMatch(/ECONNREFUSED/);
  });

  it("treats non-2xx as a retryable miss", async () => {
    const now = { t: 0 };
    let call = 0;
    const res = await waitForHealthy({
      hostPort: 12345,
      totalTimeoutMs: 5_000,
      intervalMs: 50,
      fetch: async () => {
        call += 1;
        return { status: call < 4 ? 503 : 200 };
      },
      now: () => now.t,
      sleep: async (ms) => {
        now.t += ms;
      },
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(4);
  });
});
