import { z } from "zod";
import {
  commonEnv,
  credentialKeyEnv,
  databaseEnv,
  loadEnv,
} from "@trackify/shared";

const schema = commonEnv
  .merge(databaseEnv)
  .merge(credentialKeyEnv)
  .merge(
    z.object({
      RELAY_PORT: z.coerce.number().int().positive(),
      // Browser-visible origin of the relay, e.g. `https://data.acme.dev`.
      // T11's loader embeds this into the per-tenant snippet so the snippet
      // knows where to POST events back to.
      RELAY_URL: z.string().url(),
      // Optional. When set, the cookie service writes it as the `Domain=`
      // attribute on rly_vid / tf_jid. Leave unset to get a host-only
      // cookie (dev / test).
      RELAY_COOKIE_DOMAIN: z.string().min(1).optional(),
    }),
  );

export const env = loadEnv(schema);
export type Env = typeof env;
