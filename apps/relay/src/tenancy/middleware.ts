import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@trackify/db";
import {
  computeCorsHeaders,
  isPreflight,
  ALLOW_METHODS,
  ALLOW_HEADERS,
  MAX_AGE_SECONDS,
} from "./cors";
import { createTtlCache, type TtlCache } from "./cache";
import {
  normalizeHost,
  resolveTenantByHost,
  TenantNotFoundError,
  type ResolveDeps,
  type TenantContext,
} from "./resolve";

// Fastify request augmentation so downstream modules can read `req.tenant`
// off the request without importing this middleware directly.
declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

export const DEFAULT_TENANT_TTL_MS = 30_000;

export interface InstallTenancyOptions {
  /**
   * Resolves a tenant for a given (normalized) hostname. Must throw
   * `TenantNotFoundError` when the host is not recognized. Wrap this in a
   * cache before passing it in — the middleware itself does no caching.
   */
  resolve: (host: string) => Promise<TenantContext>;
  /**
   * Return true for a request that should skip tenant resolution entirely
   * (`/healthz`, etc). Defaults to exempting only `/healthz`.
   */
  exempt?: (req: FastifyRequest) => boolean;
}

const defaultExempt = (req: FastifyRequest): boolean => {
  const url = req.url;
  // `/l/…` is the T11 loader route — it identifies its tenant by the
  // randomised path segment, not by the Host header, so it runs its own
  // lookup without any Host-based resolution happening first.
  return url === "/healthz" || url.startsWith("/l/");
};

/**
 * Register the tenancy hook on `app` (root instance). Attaches decrypted
 * tenant context to `req.tenant`, applies per-tenant CORS to the reply, and
 * short-circuits OPTIONS preflight with 204. Unknown host → 404
 * `tenant_not_found` (never 500). Missing Host header → 400.
 */
export async function installTenancy(
  app: FastifyInstance,
  opts: InstallTenancyOptions,
): Promise<void> {
  const exempt = opts.exempt ?? defaultExempt;

  app.addHook("onRequest", async (req, reply) => {
    if (exempt(req)) return;

    const host = normalizeHost(req.headers.host);
    if (!host) {
      applyBaselineCorsHeaders(reply);
      reply
        .code(400)
        .send({ error: "Bad Request", message: "missing host header" });
      return reply;
    }

    let ctx: TenantContext;
    try {
      ctx = await opts.resolve(host);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        applyBaselineCorsHeaders(reply);
        reply.code(404).send({
          error: "Not Found",
          message: "tenant_not_found",
        });
        return reply;
      }
      throw err;
    }

    req.tenant = ctx;

    const cors = computeCorsHeaders(
      req.headers.origin,
      ctx.tenant.allowedOrigins,
    );
    if (cors.allowOrigin) {
      reply.header("Access-Control-Allow-Origin", cors.allowOrigin);
    }
    reply.header("Vary", cors.vary);
    reply.header("Access-Control-Allow-Methods", cors.allowMethods);
    reply.header("Access-Control-Allow-Headers", cors.allowHeaders);
    reply.header("Access-Control-Max-Age", cors.maxAge);

    if (isPreflight(req.method, req.headers)) {
      reply.code(204).send();
      return reply;
    }
    return;
  });
}

/**
 * A minimal CORS header block for responses where we do NOT have a tenant
 * context (missing host, unknown tenant). We still set the shared preflight
 * fields so a browser preflight against an unknown host gets a coherent
 * response, but we do NOT echo the caller's Origin.
 */
function applyBaselineCorsHeaders(reply: FastifyReply): void {
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", ALLOW_METHODS);
  reply.header("Access-Control-Allow-Headers", ALLOW_HEADERS);
  reply.header("Access-Control-Max-Age", String(MAX_AGE_SECONDS));
}

export interface InstallTenancyFromDbOptions {
  client: Db;
  ttlMs?: number;
  /** Test seam so we don't pull in libsodium's ESM entry from unit tests. */
  decrypt?: ResolveDeps["decrypt"];
  now?: () => number;
  exempt?: InstallTenancyOptions["exempt"];
}

/**
 * Convenience: wire the DB-backed resolver behind the TTL cache and install
 * the middleware. Returns the cache so tests / boot code can invalidate it.
 */
export async function installTenancyFromDb(
  app: FastifyInstance,
  opts: InstallTenancyFromDbOptions,
): Promise<TtlCache<TenantContext>> {
  const cache = createTtlCache<TenantContext>(
    (host) =>
      resolveTenantByHost(host, {
        client: opts.client,
        decrypt: opts.decrypt,
      }),
    { ttlMs: opts.ttlMs ?? DEFAULT_TENANT_TTL_MS, now: opts.now },
  );

  await installTenancy(app, {
    resolve: (host) => cache.get(host),
    exempt: opts.exempt,
  });
  return cache;
}
