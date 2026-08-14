import type { FastifyInstance, FastifyRequest } from "fastify";
import { IngestRequest } from "@trackify/shared";
import type { Db } from "@trackify/db";
import { deriveFbc, readFbcCookie, readFbclidFromUrl } from "../ingest/fbc";
import { parseCookieHeader } from "./serialize";
import { upsertVisitorFbc } from "./store";

// The persistence half of the cookie service. Runs AFTER the ingest handler
// has replied with 202 — so it never blocks the client's ack, and a failure
// here does not turn a successful ingest into a client error.
//
// For each event that just landed, mirror the server-derived `fbc` and the
// client `_fbp` cookie onto the `visitors` row. This is what lets a later
// event with no client `_fbc` still carry `fbc` on the outbound Meta payload
// once T13's enricher lands.
//
// Composed here (not inside T4's route.ts) so ingest stays free of cookie
// concerns and T12's ownership boundary is respected.

export interface InstallFbcPersistOptions {
  client: Db;
  now?: () => number;
}

export async function installFbcPersistHook(
  app: FastifyInstance,
  opts: InstallFbcPersistOptions,
): Promise<void> {
  const now = opts.now ?? (() => Date.now());

  app.addHook("onResponse", async (req, reply) => {
    if (!isIngestSuccess(req, reply.statusCode)) return;

    const tenantId = req.tenant?.tenant.id;
    if (!tenantId) return;

    const parsed = IngestRequest.safeParse(req.body);
    if (!parsed.success) return;

    const cookies = parseCookieHeader(req.headers.cookie);
    const clientFbp = cookies.get("_fbp");
    const cookieFbc = readFbcCookie(req.headers.cookie);
    const fbclid =
      readFbclidFromUrl(fullUrl(req)) ??
      // Also honour a client-derived one carried in event.context.url —
      // matches how T4 derives `server.fbc` today.
      firstFbclidFromEvents(parsed.data.events);

    const fbc = deriveFbc({ cookieFbc, fbclid, now: now() });
    if (!fbc && !clientFbp) return;

    for (const event of parsed.data.events) {
      try {
        await upsertVisitorFbc(
          {
            tenantId,
            visitorKey: event.visitor_id,
            fbc,
            fbp: clientFbp,
          },
          opts.client,
        );
      } catch (err) {
        // Best-effort — the client has already been ack'd; log and move on
        // rather than throwing out of the onResponse hook (which Fastify
        // would swallow anyway).
        req.log.warn(
          {
            tenant_id: tenantId,
            visitor_key: event.visitor_id,
            error: err instanceof Error ? err.message : String(err),
          },
          "cookies: fbc/fbp persistence failed",
        );
      }
    }
  });
}

function isIngestSuccess(req: FastifyRequest, statusCode: number): boolean {
  if (req.method !== "POST") return false;
  // req.url may include query string; strip it.
  const path = req.url.split("?")[0];
  if (path !== "/e") return false;
  return statusCode === 202;
}

function fullUrl(req: FastifyRequest): string | undefined {
  const host = req.headers.host;
  if (!host || !req.url) return undefined;
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  try {
    return new URL(req.url, `${proto}://${host}`).toString();
  } catch {
    return undefined;
  }
}

function firstFbclidFromEvents(
  events: ReadonlyArray<{ context?: { url?: string } }>,
): string | undefined {
  for (const ev of events) {
    const found = readFbclidFromUrl(ev.context?.url);
    if (found) return found;
  }
  return undefined;
}
