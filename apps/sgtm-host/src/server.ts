import { db } from "@trackify/db";
import { logger } from "@trackify/shared";
import { env } from "./env";
import { buildApp } from "./app";
import { createDockerClient, DockerCliError } from "./docker";
import { createDrizzleRepo } from "./repo";

// sgtm-host boot. Wires the real db pool + Docker client, then hands off to
// the shared buildApp. Fails loudly at startup if:
//   - env vars are missing (`loadEnv` throws with the exact key),
//   - the Docker daemon is unreachable in `docker` mode.

const docker = createDockerClient(env.SGTM_HOST_DOCKER);

if (env.SGTM_HOST_DOCKER === "docker") {
  try {
    await docker.ping();
  } catch (err) {
    const message =
      err instanceof DockerCliError
        ? `${err.message}${err.stderr ? ` (${err.stderr.trim()})` : ""}`
        : err instanceof Error
          ? err.message
          : String(err);
    logger().fatal(
      { err: message },
      "docker daemon unreachable — set SGTM_HOST_DOCKER=mock for CI",
    );
    process.exit(1);
  }
}

const app = await buildApp({
  repo: createDrizzleRepo(db()),
  docker,
  image: env.SGTM_HOST_IMAGE,
  apex: env.SGTM_HOST_APEX,
});

app.listen({ port: env.SGTM_HOST_PORT, host: "0.0.0.0" }).catch((err) => {
  logger().fatal({ err: err.message }, "sgtm-host failed to start");
  process.exit(1);
});
