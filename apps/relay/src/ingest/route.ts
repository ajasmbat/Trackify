import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  IngestRequest,
  type CanonicalEvent,
  type Identity,
  type IngestResponse,
} from "@trackify/shared";
import { deriveFbc, readFbcCookie, readFbclidFromUrl } from "./fbc";
import { hashIdentity, InvalidPhoneError } from "./hash";
import type { PersistParams, PersistResult } from "./persist";
import type { TenantResolver } from "./tenant";

/** 32 KB — a page_view + light identity block is ~200 bytes; 32 KB fits a
 *  fat batch and hard-caps abusive callers. */
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

export interface IngestDeps {
  /** Injected by the module edge so route.ts has no runtime dependency on
   *  `@trackify/db` (keeps tests off the crypto side-effect chain). */
  persist: (params: PersistParams) => Promise<PersistResult>;
  resolveTenant: TenantResolver;
  now?: () => number;
  maxBodyBytes?: number;
}

interface ResolvedDeps {
  persist: IngestDeps["persist"];
  resolveTenant: IngestDeps["resolveTenant"];
  now: () => number;
  maxBodyBytes: number;
}

export async function registerIngestRoutes(
  app: FastifyInstance,
  raw: IngestDeps,
): Promise<void> {
  const deps: ResolvedDeps = {
    persist: raw.persist,
    resolveTenant: raw.resolveTenant,
    now: raw.now ?? (() => Date.now()),
    maxBodyBytes: raw.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  };

  // Scope error handling to this module so we don't step on other modules'
  // handlers. The oversized-body 413 needs a message that names the limit —
  // Fastify's default just says "Request body is too large".
  await app.register(async (scope) => {
    scope.setErrorHandler((err, _req, reply) => {
      if (err.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
        return reply.code(413).send({
          error: "Payload Too Large",
          message: `request body exceeds the ${deps.maxBodyBytes}-byte limit`,
        });
      }
      // Fall through to Fastify's default handler for anything else.
      throw err;
    });

    scope.route({
      method: ["POST", "OPTIONS"],
      url: "/e",
      bodyLimit: deps.maxBodyBytes,
      handler: (req, reply) => handleIngest(req, reply, deps),
    });
  });
}

async function handleIngest(
  req: FastifyRequest,
  reply: FastifyReply,
  deps: ResolvedDeps,
): Promise<void> {
  const tenant = await deps.resolveTenant(req);
  applyCors(reply, req.headers.origin, tenant?.allowedOrigins ?? []);

  if (req.method === "OPTIONS") {
    reply.code(204).send();
    return;
  }

  if (!tenant) {
    reply.code(404).send({ error: "Not Found", message: "no tenant for host" });
    return;
  }

  const parsed = IngestRequest.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400).send({
      error: "Bad Request",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const clientIp = extractClientIp(req);
  const clientUa = extractUserAgent(req);
  const receivedAt = new Date(deps.now()).toISOString();
  const destinationIds = tenant.destinations.map((d) => d.id);

  const results: IngestResponse["results"] = [];
  let accepted = 0;
  let rejected = 0;

  for (const event of parsed.data.events) {
    try {
      const stored = await persistSingleEvent(event, {
        tenantId: tenant.tenantId,
        destinationIds,
        clientIp,
        clientUa,
        receivedAt,
        deps,
        req,
      });
      results.push({ kind: "ok", event_id: stored.eventId });
      accepted++;
    } catch (err) {
      const reason =
        err instanceof InvalidPhoneError
          ? err.message
          : err instanceof Error
            ? err.message
            : "internal error";
      results.push({
        kind: "rejected",
        event_id: event.event_id,
        reason,
      });
      rejected++;
      // Redacted: log only shape + identity presence bits, never raw PII.
      req.log.warn(
        {
          tenant_id: tenant.tenantId,
          event_name: event.name,
          event_id: event.event_id,
          identity_presence: identityPresence(event.identity),
          error: reason,
        },
        "ingest event rejected",
      );
    }
  }

  req.log.info(
    {
      tenant_id: tenant.tenantId,
      accepted,
      rejected,
      total: parsed.data.events.length,
    },
    "ingest batch processed",
  );

  const body: IngestResponse = { accepted, rejected, results };
  reply.code(202).send(body);
}

interface PerEventDeps {
  tenantId: string;
  destinationIds: string[];
  clientIp: string | undefined;
  clientUa: string | undefined;
  receivedAt: string;
  deps: ResolvedDeps;
  req: FastifyRequest;
}

async function persistSingleEvent(
  event: CanonicalEvent,
  ctx: PerEventDeps,
): Promise<{ eventId: string }> {
  // Hash raw PII BEFORE we hand anything off to persist — the raw values must
  // never appear in the row or a log line. hashIdentity throws for a phone
  // that normalises to empty (per Meta's rule).
  const identity = hashIdentity(event.identity);

  // Merge the server-derived request context into event.context. Never
  // overwrite a client-supplied value.
  const context = mergeServerContext(event.context, ctx.clientIp, ctx.clientUa);

  // Derive fbc when the client passed `?fbclid=…` in `context.url` (or on the
  // request's own URL) and hasn't yet been tagged with an `_fbc` cookie.
  const fbclid =
    readFbclidFromUrl(context?.url) ??
    readFbclidFromUrl(fullUrl(ctx.req));
  const fbc = deriveFbc({
    cookieFbc: readFbcCookie(ctx.req.headers.cookie),
    fbclid,
    now: ctx.deps.now(),
  });

  // Strip raw email/phone/external_id — only hashes are persisted.
  const stripped: CanonicalEvent = {
    ...event,
    context,
    identity: identity as Identity | undefined,
  };

  const result = await ctx.deps.persist({
    tenantId: ctx.tenantId,
    destinationIds: ctx.destinationIds,
    event: stripped,
    identity,
    server: {
      client_ip_address: ctx.clientIp,
      client_user_agent: ctx.clientUa,
      fbc,
      fbclid,
      received_at: ctx.receivedAt,
    },
  });

  return { eventId: result.eventId };
}

function mergeServerContext(
  clientContext: CanonicalEvent["context"] | undefined,
  ip: string | undefined,
  ua: string | undefined,
): CanonicalEvent["context"] | undefined {
  if (!clientContext && !ip && !ua) return undefined;
  const base = clientContext ?? {};
  return {
    ...base,
    ip: base.ip ?? ip,
    user_agent: base.user_agent ?? ua,
  };
}

function extractClientIp(req: FastifyRequest): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  } else if (Array.isArray(xff) && xff[0]) {
    const first = xff[0].split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? undefined;
}

function extractUserAgent(req: FastifyRequest): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.length > 0 ? ua : undefined;
}

function fullUrl(req: FastifyRequest): string | undefined {
  // req.url is the path + query; build a URL with the request's host so
  // readFbclidFromUrl can parse it.
  const host = req.headers.host;
  if (!host || !req.url) return undefined;
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  try {
    return new URL(req.url, `${proto}://${host}`).toString();
  } catch {
    return undefined;
  }
}

function applyCors(
  reply: FastifyReply,
  origin: string | undefined,
  allowedOrigins: string[],
): void {
  const allow = pickAllowedOrigin(origin, allowedOrigins);
  if (allow) {
    reply.header("Access-Control-Allow-Origin", allow);
    reply.header("Vary", "Origin");
  }
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "content-type");
  reply.header("Access-Control-Max-Age", "600");
}

function pickAllowedOrigin(
  origin: string | undefined,
  allowlist: string[],
): string | undefined {
  if (allowlist.includes("*")) return origin ?? "*";
  if (origin && allowlist.includes(origin)) return origin;
  return undefined;
}

function identityPresence(identity: Identity | undefined): {
  email: boolean;
  phone: boolean;
  external_id: boolean;
} {
  return {
    email: !!(identity?.email || identity?.email_sha256),
    phone: !!(identity?.phone || identity?.phone_sha256),
    external_id: !!(identity?.external_id || identity?.external_id_sha256),
  };
}
