import { cookies } from "next/headers";
import { getTenantBySlug, listTenants, type TenantSummary } from "./queries";

export const TENANT_COOKIE = "trackify_console_tenant";

/**
 * Server-side helper: current tenant based on the cookie, falling back to
 * the first tenant alphabetically if the cookie is missing or stale.
 * Returns `null` only when the DB has no tenants (fresh install).
 */
export async function currentTenant(): Promise<{
  active: TenantSummary | null;
  all: TenantSummary[];
}> {
  const all = await listTenants();
  if (all.length === 0) return { active: null, all };

  const slug = cookies().get(TENANT_COOKIE)?.value;
  if (slug) {
    const match = await getTenantBySlug(slug);
    if (match) return { active: match, all };
  }
  return { active: all[0] ?? null, all };
}
