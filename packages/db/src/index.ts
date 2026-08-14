import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv, databaseEnv } from "@trackify/shared";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export * from "./crypto";

let poolSingleton: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (poolSingleton) return poolSingleton;
  const env = loadEnv(databaseEnv);
  poolSingleton = new pg.Pool({ connectionString: env.DATABASE_URL });
  return poolSingleton;
}

export function db() {
  return drizzle(pool(), { schema });
}

export type Db = ReturnType<typeof db>;
