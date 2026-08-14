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
    }),
  );

export const env = loadEnv(schema);
export type Env = typeof env;
