import { NextResponse } from "next/server";
import { storefrontOrigin } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(new URL("/", storefrontOrigin()).toString(), {
    status: 302,
  });
}
