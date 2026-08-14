import { db, encryptCredentials } from "./index";
import { tenants, hostnames, destinations } from "./schema/index";
import { logger } from "@trackify/shared";

// Two tenants with distinct hostnames and distinct destination configs.
// Deterministic + idempotent: safe to re-run against a fresh DB or an existing one.

async function main() {
  const log = logger();
  const client = db();

  const seedTenants = [
    {
      slug: "acme",
      name: "Acme Widgets",
      hostname: "shop.acme.test",
      destination: {
        provider: "meta",
        config: { pixel_id: "111111111111111", dataset_id: "111111111111111" },
        credentials: { access_token: "SEED_ACME_META_TOKEN" },
      },
    },
    {
      slug: "globex",
      name: "Globex Corp",
      hostname: "shop.globex.test",
      destination: {
        provider: "meta",
        config: { pixel_id: "222222222222222", dataset_id: "222222222222222" },
        credentials: { access_token: "SEED_GLOBEX_META_TOKEN" },
      },
    },
  ] as const;

  for (const t of seedTenants) {
    const [tenant] = await client
      .insert(tenants)
      .values({ slug: t.slug, name: t.name })
      .onConflictDoUpdate({
        target: tenants.slug,
        set: { name: t.name },
      })
      .returning();
    if (!tenant) throw new Error(`failed to upsert tenant ${t.slug}`);

    await client
      .insert(hostnames)
      .values({ tenantId: tenant.id, hostname: t.hostname })
      .onConflictDoNothing({ target: hostnames.hostname });

    const encrypted = await encryptCredentials(t.destination.credentials);
    await client.insert(destinations).values({
      tenantId: tenant.id,
      provider: t.destination.provider,
      config: t.destination.config,
      credentialsEncrypted: encrypted,
    });

    log.info(
      { tenant_id: tenant.id, slug: t.slug, hostname: t.hostname },
      "seeded tenant",
    );
  }

  log.info({ count: seedTenants.length }, "seed complete");
  process.exit(0);
}

main().catch((err) => {
  const log = logger();
  log.error({ err: err instanceof Error ? err.message : String(err) }, "seed failed");
  process.exit(1);
});
