import type { Pool } from "pg";
import { decryptCredentials } from "@trackify/db";
import { logger } from "@trackify/shared";
import { warnIfTestEventInProduction } from "./index";

// T14 boot guardrail. Reads every enabled Meta destination row, decrypts its
// credentials, and hands the whole set to `warnIfTestEventInProduction` — the
// T6-defined helper that logs `meta_test_event_in_prod` for any destination
// still shipping `test_event_code` when NODE_ENV=production.
//
// Runs once at server startup. Never throws — a boot-time DB or crypto blip
// must not stop the relay from coming up; we log and move on so the acceptance
// grep "meta_test_event_in_prod" (or "meta_boot_warn_failed") always sees
// something in the logs.
export async function warnMetaTestEventInProdAtBoot(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const res = await pool.query<{ credentials_encrypted: string }>(
      `SELECT credentials_encrypted FROM destinations
       WHERE provider = 'meta' AND enabled = true`,
    );
    const decrypted = await Promise.all(
      res.rows.map((row) => decryptCredentials(row.credentials_encrypted)),
    );
    return warnIfTestEventInProduction(decrypted, env);
  } catch (err) {
    logger().warn(
      {
        code: "meta_boot_warn_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "meta boot guardrail failed to run",
    );
    return 0;
  }
}
