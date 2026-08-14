import type { Pool, PoolClient } from "pg";

// Persistence layer for the delivery worker. Everything the worker writes back
// to Postgres goes through here so the SQL lives in one place and stays
// readable. All writes are single-statement UPDATEs — there is no long-running
// transaction wrapping a destination call.
//
// The delivery_jobs.status vocabulary used by this worker:
//   - pending      — inserted by ingest; not yet attempted
//   - retrying     — a transient failure has been recorded; will be retried at next_attempt_at
//   - in_flight    — a worker has claimed the row (see claimBatch)
//   - done         — terminal success
//   - dead_letter  — terminal failure (permanent OR retries exhausted)
//
// Dead-lettered rows stay in the table on purpose — the operator console
// (ticket T10) surfaces them.

export interface ClaimedJob {
  id: string;
  tenantId: string;
  eventId: string;
  destinationId: string;
  attempts: number;
  inboundPayload: Record<string, unknown>;
}

// Two-line SQL that IS the concurrency guarantee.
// - The inner SELECT with `FOR UPDATE SKIP LOCKED` locks a small batch of due
//   rows, skipping any already locked by another worker.
// - The outer UPDATE flips them to in_flight so the same rows are not visible
//   to the next poll cycle (even after the row lock releases at COMMIT),
//   and returns everything we need to process them.
// The claim also pushes next_attempt_at forward by `claimTtlSeconds`; a worker
// that crashes mid-send leaves the row in `in_flight`, and the next poll after
// the TTL expires will re-claim it — no manual reaper required.
const CLAIM_SQL = `
  WITH claimed AS (
    SELECT id
    FROM delivery_jobs
    WHERE status IN ('pending', 'retrying', 'in_flight')
      AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
  )
  UPDATE delivery_jobs AS dj
     SET status = 'in_flight',
         next_attempt_at = now() + ($2 || ' seconds')::interval
    FROM claimed
   WHERE dj.id = claimed.id
   RETURNING dj.id,
             dj.tenant_id       AS "tenantId",
             dj.event_id        AS "eventId",
             dj.destination_id  AS "destinationId",
             dj.attempts,
             dj.inbound_payload AS "inboundPayload";
`;

export async function claimBatch(
  pool: Pool,
  limit: number,
  claimTtlSeconds: number,
): Promise<ClaimedJob[]> {
  const res = await pool.query<ClaimedJob>(CLAIM_SQL, [limit, claimTtlSeconds]);
  return res.rows;
}

interface WriteContext {
  jobId: string;
  eventId: string;
  destinationId: string;
  outboundPayload: unknown;
}

// Success: mark done, persist outbound_payload on the job, and write through
// to events.outbound_per_destination[<destinationId>] so hop 6 of the
// flow contract is verifiable end-to-end.
export async function persistDone(pool: Pool, ctx: WriteContext): Promise<void> {
  await withTx(pool, async (client) => {
    await client.query(
      `UPDATE delivery_jobs
          SET status = 'done',
              attempts = attempts + 1,
              outbound_payload = $2::jsonb,
              last_error = NULL,
              completed_at = now(),
              next_attempt_at = now()
        WHERE id = $1`,
      [ctx.jobId, JSON.stringify(ctx.outboundPayload)],
    );
    await client.query(
      `UPDATE events
          SET outbound_per_destination = outbound_per_destination || jsonb_build_object($2::text, $3::jsonb)
        WHERE id = $1`,
      [ctx.eventId, ctx.destinationId, JSON.stringify(ctx.outboundPayload)],
    );
  });
}

// Transient failure and we still have attempts left: bump attempts, record the
// reason on last_error, schedule the retry, persist the outbound payload
// (so the console can show what we sent even on failure).
export async function persistRetry(
  pool: Pool,
  ctx: WriteContext,
  nextAttemptAt: Date,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE delivery_jobs
        SET status = 'retrying',
            attempts = attempts + 1,
            outbound_payload = $2::jsonb,
            last_error = $3,
            next_attempt_at = $4
      WHERE id = $1`,
    [ctx.jobId, JSON.stringify(ctx.outboundPayload), reason, nextAttemptAt],
  );
}

// Permanent failure OR retries exhausted: dead-letter. Bumps attempts (this
// attempt happened), records the reason, and pushes next_attempt_at far into
// the future so a bug in the claim query cannot re-pick it up.
export async function persistDeadLetter(
  pool: Pool,
  ctx: WriteContext,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE delivery_jobs
        SET status = 'dead_letter',
            attempts = attempts + 1,
            outbound_payload = $2::jsonb,
            last_error = $3,
            completed_at = now(),
            next_attempt_at = 'infinity'::timestamptz
      WHERE id = $1`,
    [ctx.jobId, JSON.stringify(ctx.outboundPayload), reason],
  );
}

async function withTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}
