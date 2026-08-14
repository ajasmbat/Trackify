import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@trackify/db/schema";
import { consoleDatabaseUrl } from "./env";

// Dedicated pool for the console — points at CONSOLE_DATABASE_URL (a
// read-only role in prod), falling back to DATABASE_URL. Never uses the
// shared pool from @trackify/db so a misconfigured console can't accidentally
// hold the same pool object the relay writes through.

let poolSingleton: pg.Pool | null = null;

export function pool(): pg.Pool {
  if (poolSingleton) return poolSingleton;
  poolSingleton = new pg.Pool({ connectionString: consoleDatabaseUrl() });
  return poolSingleton;
}

export function db() {
  return drizzle(pool(), { schema });
}

export type ConsoleDb = ReturnType<typeof db>;
