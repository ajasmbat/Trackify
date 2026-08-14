import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { EVENT_NAMES } from "@trackify/shared";
import { currentTenant } from "@/lib/tenant";
import {
  listEvents,
  type EventStatus,
  type ListEventsFilter,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: EventStatus[] = [
  "pending",
  "in_flight",
  "retrying",
  "done",
  "dead_letter",
];

// GET /api/events?name=&status=&since=&from=&until=&limit=
// `since` is the live-tail cursor — client sends the highest received_at it
// has seen, server returns only strictly newer rows.
export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { active } = await currentTenant();
  if (!active) return NextResponse.json({ events: [], tenant: null });

  const url = new URL(request.url);
  const filter: ListEventsFilter = { tenantId: active.id };

  const name = url.searchParams.get("name");
  if (name && (EVENT_NAMES as readonly string[]).includes(name)) filter.name = name;

  const status = url.searchParams.get("status") as EventStatus | null;
  if (status && STATUSES.includes(status)) filter.status = status;

  const since = url.searchParams.get("since");
  if (since) {
    const d = new Date(since);
    if (!Number.isNaN(d.getTime())) filter.sinceReceivedAt = d;
  }
  const from = url.searchParams.get("from");
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) filter.fromTs = d;
  }
  const until = url.searchParams.get("until");
  if (until) {
    const d = new Date(until);
    if (!Number.isNaN(d.getTime())) filter.untilTs = d;
  }
  const limit = Number(url.searchParams.get("limit") ?? "100");
  if (Number.isFinite(limit)) filter.limit = limit;

  const events = await listEvents(filter);
  return NextResponse.json({ tenant: active, events });
}
