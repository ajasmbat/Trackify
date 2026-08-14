import { NextResponse } from "next/server";
import { clickTargetUrl } from "@/lib/click-params";
import { storefrontOrigin } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const campaign = requestUrl.searchParams.get("campaign") ?? undefined;
  const target = clickTargetUrl(storefrontOrigin(), campaign);
  return NextResponse.redirect(target, { status: 302 });
}
