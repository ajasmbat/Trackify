import { describe, expect, it } from "vitest";
import type { Db } from "@trackify/db";
import * as schema from "@trackify/db/schema";
import { readVisitorFbc, upsertVisitorFbc } from "./store";

// Mock the drizzle client with the same reference-identity trick T4's
// persist.test.ts uses: the mock keys inserts by the same schema object
// the SUT imports.
const TABLES = new Map<unknown, string>([[schema.visitors, "visitors"]]);

interface Recorded {
  insertRows: Array<Record<string, unknown>>;
  selectResult: Array<{ fbc: string | null; fbp: string | null }>;
  selectCalls: number;
}

function makeMockDb(state: Recorded): Db {
  return {
    insert(table: unknown) {
      const name = TABLES.get(table);
      if (name !== "visitors") throw new Error(`unexpected table ${name}`);
      const chain = {
        values(row: Record<string, unknown>) {
          state.insertRows.push(row);
          return chain;
        },
        onConflictDoUpdate() {
          return chain;
        },
        // Both consumers await the chain directly.
        then(
          resolve: (v: unknown) => void,
          reject: (e: unknown) => void,
        ) {
          try {
            resolve(undefined);
          } catch (e) {
            reject(e);
          }
        },
      };
      return chain;
    },
    select() {
      state.selectCalls += 1;
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(state.selectResult);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Db;
}

const state = (): Recorded => ({
  insertRows: [],
  selectResult: [],
  selectCalls: 0,
});

describe("upsertVisitorFbc", () => {
  it("is a no-op when both fbc and fbp are missing (never touches the row)", async () => {
    const s = state();
    await upsertVisitorFbc(
      { tenantId: "t-1", visitorKey: "v-1" },
      makeMockDb(s),
    );
    expect(s.insertRows).toHaveLength(0);
  });

  it("writes the fbc value onto a visitors row keyed by (tenant, visitor_key)", async () => {
    const s = state();
    await upsertVisitorFbc(
      {
        tenantId: "t-1",
        visitorKey: "v-1",
        fbc: "fb.1.100.abc",
      },
      makeMockDb(s),
    );
    expect(s.insertRows).toHaveLength(1);
    expect(s.insertRows[0]).toMatchObject({
      tenantId: "t-1",
      visitorKey: "v-1",
      fbc: "fb.1.100.abc",
      fbp: null,
    });
  });

  it("writes fbp when supplied alone", async () => {
    const s = state();
    await upsertVisitorFbc(
      { tenantId: "t-1", visitorKey: "v-2", fbp: "fb.1.200.xyz" },
      makeMockDb(s),
    );
    expect(s.insertRows[0]).toMatchObject({
      tenantId: "t-1",
      visitorKey: "v-2",
      fbc: null,
      fbp: "fb.1.200.xyz",
    });
  });

  it("skips a whitespace-only fbc (no accidental empty writes)", async () => {
    const s = state();
    await upsertVisitorFbc(
      { tenantId: "t-1", visitorKey: "v-3", fbc: "   " },
      makeMockDb(s),
    );
    expect(s.insertRows).toHaveLength(0);
  });
});

describe("readVisitorFbc", () => {
  it("returns null when there is no row (missing visitor is not an error)", async () => {
    const s = state();
    const row = await readVisitorFbc(
      { tenantId: "t-1", visitorKey: "unknown" },
      makeMockDb(s),
    );
    expect(row).toBeNull();
    expect(s.selectCalls).toBe(1);
  });

  it("returns the persisted (fbc, fbp) when the row exists", async () => {
    const s = state();
    s.selectResult = [{ fbc: "fb.1.100.abc", fbp: null }];
    const row = await readVisitorFbc(
      { tenantId: "t-1", visitorKey: "v-1" },
      makeMockDb(s),
    );
    expect(row).toEqual({ fbc: "fb.1.100.abc", fbp: null });
  });
});
