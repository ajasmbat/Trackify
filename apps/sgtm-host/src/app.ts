import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { pinoOptions, withRequestContext } from "@trackify/shared";
import type { DockerClient } from "./docker";
import {
  registerInternalRoutes,
  type InternalRoutesDeps,
} from "./routes/internal";
import { registerLoaderRoutes, type LoaderDeps } from "./routes/loader";
import { registerProxyRoutes, type ProxyDeps } from "./routes/proxy";
import type { SgtmContainerRepo } from "./repo";

export interface BuildAppOptions {
  repo: SgtmContainerRepo;
  docker: DockerClient;
  image: string;
  apex: string;
  logger?: boolean;
  proxyCacheTtlMs?: number;
  provisionerOverrides?: InternalRoutesDeps["provisionerOverrides"];
  loaderOverrides?: Pick<LoaderDeps, "upstream">;
}

// Build a fully-registered Fastify instance. Extracted from server.ts so the
// test suite can call it without needing a listener or a real Docker daemon.
export async function buildApp(
  opts: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : pinoOptions(),
    requestIdLogLabel: "request_id",
    disableRequestLogging: true,
    genReqId(req) {
      const supplied = req.headers["x-request-id"];
      return typeof supplied === "string" && supplied ? supplied : randomUUID();
    },
  });

  app.addHook("onRequest", (req, _reply, done) => {
    // request_id lives in Fastify's per-request child logger via
    // requestIdLogLabel — don't add it to ALS or pino emits the key twice.
    withRequestContext({}, () => {
      req.log.info(
        {
          req: {
            method: req.method,
            url: req.url,
            hostname: req.hostname,
            remoteAddress: req.ip,
          },
        },
        "incoming request",
      );
      done();
    });
  });

  app.addHook("onResponse", (_req, reply, done) => {
    reply.log.info(
      {
        res: { statusCode: reply.statusCode },
        responseTime: reply.elapsedTime,
      },
      "request completed",
    );
    done();
  });

  app.get("/healthz", async () => ({
    ok: true,
    apex: opts.apex,
  }));

  await registerInternalRoutes(app, {
    repo: opts.repo,
    docker: opts.docker,
    image: opts.image,
    provisionerOverrides: opts.provisionerOverrides,
  });

  // Custom Loader (T20). Registered BEFORE the wildcard proxy so `/gtm.js`
  // resolves to Fastify's own route — the proxy's onRequest hook has a
  // matching bypass so it does not intercept `/gtm.js` requests.
  await registerLoaderRoutes(app, {
    apex: opts.apex,
    ...opts.loaderOverrides,
  });

  // Proxy routes must be registered LAST — they own `/*`, which Fastify
  // routes only when no more specific route (like /healthz or /internal/*)
  // matches. This keeps healthz and the internal API reachable regardless
  // of the incoming Host header.
  const proxy: ProxyDeps = {
    repo: opts.repo,
    apex: opts.apex,
    cacheTtlMs: opts.proxyCacheTtlMs,
  };
  await registerProxyRoutes(app, proxy);

  return app;
}
