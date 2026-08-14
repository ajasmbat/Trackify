import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { logger } from "@trackify/shared";
import { warnMetaTestEventInProdAtBoot } from "./boot";

vi.mock("@trackify/db", () => ({
  decryptCredentials: vi.fn(async (b64: string) => JSON.parse(b64)),
}));

function fakePool(rows: Array<{ credentials_encrypted: string }>): Pool {
  return {
    query: vi.fn(async () => ({ rows })),
  } as unknown as Pool;
}

describe("warnMetaTestEventInProdAtBoot", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger(), "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("warns for each production-with-test_event_code destination", async () => {
    const pool = fakePool([
      {
        credentials_encrypted: JSON.stringify({
          pixel_id: "1",
          access_token: "t",
          test_event_code: "TEST1",
        }),
      },
      {
        credentials_encrypted: JSON.stringify({
          pixel_id: "2",
          access_token: "t",
        }),
      },
    ]);

    const count = await warnMetaTestEventInProdAtBoot(pool, {
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(count).toBe(1);
    const call = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.code).toBe("meta_test_event_in_prod");
    expect(call.pixel_id).toBe("1");
  });

  it("stays silent when NODE_ENV is not production", async () => {
    const pool = fakePool([
      {
        credentials_encrypted: JSON.stringify({
          pixel_id: "1",
          access_token: "t",
          test_event_code: "TEST1",
        }),
      },
    ]);

    const count = await warnMetaTestEventInProdAtBoot(pool, {
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);

    expect(count).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("never throws on a DB error — logs meta_boot_warn_failed and returns 0", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("pool down");
      }),
    } as unknown as Pool;

    const count = await warnMetaTestEventInProdAtBoot(pool, {
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(count).toBe(0);
    const call = warnSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.code).toBe("meta_boot_warn_failed");
  });
});
