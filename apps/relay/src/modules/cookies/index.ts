import type { FastifyInstance } from "fastify";
import { db } from "@trackify/db";
import { installCookies } from "../../cookies/middleware";
import { installFbcPersistHook } from "../../cookies/persist-hook";
import { env } from "../../env";

// Cookies module — installs the server-set visitor cookie (`rly_vid`, HttpOnly)
// and the JS-visible journey cookie (`tf_jid`), plus the post-response hook
// that mirrors `fbc` / `fbp` onto the `visitors` row. Composed here (not
// inside T4's ingest handler) so T4's ownership boundary is respected — the
// hook runs after the 202 goes out, so a persistence failure never turns a
// good ingest into a client error.
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await installCookies(app, {
    cookieDomain: env.RELAY_COOKIE_DOMAIN,
  });
  await installFbcPersistHook(app, { client: db() });
}
