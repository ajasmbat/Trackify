import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { schema } from "@trackify/db";
import type { SgtmContainer } from "@trackify/db/schema";

// Minimal repository over `sgtm_containers`. Both the provisioner and the
// route handlers talk to Postgres exclusively through this — the drizzle
// query builders never leak past this file, which keeps the unit tests from
// having to fake the whole ORM.

export interface ContainerRow extends SgtmContainer {}

export interface InsertProvisioning {
  tenantId: string;
  gtmContainerId: string;
  subdomain: string;
  previewServerUrl?: string;
}

export interface UpdateFields {
  status?: string;
  containerState?: Record<string, unknown>;
  lastError?: string | null;
}

export interface SgtmContainerRepo {
  insertProvisioning(row: InsertProvisioning): Promise<ContainerRow>;
  findById(id: string): Promise<ContainerRow | null>;
  findReadyBySubdomain(subdomain: string): Promise<ContainerRow | null>;
  update(id: string, patch: UpdateFields): Promise<ContainerRow | null>;
}

export function createDrizzleRepo(
  db: NodePgDatabase<typeof schema>,
): SgtmContainerRepo {
  return {
    async insertProvisioning(row) {
      const [inserted] = await db
        .insert(schema.sgtmContainers)
        .values({
          tenantId: row.tenantId,
          gtmContainerId: row.gtmContainerId,
          subdomain: row.subdomain,
          status: "provisioning",
          containerState: {},
          previewServerUrl: row.previewServerUrl,
        })
        .returning();
      if (!inserted) throw new Error("insert returned no row");
      return inserted;
    },
    async findById(id) {
      const [row] = await db
        .select()
        .from(schema.sgtmContainers)
        .where(eq(schema.sgtmContainers.id, id))
        .limit(1);
      return row ?? null;
    },
    async findReadyBySubdomain(subdomain) {
      const [row] = await db
        .select()
        .from(schema.sgtmContainers)
        .where(
          and(
            eq(schema.sgtmContainers.subdomain, subdomain),
            eq(schema.sgtmContainers.status, "ready"),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async update(id, patch) {
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.status !== undefined) values["status"] = patch.status;
      if (patch.containerState !== undefined)
        values["containerState"] = patch.containerState;
      if (patch.lastError !== undefined) values["lastError"] = patch.lastError;
      const [row] = await db
        .update(schema.sgtmContainers)
        .set(values)
        .where(eq(schema.sgtmContainers.id, id))
        .returning();
      return row ?? null;
    },
  };
}
