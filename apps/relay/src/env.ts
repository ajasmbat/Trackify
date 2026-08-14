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
    }),
  );

export const env = loadEnv(schema);
export type Env = typeof env;
