import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildSnippet } from "./build";

// `GET /l/:path.js` — serves the per-tenant tracking snippet.
//
// The tenant is identified by the URL path (a randomised, unique loader path
// stored on the `tenants` row), NOT by the Host header — so this route is
// deliberately exempted from the Host-based tenancy hook in
// `apps/relay/src/tenancy/middleware.ts`. Unknown or malformed paths return
// 404 with no body — never a JSON error — so an ad blocker that sniffs the
// response can't tell a real loader from a probe.

export interface LoaderTenant {
  id: string;
  loaderPath: string;
}

export interface LoaderRouteDeps {
  /**
   * Resolve a tenant by its loader path. Return `null` when nothing matches.
   * The route caches nothing itself; wrap this in a TTL cache when the
   * DB-backed resolver is expensive (an admin path rotation is a manual
   * step per DECISIONS, so cache lifetime can be generous).
   */
  resolveByLoaderPath: (path: string) => Promise<LoaderTenant | null>;
  /**
   * The relay's browser-visible origin, e.g. `https://data.acme.dev`. The
   * snippet joins this with the ingest endpoint at call time.
   */
  relayOrigin: string;
  /**
   * Cache-Control for the served snippet. A long max-age is fine — the path
   * is immutable per tenant (rotating breaks cached storefront `<script>`
   * tags, see DECISIONS.md) so we can afford aggressive caching.
   */
  cacheControl?: string;
}

const DEFAULT_CACHE_CONTROL = "public, max-age=300, must-revalidate";

// Loader paths are our own base64url output — restrict to that alphabet so a
// path traversal or SQL injection can't slip past the regex into the DB
// lookup. Length window is generous but bounded.
const PATH_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export async function registerLoaderRoutes(
  app: FastifyInstance,
  deps: LoaderRouteDeps,
): Promise<void> {
  const cacheControl = deps.cacheControl ?? DEFAULT_CACHE_CONTROL;

  app.get<{ Params: { path: string } }>(
    "/l/:path.js",
    async (req, reply) => handleLoader(req, reply, deps, cacheControl),
  );
}

async function handleLoader(
  req: FastifyRequest<{ Params: { path: string } }>,
  reply: FastifyReply,
  deps: LoaderRouteDeps,
  cacheControl: string,
): Promise<void> {
  const rawPath = req.params.path;
  if (!rawPath || !PATH_PATTERN.test(rawPath)) {
    reply.code(404).send();
    return;
  }

  const tenant = await deps.resolveByLoaderPath(rawPath);
  if (!tenant) {
    reply.code(404).send();
    return;
  }

  const body = buildSnippet({
    tenantId: tenant.id,
    host: deps.relayOrigin,
  });

  reply
    .header("Content-Type", "application/javascript; charset=utf-8")
    .header("Cache-Control", cacheControl)
    .header("X-Content-Type-Options", "nosniff")
    .send(body);
}
