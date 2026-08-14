import type { FastifyInstance } from "fastify";
import { registerRoutes as registerIngest } from "./ingest/index";
import { registerRoutes as registerQueue } from "./queue/index";
import { registerRoutes as registerMeta } from "./destinations/meta/index";
import { registerRoutes as registerTenancy } from "./tenancy/index";
import { registerRoutes as registerCookies } from "./cookies/index";
import { registerRoutes as registerLoader } from "./loader/index";
import { registerRoutes as registerEnrich } from "./enrich/index";

// Route fanout. Each module owns its own file — downstream tickets drop new
// route files into their folder without editing this file or any shared file.
// If a module needs to add a route it edits ONLY its own index.ts.
export async function registerModules(app: FastifyInstance): Promise<void> {
  await registerIngest(app);
  await registerQueue(app);
  await registerMeta(app);
  await registerTenancy(app);
  await registerCookies(app);
  await registerLoader(app);
  await registerEnrich(app);
}
