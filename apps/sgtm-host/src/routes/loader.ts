import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { UpstreamCache, type UpstreamResponse } from "../upstream";

// Custom Loader (Stape parity): serve `gtm.js` from the customer's own
// subdomain by proxying `https://www.googletagmanager.com/gtm.js?id=...` and
// rewriting occurrences of the string `www.googletagmanager.com` to the
// request's own host so downstream calls also stay on the customer domain.
//
// This runs BEFORE the wildcard host-based container proxy in
// routes/proxy.ts. `/gtm.js` is skipped by the proxy hook so this route
// wins.

const GTM_ID_RE = /^GTM-[A-Z0-9]{6,10}$/;
const UPSTREAM_HOST = "www.googletagmanager.com";
// Headers we forward from upstream verbatim so the browser and any CDN in
// front of us respect Google's caching semantics.
const FORWARD_HEADERS = ["cache-control", "etag", "last-modified", "vary"];

export interface LoaderDeps {
  apex: string;
  // Injected for tests. Otherwise a default UpstreamCache is used.
  upstream?: UpstreamCache;
}

export async function registerLoaderRoutes(
  app: FastifyInstance,
  deps: LoaderDeps,
): Promise<void> {
  const upstream = deps.upstream ?? new UpstreamCache();
  const apex = deps.apex.toLowerCase();
  const suffix = `.${apex}`;

  const handle = async (
    req: FastifyRequest<{ Querystring: { id?: string } }>,
    reply: FastifyReply,
  ): Promise<FastifyReply | undefined> => {
    const gtmId = req.query.id;
    if (!gtmId) {
      return reply.code(400).send({ error: "missing_container_id" });
    }
    if (!GTM_ID_RE.test(gtmId)) {
      return reply.code(400).send({ error: "invalid_container_id" });
    }

    // The rewrite target is the customer's own host. It comes from the
    // request Host header, which the proxy layer already validates against
    // the apex. If the request landed here on the bare apex (or with no
    // host at all), there's no per-tenant host to rewrite to — 400.
    const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? "";
    if (!host || host === apex || !host.endsWith(suffix)) {
      return reply.code(400).send({ error: "invalid_host" });
    }

    let response: UpstreamResponse;
    try {
      response = await upstream.fetchGtmJs(gtmId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err: message, gtm_id: gtmId }, "upstream fetch failed");
      return reply.code(502).send({ error: "upstream_error", message });
    }

    for (const name of FORWARD_HEADERS) {
      const value = response.headers[name];
      if (value !== undefined) reply.header(name, value);
    }

    const contentType =
      response.headers["content-type"] ?? "application/javascript";
    reply.header("content-type", contentType);
    reply.code(response.status);

    // Non-200 (e.g. 404) — pass the raw body through without rewriting.
    if (response.status !== 200) {
      return reply.send(response.body);
    }

    // Rewrite occurrences of the literal googletagmanager host so scripts
    // loaded by gtm.js also stay on the customer domain. This is a byte-safe
    // string replace on the identity-encoded body (upstream.ts asks for
    // `Accept-Encoding: identity`).
    const rewritten = response.body
      .toString("utf8")
      .split(UPSTREAM_HOST)
      .join(host);
    return reply.send(rewritten);
  };

  app.get<{ Querystring: { id?: string } }>("/gtm.js", handle);
}
