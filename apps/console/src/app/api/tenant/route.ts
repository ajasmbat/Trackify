import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getTenantBySlug } from "@/lib/queries";
import { TENANT_COOKIE } from "@/lib/tenant";

export const runtime = "nodejs";

// POST /api/tenant  { slug: "..." }  — sets the active tenant cookie.
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}) as unknown);
  const slug =
    body && typeof body === "object" && "slug" in body
      ? String((body as { slug: unknown }).slug)
      : "";
  if (!slug) return NextResponse.json({ error: "missing slug" }, { status: 400 });

  const tenant = await getTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "no such tenant" }, { status: 404 });

  cookies().set(TENANT_COOKIE, tenant.slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return NextResponse.json({ ok: true, tenant });
}
