import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, baseDelayMs, jitterMs, nextAttemptAt } from "./backoff";

describe("backoff", () => {
  it("doubles the base delay each attempt: 1s → 2s → 4s → 8s → 16s → 32s", () => {
    expect(baseDelayMs(1)).toBe(1_000);
    expect(baseDelayMs(2)).toBe(2_000);
    expect(baseDelayMs(3)).toBe(4_000);
    expect(baseDelayMs(4)).toBe(8_000);
    expect(baseDelayMs(5)).toBe(16_000);
    expect(baseDelayMs(6)).toBe(32_000);
  });

  it("rejects attempt < 1", () => {
    expect(() => baseDelayMs(0)).toThrow(RangeError);
    expect(() => baseDelayMs(-1)).toThrow(RangeError);
  });

  it("jitter stays within ±25% of the base delay", () => {
    for (let i = 0; i < 1_000; i++) {
      const base = baseDelayMs(1 + (i % MAX_ATTEMPTS));
      const j = jitterMs(base);
      expect(Math.abs(j)).toBeLessThanOrEqual(base * 0.25 + 1);
    }
  });

  it("nextAttemptAt returns null once attempts hit MAX_ATTEMPTS (dead-letter signal)", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(nextAttemptAt(MAX_ATTEMPTS, now)).toBeNull();
    expect(nextAttemptAt(MAX_ATTEMPTS + 1, now)).toBeNull();
  });

  it("nextAttemptAt schedules within the expected window for each attempt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    // Deterministic mid-jitter RNG so we assert exact millisecond math.
    const rand = () => 0.5; // → jitterMs = 0
    const schedule = Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => {
      const next = nextAttemptAt(i + 1, now, rand);
      expect(next).not.toBeNull();
      return next!.getTime() - now.getTime();
    });
    expect(schedule).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it("nextAttemptAt jitter stays within ±25% of the base for each attempt", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      const base = baseDelayMs(attempt);
      for (let i = 0; i < 200; i++) {
        const next = nextAttemptAt(attempt, now)!;
        const delay = next.getTime() - now.getTime();
        expect(delay).toBeGreaterThanOrEqual(base * 0.75 - 1);
        expect(delay).toBeLessThanOrEqual(base * 1.25 + 1);
      }
    }
  });
});
