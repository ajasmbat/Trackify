import { randomBytes } from "node:crypto";
import { db, encryptCredentials } from "./index";
import { tenants, hostnames, destinations } from "./schema/index";
import { logger } from "@trackify/shared";

// URL-safe base64 alphabet, 6 bits per char. 8 chars = 48 bits — comfortably
// over T11's 40-bit floor, still short enough that a `<script src>` tag stays
// readable at a glance. CSPRNG is `node:crypto`.
export function newLoaderPath(): string {
  return randomBytes(6)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

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
      allowedOrigins: ["https://shop.acme.test"],
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
      allowedOrigins: ["https://shop.globex.test"],
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
      .values({
        slug: t.slug,
        name: t.name,
        allowedOrigins: [...t.allowedOrigins],
        loaderPath: newLoaderPath(),
      })
      .onConflictDoUpdate({
        // loaderPath is deliberately NOT in the update set — the path is
        // generated once on first provisioning and re-seeding must not
        // rotate it (rotating breaks cached storefront <script src> tags).
        target: tenants.slug,
        set: { name: t.name, allowedOrigins: [...t.allowedOrigins] },
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
      {
        tenant_id: tenant.id,
        slug: t.slug,
        hostname: t.hostname,
        loader_path: tenant.loaderPath,
      },
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
