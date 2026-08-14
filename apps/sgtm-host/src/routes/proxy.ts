import http from "node:http";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SgtmContainerRepo } from "../repo";
import {
  restoreCookieHeader,
  rewriteSetCookies,
} from "../cookies/keeper";

// Host-based streaming reverse proxy. Given a request for
// `<subdomain>.sgtm.<apex>`, look up the container by subdomain and stream
// the request/response between the client and the container's loopback port.
//
// Streaming is a hard requirement: `gtm.js` is >200KB and any buffering
// destroys TTFB and breaks sGTM's client-side cache semantics.
//
// The proxy runs as an `onRequest` hook (before Fastify's body parsing) so
// we can pipe the raw IncomingMessage through to the container without the
// body being drained first. We only take over when the Host header matches
// `<sub>.sgtm.<apex>`; other requests fall through to the Fastify router
// (which serves /healthz and /internal/*).

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface ProxyDeps {
  repo: SgtmContainerRepo;
  apex: string;
  // Cache TTL for subdomain → hostPort lookups. Keeping this small avoids
  // stale routing when a container is restarted. Set to 0 to disable.
  cacheTtlMs?: number;
}

type ContainerState = { hostPort?: number };

interface RouteTarget {
  hostPort: number;
  containerId: string;
  cookieKeeperEnabled: boolean;
}

export async function registerProxyRoutes(
  app: FastifyInstance,
  deps: ProxyDeps,
): Promise<void> {
  const cache = new Map<string, { target: RouteTarget; expires: number }>();
  const ttl = deps.cacheTtlMs ?? 5_000;
  const apex = deps.apex.toLowerCase();
  const suffix = `.${apex}`;

  const resolveTarget = async (
    subdomain: string,
  ): Promise<RouteTarget | null> => {
    const now = Date.now();
    const hit = cache.get(subdomain);
    if (hit && hit.expires > now) return hit.target;
    const row = await deps.repo.findReadyBySubdomain(subdomain);
    if (!row) return null;
    const state = (row.containerState ?? {}) as ContainerState;
    if (!state.hostPort) return null;
    const target: RouteTarget = {
      hostPort: state.hostPort,
      containerId: row.id,
      cookieKeeperEnabled: row.cookieKeeperEnabled,
    };
    if (ttl > 0) cache.set(subdomain, { target, expires: now + ttl });
    return target;
  };

  const proxy = async (
    req: FastifyRequest,
    reply: FastifyReply,
    target: RouteTarget,
  ): Promise<void> => {
    const upstreamHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      upstreamHeaders[k] = v;
    }

    // Cookie Keeper — inbound restore. The browser sends us the sealed
    // `sgtm_<hash>=<sealed>` cookies; the container expects the original
    // names. Do this BEFORE hijacking so an unseal failure can still fail
    // fast into Fastify's error path. When the header is empty after
    // restoring (every sealed cookie was tampered), drop it entirely so we
    // don't ship an empty `Cookie:` header upstream.
    if (target.cookieKeeperEnabled) {
      const raw = upstreamHeaders["cookie"];
      const cookieHeader = Array.isArray(raw) ? raw.join("; ") : raw;
      if (typeof cookieHeader === "string" && cookieHeader.length > 0) {
        const restored = await restoreCookieHeader(cookieHeader);
        if (restored) upstreamHeaders["cookie"] = restored;
        else delete upstreamHeaders["cookie"];
      }
    }

    reply.hijack();

    const upstreamReq = http.request({
      host: "127.0.0.1",
      port: target.hostPort,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders,
    });

    await new Promise<void>((done, fail) => {
      upstreamReq.on("response", (upstream) => {
        void (async () => {
          try {
            const forwarded: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(upstream.headers)) {
              if (v === undefined) continue;
              if (HOP_BY_HOP.has(k.toLowerCase())) continue;
              forwarded[k] = v;
            }

            // Cookie Keeper — outbound rewrite. Node parses multi-value
            // Set-Cookie into an array; preserve the array shape so
            // writeHead emits one header per cookie instead of collapsing
            // to a comma-joined string (which browsers won't split back).
            if (target.cookieKeeperEnabled) {
              const raw = forwarded["set-cookie"];
              if (raw !== undefined) {
                const asArray = Array.isArray(raw) ? raw : [raw];
                forwarded["set-cookie"] = await rewriteSetCookies(asArray);
              }
            }

            reply.raw.writeHead(upstream.statusCode ?? 502, forwarded);
            upstream.on("end", () => done());
            upstream.on("error", fail);
            upstream.pipe(reply.raw);
          } catch (err) {
            fail(err);
          }
        })();
      });
      upstreamReq.on("error", fail);
      // Pipe the untouched raw request body to the upstream. Because we
      // intercepted in onRequest — BEFORE Fastify's body parser drains
      // req.raw — the incoming bytes are still available.
      req.raw.pipe(upstreamReq);
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err: message }, "sgtm proxy upstream error");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(502, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ error: "upstream_error", message }));
      } else {
        reply.raw.end();
      }
    });
  };

  app.addHook("onRequest", async (req, reply) => {
    const host = (req.headers.host ?? "").split(":")[0]?.toLowerCase() ?? "";
    if (!host) return; // Let /healthz etc. handle it (fine on localhost too).
    if (host === apex || !host.endsWith(suffix)) return; // Not for us.

    // /gtm.js is owned by the Custom Loader route (T20) — it fetches from
    // Google directly, not from the tenant's container. Let Fastify's
    // router match the loader instead of forwarding to the container.
    const path = (req.url ?? "").split("?")[0] ?? "";
    if (path === "/gtm.js") return;

    const subdomain = host.slice(0, host.length - suffix.length);
    if (!subdomain) return;

    const target = await resolveTarget(subdomain);
    if (!target) {
      reply.hijack();
      reply.raw.writeHead(404, { "content-type": "application/json" });
      reply.raw.end(JSON.stringify({ error: "unknown_container" }));
      return;
    }

    await proxy(req, reply, target);
  });
}
