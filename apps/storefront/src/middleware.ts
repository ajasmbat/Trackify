import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge middleware — mint a request id if the client didn't supply one so every
// downstream log line for this request can carry it. journey_id is passed
// through untouched (T8's loader mints it).
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
