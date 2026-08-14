"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { TenantSummary } from "@/lib/queries";

interface Props {
  active: TenantSummary | null;
  tenants: TenantSummary[];
}

export function TenantSwitcher({ active, tenants }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (tenants.length === 0) {
    return (
      <span style={{ opacity: 0.6, fontSize: 13 }}>no tenants — run pnpm seed</span>
    );
  }

  return (
    <select
      value={active?.slug ?? ""}
      disabled={pending}
      onChange={(e) => {
        const slug = e.currentTarget.value;
        startTransition(async () => {
          const res = await fetch("/api/tenant", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug }),
          });
          if (res.ok) router.refresh();
        });
      }}
      style={{
        background: "#151a20",
        color: "#e4e6eb",
        border: "1px solid #2a323d",
        borderRadius: 6,
        padding: "0.35rem 0.55rem",
        fontSize: 13,
      }}
    >
      {tenants.map((t) => (
        <option key={t.slug} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
