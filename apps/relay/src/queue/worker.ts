import type { Pool } from "pg";
import type { Logger } from "pino";
import type { CanonicalEvent, Destination, SendResult } from "@trackify/shared";
import { decryptCredentials } from "@trackify/db";
import { classify } from "./classify";
import { MAX_ATTEMPTS, nextAttemptAt } from "./backoff";
import {
  claimBatch,
  persistDeadLetter,
  persistDone,
  persistRetry,
  type ClaimedJob,
} from "./persist";
import type { DestinationRegistry } from "./registry";

// The delivery worker. One process runs the loop; multiple processes can run
// side-by-side against the same Postgres and never claim the same job — the
// concurrency guarantee is `FOR UPDATE SKIP LOCKED` inside `claimBatch`.
//
// The worker never holds a transaction across the destination call:
//   1. claimBatch flips due rows to `in_flight` in one atomic UPDATE
//   2. the destination adapter's send() runs OUTSIDE any DB transaction
//   3. persist* writes back the terminal (or scheduled-retry) state
// A worker that crashes at step 2 leaves the row in `in_flight`; the claim
// TTL (default 5 minutes) pushed `next_attempt_at` forward, so after the TTL
// expires the next poll re-claims it. No separate reaper needed.

export interface WorkerOptions {
  pool: Pool;
  registry: DestinationRegistry;
  logger: Logger;
  /** Rows claimed per poll iteration. */
  batchSize?: number;
  /** How long a claim is exclusive before another worker may steal it. */
  claimTtlSeconds?: number;
  /** Poll gap when there's work to do (short — pull as fast as we can). */
  activePollMs?: number;
  /** Poll gap when the queue is empty (longer — don't hammer the DB). */
  idlePollMs?: number;
  /** RNG for the backoff jitter — pinned in tests for determinism. */
  rand?: () => number;
  /** Now() supplier — pinned in tests. */
  now?: () => Date;
}

export interface Worker {
  start(): void;
  stop(): Promise<void>;
  /** Run one poll cycle. Exposed for tests — production uses `start()`. */
  processBatch(): Promise<number>;
}

export function createWorker(opts: WorkerOptions): Worker {
  const {
    pool,
    registry,
    logger,
    batchSize = 10,
    claimTtlSeconds = 300,
    activePollMs = 50,
    idlePollMs = 1_000,
    rand = Math.random,
    now = () => new Date(),
  } = opts;

  let running = false;
  let stopping = false;
  let currentTick: Promise<void> | null = null;
  let sleepTimer: NodeJS.Timeout | null = null;
  let sleepResolve: (() => void) | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      sleepResolve = resolve;
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  function wake(): void {
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
    if (sleepResolve) {
      const r = sleepResolve;
      sleepResolve = null;
      r();
    }
  }

  async function processJob(job: ClaimedJob): Promise<void> {
    const attemptNumber = job.attempts + 1; // this attempt
    const ctx = {
      jobId: job.id,
      eventId: job.eventId,
      destinationId: job.destinationId,
      outboundPayload: null as unknown,
    };
    const jobLog = logger.child({
      job_id: job.id,
      destination_id: job.destinationId,
      event_id: job.eventId,
      tenant_id: job.tenantId,
      attempt: attemptNumber,
    });

    // 1. Resolve destination row + credentials + adapter.
    let destination: Destination;
    let credentials: Record<string, string>;
    try {
      const dst = await loadDestination(pool, job.destinationId);
      if (!dst) {
        // The destination was deleted between enqueue and process — this is
        // never coming back, so dead-letter it.
        await persistDeadLetter(pool, { ...ctx, outboundPayload: null }, "destination_not_found");
        jobLog.warn("destination row missing at process time — dead-lettered");
        return;
      }
      const adapter = registry.get(dst.provider);
      if (!adapter) {
        // Config bug: an unknown provider is not going to become known by
        // retrying — dead-letter it.
        await persistDeadLetter(
          pool,
          { ...ctx, outboundPayload: null },
          `no adapter registered for provider "${dst.provider}"`,
        );
        jobLog.warn({ provider: dst.provider }, "no adapter for provider — dead-lettered");
        return;
      }
      destination = adapter;
      credentials = await decryptCredentials(dst.credentials_encrypted);
    } catch (err) {
      // Setup failure (DB error, decryption error) — treat as transient so we
      // pick up again on the next poll. Backoff still applies via attempts.
      await scheduleRetryOrDeadLetter(
        ctx,
        attemptNumber,
        errorMessage(err),
        jobLog,
      );
      return;
    }

    // 2. Reconstruct the CanonicalEvent from the persisted inbound payload
    //    and hand it to the adapter. Any throw is a transient failure —
    //    better to retry than to silently drop a conversion on an adapter bug.
    let result: SendResult;
    const event = job.inboundPayload as CanonicalEvent;
    try {
      result = await destination.send(event, credentials);
    } catch (err) {
      // Network error, adapter bug, timeout, … all treated as transient.
      await scheduleRetryOrDeadLetter(
        ctx,
        attemptNumber,
        `send_threw: ${errorMessage(err)}`,
        jobLog,
      );
      return;
    }

    // 3. Classify and persist.
    ctx.outboundPayload = result.outbound_payload;
    const cls = classify(result);
    if (cls.outcome === "done") {
      await persistDone(pool, ctx);
      jobLog.info({ status: cls.status }, "delivery ok");
      return;
    }
    if (cls.outcome === "permanent") {
      await persistDeadLetter(
        pool,
        ctx,
        formatReason("permanent", cls.reason, cls.status),
      );
      jobLog.warn(
        { status: cls.status, reason: cls.reason },
        "delivery permanently failed — dead-lettered",
      );
      return;
    }
    // outcome === "retry"
    await scheduleRetryOrDeadLetter(
      ctx,
      attemptNumber,
      formatReason("transient", cls.reason, cls.status),
      jobLog,
    );
  }

  async function scheduleRetryOrDeadLetter(
    ctx: { jobId: string; eventId: string; destinationId: string; outboundPayload: unknown },
    attemptNumber: number,
    reason: string,
    jobLog: Logger,
  ): Promise<void> {
    const nextAt = nextAttemptAt(attemptNumber, now(), rand);
    if (nextAt === null) {
      await persistDeadLetter(pool, ctx, `attempts_exhausted (${MAX_ATTEMPTS}): ${reason}`);
      jobLog.warn(
        { attempts: attemptNumber, reason },
        "retries exhausted — dead-lettered",
      );
      return;
    }
    await persistRetry(pool, ctx, nextAt, reason);
    jobLog.info({ next_attempt_at: nextAt.toISOString(), reason }, "delivery retry scheduled");
  }

  async function processBatch(): Promise<number> {
    let jobs: ClaimedJob[];
    try {
      jobs = await claimBatch(pool, batchSize, claimTtlSeconds);
    } catch (err) {
      // DB unreachable / reconnecting. pg.Pool will re-establish; just wait
      // the idle beat and try again.
      logger.warn({ err: errorMessage(err) }, "queue claim failed — will retry");
      return 0;
    }

    for (const job of jobs) {
      try {
        await processJob(job);
      } catch (err) {
        // Should be unreachable — processJob catches its own; but if a persist
        // itself fails, the row stays in in_flight and the claim TTL will
        // eventually surface it.
        logger.error(
          { err: errorMessage(err), job_id: job.id },
          "unhandled error processing delivery job",
        );
      }
    }
    return jobs.length;
  }

  async function loop(): Promise<void> {
    while (running) {
      const processed = await processBatch();
      if (stopping) break;
      await sleep(processed > 0 ? activePollMs : idlePollMs);
    }
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      stopping = false;
      currentTick = loop();
      logger.info("delivery worker started");
    },
    async stop(): Promise<void> {
      if (!running) return;
      stopping = true;
      running = false;
      wake();
      await currentTick;
      currentTick = null;
      logger.info("delivery worker stopped");
    },
    processBatch,
  };
}

async function loadDestination(
  pool: Pool,
  id: string,
): Promise<{ provider: string; credentials_encrypted: string } | null> {
  const res = await pool.query<{ provider: string; credentials_encrypted: string }>(
    `SELECT provider, credentials_encrypted FROM destinations WHERE id = $1 LIMIT 1`,
    [id],
  );
  return res.rows[0] ?? null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatReason(prefix: string, reason?: string, status?: number): string {
  const parts = [prefix];
  if (typeof status === "number") parts.push(`status=${status}`);
  if (reason) parts.push(reason);
  return parts.join(": ");
}
