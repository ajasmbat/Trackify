import { describe, expect, it } from "vitest";
import type { CanonicalEvent } from "@trackify/shared";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import { persistEvent } from "./persist";

// Table identity is by object reference — we key our mock on the same
// exported schema tables persist.ts uses.
const TABLES = new Map<unknown, string>([
  [schema.visitors, "visitors"],
  [schema.events, "events"],
  [schema.deliveryJobs, "delivery_jobs"],
]);

interface MockState {
  ops: string[]; // rows we accepted at each step, in order
  committed: boolean;
  failOn?: "events" | "delivery_jobs";
}

function makeMockDb(state: MockState): Db {
  function txClient(): unknown {
    return {
      insert(table: unknown) {
        const name = TABLES.get(table);
        if (!name) throw new Error(`unknown table`);
        return chainFor(name);
      },
      select() {
        return {
          from() {
            return {
              where() {
                return Promise.resolve([]);
              },
            };
          },
        };
      },
    };

    function chainFor(name: string) {
      let recorded = false;
      const record = (values: unknown) => {
        if (recorded) return;
        recorded = true;
        state.ops.push(`insert:${name}`);
        if (state.failOn === name) {
          throw new Error(`simulated failure on ${name}`);
        }
      };
      const idRow = { id: `${name}-id-1` };
      const returningRows = name === "delivery_jobs" ? [] : [idRow];

      const chain = {
        values(values: unknown) {
          record(values);
          return chain;
        },
        onConflictDoUpdate() {
          return chain;
        },
        onConflictDoNothing() {
          return chain;
        },
        returning() {
          return Promise.resolve(returningRows);
        },
        // Bare-await support (delivery_jobs is inserted without .returning()).
        then(
          resolve: (value: unknown) => void,
          reject: (reason: unknown) => void,
        ) {
          try {
            // record(...) already ran on .values(), so no-op here.
            resolve(returningRows);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    }
  }

  return {
    async transaction<T>(cb: (tx: unknown) => Promise<T>): Promise<T> {
      const result = await cb(txClient());
      state.committed = true;
      return result;
    },
  } as unknown as Db;
}

function baseEvent(): CanonicalEvent {
  return {
    name: "page_view",
    event_id: "11111111-1111-4111-8111-111111111111",
    journey_id: "j-1",
    visitor_id: "v-1",
    tenant_id: "t-1",
    ts: "2026-08-14T00:00:00.000Z",
    props: { path: "/" },
  };
}

describe("persistEvent", () => {
  it("commits both event and delivery_jobs rows on the happy path", async () => {
    const state: MockState = { ops: [], committed: false };
    const mock = makeMockDb(state);

    const result = await persistEvent(
      {
        tenantId: "tenant-uuid",
        destinationIds: ["dest-a", "dest-b"],
        event: baseEvent(),
        identity: undefined,
        server: { received_at: "2026-08-14T00:00:00.000Z" },
      },
      mock,
    );

    expect(state.committed).toBe(true);
    expect(state.ops).toEqual([
      "insert:visitors",
      "insert:events",
      "insert:delivery_jobs",
    ]);
    expect(result.duplicate).toBe(false);
    expect(result.eventId).toBe(baseEvent().event_id);
  });

  it("rolls back when enqueue fails — no commit reached", async () => {
    const state: MockState = {
      ops: [],
      committed: false,
      failOn: "delivery_jobs",
    };
    const mock = makeMockDb(state);

    await expect(
      persistEvent(
        {
          tenantId: "tenant-uuid",
          destinationIds: ["dest-a"],
          event: baseEvent(),
          identity: undefined,
          server: { received_at: "2026-08-14T00:00:00.000Z" },
        },
        mock,
      ),
    ).rejects.toThrow(/simulated failure on delivery_jobs/);

    expect(state.committed).toBe(false);
    // We reached events insert but the enqueue step threw — drizzle's
    // real client would roll back the transaction; the callback rejecting
    // is what triggers that.
    expect(state.ops).toEqual([
      "insert:visitors",
      "insert:events",
      "insert:delivery_jobs",
    ]);
  });

  it("skips the delivery_jobs insert when there are no destinations", async () => {
    const state: MockState = { ops: [], committed: false };
    const mock = makeMockDb(state);

    await persistEvent(
      {
        tenantId: "tenant-uuid",
        destinationIds: [],
        event: baseEvent(),
        identity: undefined,
        server: { received_at: "2026-08-14T00:00:00.000Z" },
      },
      mock,
    );

    expect(state.committed).toBe(true);
    expect(state.ops).toEqual(["insert:visitors", "insert:events"]);
  });
});
