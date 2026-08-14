// Exponential backoff for delivery retries.
//
// Base schedule (attempt → wait until next attempt): 1s, 2s, 4s, 8s, 16s, 32s.
// Attempts are 1-indexed and capped at MAX_ATTEMPTS; once a job has completed
// its MAX_ATTEMPTS'th attempt without a success, it dead-letters — see
// classify.ts + persist.ts. Total window is ~1 minute by design (Meta's dedup
// window and our own SLAs make late deliveries worse than dropped ones — see
// DECISIONS / this ticket's plan).
//
// A ±JITTER_RATIO fraction of jitter is added to break lockstep — if 1000
// events fail on the same 5xx they retry in a spread instead of hammering the
// destination together.

export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 1_000;
const JITTER_RATIO = 0.25;

/**
 * Compute the base (pre-jitter) delay in ms for the wait *after* the Nth
 * attempt. Exposed for tests — production callers use `nextAttemptAt`.
 */
export function baseDelayMs(attempt: number): number {
  if (attempt < 1) throw new RangeError(`attempt must be >= 1, got ${attempt}`);
  return BASE_DELAY_MS * 2 ** (attempt - 1);
}

/**
 * Pick a random offset in [-JITTER_RATIO, +JITTER_RATIO] * base for the wait
 * after this attempt. Broken out so tests can pass a deterministic RNG.
 */
export function jitterMs(baseMs: number, rand: () => number = Math.random): number {
  const spread = baseMs * JITTER_RATIO;
  return Math.round(spread * (rand() * 2 - 1));
}

/**
 * Given the attempt that just failed transiently, return when to try again.
 * Returns `null` when the job has exhausted its attempts and must dead-letter.
 */
export function nextAttemptAt(
  attempt: number,
  now: Date,
  rand: () => number = Math.random,
): Date | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  const base = baseDelayMs(attempt);
  const delay = base + jitterMs(base, rand);
  return new Date(now.getTime() + delay);
}
