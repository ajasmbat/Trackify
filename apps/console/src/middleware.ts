import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Combines request-id stamping with Auth.js session gating. Attach the id
// BEFORE the auth check so a signed-out redirect still shares the id with
// the downstream request log.

const PUBLIC_PATHS = new Set(["/signin"]);
const PUBLIC_PREFIXES = ["/api/auth/", "/_next/", "/favicon"];

export default auth((req) => {
  const requestId =
    req.headers.get("x-request-id") ?? crypto.randomUUID();

  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set("x-request-id", requestId);

  const url = new URL(req.url);
  const isPublic =
    PUBLIC_PATHS.has(url.pathname) ||
    PUBLIC_PREFIXES.some((p) => url.pathname.startsWith(p));

  if (!req.auth && !isPublic) {
    const signInUrl = new URL("/signin", req.url);
    signInUrl.searchParams.set("callbackUrl", url.pathname + url.search);
    const redirect = NextResponse.redirect(signInUrl);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  const res = NextResponse.next({ request: { headers: forwardedHeaders } });
  res.headers.set("x-request-id", requestId);
  return res;
});

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
