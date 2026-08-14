import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DockerClient } from "../docker";
import { Provisioner, type ProvisionerDeps } from "../provisioner";
import type { ContainerRow, SgtmContainerRepo } from "../repo";

// Internal API. Called by the console (T19) on the trusted network. No auth
// in Wave 5 — bind this app to a private interface. Cross-tenant enforcement
// is the console's job (this endpoint trusts its inputs).

const subdomainSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,32}$/, "invalid subdomain shape");

const provisionBody = z.object({
  tenantId: z.string().uuid(),
  gtmContainerId: z.string().min(1),
  containerConfig: z.string().min(1),
  subdomain: subdomainSchema,
  previewServerUrl: z.string().url().optional(),
});

export interface InternalRoutesDeps {
  repo: SgtmContainerRepo;
  docker: DockerClient;
  image: string;
  provisionerOverrides?: Pick<
    ProvisionerDeps,
    "healthOverrides" | "pickHostPort"
  >;
}

type ContainerState = {
  hostPort?: number;
  containerId?: string;
  containerName?: string;
  image?: string;
};

function readState(row: ContainerRow): ContainerState {
  return (row.containerState ?? {}) as ContainerState;
}

export async function registerInternalRoutes(
  app: FastifyInstance,
  deps: InternalRoutesDeps,
): Promise<void> {
  const provisioner = new Provisioner({
    repo: deps.repo,
    docker: deps.docker,
    image: deps.image,
    logger: app.log,
    ...deps.provisionerOverrides,
  });

  app.post("/internal/containers", async (req, reply) => {
    const parsed = provisionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues,
      });
    }
    try {
      const row = await provisioner.provision(parsed.data);
      return reply.code(201).send(row);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err: message }, "provisioning failed");
      return reply.code(500).send({ error: "provision_failed", message });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/internal/containers/:id",
    async (req, reply) => {
      const id = req.params.id;
      const row = await deps.repo.findById(id);
      if (!row) return reply.code(404).send({ error: "not_found" });

      // Poll Docker for liveness so the console sees crashed containers as
      // `error` rather than a stale `ready`.
      if (row.status === "ready" || row.status === "provisioning") {
        const state = readState(row);
        if (state.containerName) {
          try {
            const info = await deps.docker.inspect(state.containerName);
            if (info && !info.running) {
              const updated = await deps.repo.update(row.id, {
                status: "error",
                lastError:
                  info.exitedWithError ?? "container is not running",
              });
              return reply.send(updated ?? row);
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            req.log.warn(
              { err: message, sgtm_container_id: row.id },
              "docker inspect failed during status poll",
            );
          }
        }
      }

      return reply.send(row);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/internal/containers/:id",
    async (req, reply) => {
      const id = req.params.id;
      const row = await deps.repo.findById(id);
      if (!row) return reply.code(404).send({ error: "not_found" });

      const state = readState(row);
      if (state.containerName) {
        try {
          await deps.docker.stop(state.containerName);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          req.log.error(
            { err: message, sgtm_container_id: row.id },
            "docker stop failed",
          );
          return reply.code(500).send({ error: "stop_failed", message });
        }
      }

      await deps.repo.update(row.id, { status: "stopped" });
      return reply.code(204).send();
    },
  );
}
