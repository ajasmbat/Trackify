import { NextResponse } from "next/server";
import { logger, withRequestContext } from "@trackify/shared";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const journeyId = request.headers.get("x-journey-id") ?? undefined;

  return withRequestContext(
    { request_id: requestId, journey_id: journeyId },
    () => {
      logger().info({ app: "console", route: "/api/health" }, "healthz");
      return NextResponse.json(
        { ok: true, app: "console" },
        { headers: { "x-request-id": requestId } },
      );
    },
  );
}
