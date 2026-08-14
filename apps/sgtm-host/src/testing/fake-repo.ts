import { randomUUID } from "node:crypto";
import type {
  ContainerRow,
  InsertProvisioning,
  SgtmContainerRepo,
  UpdateFields,
} from "../repo";

// In-memory SgtmContainerRepo, used by the unit tests instead of a real
// Postgres. Not exported from the app — only the tests import it.
export class FakeRepo implements SgtmContainerRepo {
  private readonly rows = new Map<string, ContainerRow>();

  async insertProvisioning(row: InsertProvisioning): Promise<ContainerRow> {
    const now = new Date();
    const created: ContainerRow = {
      id: randomUUID(),
      tenantId: row.tenantId,
      gtmContainerId: row.gtmContainerId,
      subdomain: row.subdomain,
      status: "provisioning",
      containerState: {},
      previewServerUrl: row.previewServerUrl ?? null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(created.id, created);
    return created;
  }

  async findById(id: string): Promise<ContainerRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findReadyBySubdomain(subdomain: string): Promise<ContainerRow | null> {
    for (const row of this.rows.values()) {
      if (row.subdomain === subdomain && row.status === "ready") return row;
    }
    return null;
  }

  async update(id: string, patch: UpdateFields): Promise<ContainerRow | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next: ContainerRow = {
      ...row,
      updatedAt: new Date(),
      status: patch.status ?? row.status,
      containerState: patch.containerState ?? row.containerState,
      lastError:
        patch.lastError === undefined ? row.lastError : patch.lastError,
    };
    this.rows.set(id, next);
    return next;
  }

  // Test-only helper — force a row into a specific state without going
  // through the provisioner (needed to test the proxy in isolation).
  seed(row: Partial<ContainerRow> & Pick<ContainerRow, "tenantId" | "subdomain">): ContainerRow {
    const now = new Date();
    const created: ContainerRow = {
      id: row.id ?? randomUUID(),
      tenantId: row.tenantId,
      gtmContainerId: row.gtmContainerId ?? "GTM-TEST",
      subdomain: row.subdomain,
      status: row.status ?? "ready",
      containerState: row.containerState ?? {},
      previewServerUrl: row.previewServerUrl ?? null,
      lastError: row.lastError ?? null,
      createdAt: row.createdAt ?? now,
      updatedAt: row.updatedAt ?? now,
    };
    this.rows.set(created.id, created);
    return created;
  }

  all(): ContainerRow[] {
    return [...this.rows.values()];
  }
}
