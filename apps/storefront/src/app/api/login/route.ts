import { IDENTITY_COOKIE, serializeIdentity } from "@/lib/session";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Fake login. Accepts { email, phone } (JSON or form data), stores it on the
// session cookie plaintext. Hashing PII is T4's job — this endpoint exists
// only so the storefront has a real "you are now identified" moment.

const IDENTITY_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function readIdentity(req: NextRequest): Promise<{ email: string; phone: string } | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as { email?: unknown; phone?: unknown };
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (!email || !phone) return null;
      return { email, phone };
    } catch {
      return null;
    }
  }
  const form = await req.formData();
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const phone = String(form.get("phone") ?? "").trim();
  if (!email || !phone) return null;
  return { email, phone };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const identity = await readIdentity(req);
  if (!identity) {
    return NextResponse.json({ ok: false, error: "email and phone are required" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, email: identity.email });
  res.cookies.set(IDENTITY_COOKIE, serializeIdentity(identity), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: IDENTITY_MAX_AGE,
  });
  return res;
}
