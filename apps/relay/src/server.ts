import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { logger, pinoOptions, withRequestContext } from "@trackify/shared";
import { env } from "./env";
import { registerModules } from "./modules/index";
import { bootWorker, DestinationRegistry } from "./queue/index";
import { createEnricher } from "./enrich/pipeline";

// Fastify with pino JSON logging. Every log line — from Fastify itself and
// from any module — carries `request_id`; when the request has a `journey_id`
// header or cookie, that too is on every line for the request. Enforced via
// AsyncLocalStorage in `@trackify/shared/logger`.

const app = Fastify({
  logger: pinoOptions(),
  requestIdLogLabel: "request_id",
  // We take over request/response logging (see hooks below) so every log line
  // is emitted from INSIDE the AsyncLocalStorage context — including the
  // "incoming request" line, which Fastify normally logs before onRequest fires.
  disableRequestLogging: true,
  genReqId(req) {
    const supplied = req.headers["x-request-id"];
    return typeof supplied === "string" && supplied ? supplied : randomUUID();
  },
});

// Bind every request into an AsyncLocalStorage context so every log line
// emitted for the request inherits journey_id. Note: request_id is already
// added by Fastify's per-request child logger (see requestIdLogLabel), so
// we deliberately DON'T put it into ALS — otherwise pino serializes the
// key twice (once from child bindings, once from the formatter).
app.addHook("onRequest", (req, _reply, done) => {
  const journeyIdHeader = req.headers["x-journey-id"];
  const journeyId =
    typeof journeyIdHeader === "string" && journeyIdHeader
      ? journeyIdHeader
      : undefined;

  // request_id is intentionally NOT put into ALS — Fastify's child logger
  // already binds it via `requestIdLogLabel`. Adding it here too would emit
  // the JSON key twice on every line.
  withRequestContext({ journey_id: journeyId }, () => {
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

// Baseline liveness endpoint. Later tickets add /e, /loader.js, etc via modules.
app.get("/healthz", async () => ({ ok: true }));

await registerModules(app);

// Delivery worker (T5). Owns its own pg.Pool so a slow destination call
// cannot starve the ingest side of connections. Adapters are registered
// here at boot (T6 wires in Meta) — the queue itself never imports one.
const registry = new DestinationRegistry();
// registry.register(new MetaDestination()); // T6 lands and wires this line.

// Enrich each event with the visitor's stored hashed identity before the
// destination adapter sees it (T13). The enricher reads through the worker's
// own pool so it never contends with ingest for connections.
const workerBoot = bootWorker({
  databaseUrl: env.DATABASE_URL,
  registry,
  enricherFactory: (pool) => createEnricher({ pool }),
});
workerBoot.worker.start();

app.addHook("onClose", async () => {
  await workerBoot.shutdown();
});

app.listen({ port: env.RELAY_PORT, host: "0.0.0.0" }).catch((err) => {
  logger().fatal({ err: err.message }, "relay failed to start");
  process.exit(1);
});
