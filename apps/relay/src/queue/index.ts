import { Pool } from "pg";
import type { Logger } from "pino";
import { logger as sharedLogger } from "@trackify/shared";
import { createWorker, type Worker, type WorkerOptions } from "./worker";
import { DestinationRegistry } from "./registry";

export { DestinationRegistry } from "./registry";
export { createWorker, type Worker, type WorkerOptions } from "./worker";
export { claimBatch, persistDone, persistRetry, persistDeadLetter } from "./persist";
export { classify, type Outcome } from "./classify";
export { nextAttemptAt, baseDelayMs, jitterMs, MAX_ATTEMPTS } from "./backoff";
export { FakeDestination, type FakeScript } from "./fake";

// Boot helper for the relay app. Owns a SEPARATE pg.Pool from the ingest side
// (the constraint: the worker must not compete with request handlers for
// connections) and returns a Worker the app can start()/stop().
//
// The registry is passed in so server.ts is the one place that wires real
// adapters (Meta, GA4, …) — the queue itself has no adapter imports.
export interface BootOptions {
  databaseUrl: string;
  registry: DestinationRegistry;
  logger?: Logger;
  poolSize?: number;
  workerOptions?: Omit<WorkerOptions, "pool" | "registry" | "logger">;
}

export interface Booted {
  worker: Worker;
  pool: Pool;
  shutdown(): Promise<void>;
}

export function bootWorker(opts: BootOptions): Booted {
  const pool = new Pool({
    connectionString: opts.databaseUrl,
    max: opts.poolSize ?? 4,
  });
  const log = (opts.logger ?? sharedLogger()).child({ component: "delivery-worker" });
  // pg emits 'error' on the pool when a pooled idle connection dies (Postgres
  // restart, admin terminate, network drop). Log it and move on — the next
  // acquire creates a new client. Without this handler pg re-throws and the
  // whole process crashes.
  pool.on("error", (err) => {
    log.warn({ err: err.message }, "delivery worker pool connection error");
  });
  const worker = createWorker({
    pool,
    registry: opts.registry,
    logger: log,
    ...opts.workerOptions,
  });
  return {
    worker,
    pool,
    async shutdown() {
      await worker.stop();
      await pool.end();
    },
  };
}
