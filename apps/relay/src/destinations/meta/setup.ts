import { and, eq } from "drizzle-orm";
import { logger } from "@trackify/shared";
import { db, encryptCredentials } from "@trackify/db";
import * as dbSchema from "@trackify/db/schema";
import { buildMetaCredentialsRecord } from "./credentials";

// Live Meta credential writer (T14). Reads META_* from the process env,
// encrypts them via the T1 helper, and upserts one seeded tenant's meta
// destination row so the delivery worker (T5 → T6 adapter) can start
// forwarding real events. The relay never reads META_* at runtime — the
// worker only ever sees the decrypted DB row.
//
// Lives inside destinations/meta/ so this folder stays the ONLY place in
// the repo that spells Meta credential field names (see the containment
// test in index.test.ts). Idempotent: re-running with the same env just
// overwrites the row's credentials + config.

interface MetaSetupEnv {
  META_PIXEL_ID: string;
  META_ACCESS_TOKEN: string;
  META_TEST_EVENT_CODE?: string;
  META_SETUP_TENANT_SLUG: string;
}

function readEnv(env: NodeJS.ProcessEnv = process.env): MetaSetupEnv {
  const missing: string[] = [];
  const pixelId = env.META_PIXEL_ID?.trim();
  const accessToken = env.META_ACCESS_TOKEN?.trim();
  const tenantSlug = env.META_SETUP_TENANT_SLUG?.trim() || "acme";
  if (!pixelId) missing.push("META_PIXEL_ID");
  if (!accessToken) missing.push("META_ACCESS_TOKEN");
  if (missing.length > 0) {
    throw new Error(
      `missing required env: ${missing.join(", ")}. See .env.example for the T14 block.`,
    );
  }
  const testEventCode = env.META_TEST_EVENT_CODE?.trim();
  return {
    META_PIXEL_ID: pixelId!,
    META_ACCESS_TOKEN: accessToken!,
    META_TEST_EVENT_CODE:
      testEventCode && testEventCode.length > 0 ? testEventCode : undefined,
    META_SETUP_TENANT_SLUG: tenantSlug,
  };
}

async function main() {
  const log = logger();
  const cfg = readEnv();
  const client = db();

  const [tenant] = await client
    .select({ id: dbSchema.tenants.id, slug: dbSchema.tenants.slug })
    .from(dbSchema.tenants)
    .where(eq(dbSchema.tenants.slug, cfg.META_SETUP_TENANT_SLUG))
    .limit(1);
  if (!tenant) {
    throw new Error(
      `tenant not found for slug "${cfg.META_SETUP_TENANT_SLUG}" — run \`pnpm seed\` first`,
    );
  }

  const credentials = buildMetaCredentialsRecord({
    pixelId: cfg.META_PIXEL_ID,
    accessToken: cfg.META_ACCESS_TOKEN,
    testEventCode: cfg.META_TEST_EVENT_CODE,
  });
  const encrypted = await encryptCredentials(credentials);

  const [existing] = await client
    .select({ id: dbSchema.destinations.id })
    .from(dbSchema.destinations)
    .where(
      and(
        eq(dbSchema.destinations.tenantId, tenant.id),
        eq(dbSchema.destinations.provider, "meta"),
      ),
    )
    .limit(1);

  const mode = cfg.META_TEST_EVENT_CODE ? "TEST" : "LIVE";

  if (existing) {
    await client
      .update(dbSchema.destinations)
      .set({
        config: { pixel_id: cfg.META_PIXEL_ID },
        credentialsEncrypted: encrypted,
        enabled: true,
        updatedAt: new Date(),
      })
      .where(eq(dbSchema.destinations.id, existing.id));
    log.info(
      {
        tenant_slug: tenant.slug,
        destination_id: existing.id,
        pixel_id: cfg.META_PIXEL_ID,
        mode,
      },
      "updated meta destination with live credentials",
    );
  } else {
    const [inserted] = await client
      .insert(dbSchema.destinations)
      .values({
        tenantId: tenant.id,
        provider: "meta",
        config: { pixel_id: cfg.META_PIXEL_ID },
        credentialsEncrypted: encrypted,
      })
      .returning({ id: dbSchema.destinations.id });
    log.info(
      {
        tenant_slug: tenant.slug,
        destination_id: inserted?.id,
        pixel_id: cfg.META_PIXEL_ID,
        mode,
      },
      "inserted meta destination with live credentials",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  const log = logger();
  log.error(
    { err: err instanceof Error ? err.message : String(err) },
    "setup:meta failed",
  );
  process.exit(1);
});
