import { z } from "zod";
import { commonEnv, databaseEnv, loadEnv } from "@trackify/shared";

// sgtm-host env. Extends the common core with:
//   - SGTM_HOST_PORT: port the Fastify app listens on.
//   - SGTM_HOST_APEX: the wildcard apex (e.g. `sgtm.example.dev`) that
//     `<subdomain>.sgtm.<apex>` requests target. The reverse proxy peels the
//     `<subdomain>` off the incoming Host header by suffix-matching this apex.
//   - SGTM_HOST_DOCKER: `docker` (default) uses the real Docker daemon; `mock`
//     is an in-memory fake for tests and CI without Docker.
const schema = commonEnv.merge(databaseEnv).merge(
  z.object({
    SGTM_HOST_PORT: z.coerce.number().int().positive().default(3004),
    SGTM_HOST_APEX: z.string().min(1),
    SGTM_HOST_DOCKER: z.enum(["docker", "mock"]).default("docker"),
    SGTM_HOST_IMAGE: z
      .string()
      .min(1)
      .default("gcr.io/cloud-tagging-10302018/server:latest"),
    //
    // T22 — GEO enrichment. `cloudflare` (default) reads the CF-* headers
    // the tunnel already stamps; `maxmind` looks up client IP in a local
    // GeoLite2-City DB (path from SGTM_MAXMIND_DB_PATH); `off` skips
    // enrichment entirely (inbound X-Geo-* are still stripped — never
    // trusted).
    SGTM_GEO_BACKEND: z
      .enum(["cloudflare", "maxmind", "off"])
      .default("cloudflare"),
    SGTM_MAXMIND_DB_PATH: z.string().min(1).optional(),
  }),
);

export const env = loadEnv(schema);
export type Env = typeof env;
