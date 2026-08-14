import type { DockerClient } from "./docker";
import { pickFreePort } from "./docker";
import { waitForHealthy, type HealthCheckOptions } from "./health";
import type { ContainerRow, SgtmContainerRepo } from "./repo";

// The provisioner is the imperative "start a container end-to-end" flow
// behind POST /internal/containers. It:
//   1. Inserts a provisioning row so we have an id + fk-safe reference.
//   2. Picks a free host port and asks Docker to start the container.
//   3. Waits for the container's own /healthy to return 200.
//   4. Flips the row to `ready` (or `error` + lastError on failure).
//
// The reverse proxy reads `sgtm_containers.subdomain` and
// `containerState.hostPort` to route requests — that's the shared contract
// with routes/proxy.ts.

// Loose logger contract — Fastify's FastifyBaseLogger, pino's Logger, and a
// silent test double all satisfy this. Avoids coupling this module to pino.
export interface ProvisionerLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface ProvisionRequest {
  tenantId: string;
  gtmContainerId: string;
  containerConfig: string;
  subdomain: string;
  previewServerUrl?: string;
}

export interface ProvisionerDeps {
  repo: SgtmContainerRepo;
  docker: DockerClient;
  image: string;
  logger: ProvisionerLogger;
  healthOverrides?: Partial<
    Pick<
      HealthCheckOptions,
      "fetch" | "sleep" | "now" | "totalTimeoutMs" | "intervalMs"
    >
  >;
  pickHostPort?: () => Promise<number>;
}

type ContainerState = {
  hostPort?: number;
  containerId?: string;
  containerName?: string;
  image?: string;
};

const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 1_000;

export class Provisioner {
  constructor(private readonly deps: ProvisionerDeps) {}

  async provision(req: ProvisionRequest): Promise<ContainerRow> {
    const { repo, docker, image, logger } = this.deps;
    const row = await repo.insertProvisioning({
      tenantId: req.tenantId,
      gtmContainerId: req.gtmContainerId,
      subdomain: req.subdomain,
      previewServerUrl: req.previewServerUrl,
    });

    const containerName = `sgtm-${row.tenantId}-${row.id}`;
    const pickHostPort = this.deps.pickHostPort ?? pickFreePort;
    let hostPort: number;
    try {
      hostPort = await pickHostPort();
    } catch (err) {
      await this.markError(row.id, err, {});
      throw err;
    }

    const env: Record<string, string> = {
      CONTAINER_CONFIG: req.containerConfig,
      RUN_AS_PREVIEW_SERVER: "false",
    };
    if (req.previewServerUrl) env["PREVIEW_SERVER_URL"] = req.previewServerUrl;

    const state: ContainerState = {
      hostPort,
      containerName,
      image,
    };

    try {
      const started = await docker.start({
        name: containerName,
        image,
        env,
        hostPort,
        containerPort: 8080,
      });
      state.containerId = started.id;
      logger.info(
        { sgtm_container_id: row.id, host_port: hostPort },
        "sgtm container started; awaiting health",
      );
    } catch (err) {
      await this.markError(row.id, err, state);
      throw err;
    }

    const health = await waitForHealthy({
      hostPort,
      totalTimeoutMs:
        this.deps.healthOverrides?.totalTimeoutMs ?? HEALTH_TIMEOUT_MS,
      intervalMs:
        this.deps.healthOverrides?.intervalMs ?? HEALTH_INTERVAL_MS,
      fetch: this.deps.healthOverrides?.fetch,
      sleep: this.deps.healthOverrides?.sleep,
      now: this.deps.healthOverrides?.now,
    });

    if (!health.ok) {
      const message = health.lastError
        ? `health check failed after ${health.attempts} attempts: ${health.lastError}`
        : `health check returned status ${health.lastStatus ?? "unknown"} after ${health.attempts} attempts`;
      // Stop the failed container — otherwise it lingers and takes the port.
      try {
        await docker.stop(containerName);
      } catch (stopErr) {
        logger.warn(
          {
            sgtm_container_id: row.id,
            err: stopErr instanceof Error ? stopErr.message : String(stopErr),
          },
          "failed to stop unhealthy container",
        );
      }
      await this.markError(row.id, new Error(message), state);
      throw new Error(message);
    }

    const updated = await repo.update(row.id, {
      status: "ready",
      containerState: state as Record<string, unknown>,
      lastError: null,
    });
    if (!updated) throw new Error("row disappeared while marking ready");
    return updated;
  }

  private async markError(
    id: string,
    err: unknown,
    state: ContainerState,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await this.deps.repo.update(id, {
      status: "error",
      lastError: message,
      containerState: state as Record<string, unknown>,
    });
  }
}
