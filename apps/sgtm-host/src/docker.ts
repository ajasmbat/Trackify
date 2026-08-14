import { spawn } from "node:child_process";
import { createServer } from "node:net";

// Docker client abstraction. Two implementations:
//   - `DockerCliClient` shells out to the `docker` binary on PATH. Chosen
//     over dockerode to keep this app dependency-free (dockerode pulls
//     ssh2 + native deps that break some CI environments) and because every
//     verb we need — run, inspect, rm — is a single `docker` invocation.
//   - `MockDockerClient` is an in-memory fake, activated via
//     `SGTM_HOST_DOCKER=mock`. Tests use it; CI without Docker uses it.
//
// This interface is the ONLY surface the provisioning routes talk to.

export interface StartOptions {
  name: string;
  image: string;
  env: Record<string, string>;
  // Container listens on 8080 internally; we publish it to a free host port
  // (chosen at run time via `pickFreePort`) so multiple containers coexist
  // on one host.
  hostPort: number;
  containerPort: number;
}

export interface RunningContainer {
  id: string;
  name: string;
  hostPort: number;
  image: string;
  running: boolean;
  exitedWithError?: string;
}

export interface DockerClient {
  ping(): Promise<void>;
  start(opts: StartOptions): Promise<RunningContainer>;
  inspect(name: string): Promise<RunningContainer | null>;
  stop(name: string): Promise<void>;
}

export class DockerCliError extends Error {
  constructor(
    message: string,
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "DockerCliError";
  }
}

async function run(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? -1, stdout, stderr }),
    );
  });
}

export class DockerCliClient implements DockerClient {
  async ping(): Promise<void> {
    const r = await run(["version", "--format", "{{.Server.Version}}"]);
    if (r.code !== 0) {
      throw new DockerCliError("docker daemon unreachable", r.stderr);
    }
  }

  async start(opts: StartOptions): Promise<RunningContainer> {
    const args = [
      "run",
      "-d",
      "--restart",
      "unless-stopped",
      "--name",
      opts.name,
      "-p",
      `${opts.hostPort}:${opts.containerPort}`,
    ];
    for (const [k, v] of Object.entries(opts.env)) {
      args.push("-e", `${k}=${v}`);
    }
    args.push(opts.image);
    const r = await run(args);
    if (r.code !== 0) {
      throw new DockerCliError(
        `docker run failed for ${opts.name}`,
        r.stderr,
      );
    }
    const id = r.stdout.trim();
    return {
      id,
      name: opts.name,
      hostPort: opts.hostPort,
      image: opts.image,
      running: true,
    };
  }

  async inspect(name: string): Promise<RunningContainer | null> {
    // `{{json .State}}` returns the container's runtime state; we only need
    // running/exit-status. Format outputs one JSON per line.
    const r = await run([
      "inspect",
      "--format",
      "{{.Id}}|{{.State.Running}}|{{.State.ExitCode}}|{{.State.Error}}",
      name,
    ]);
    if (r.code !== 0) {
      // `No such object` → not present. Every other failure is a real error.
      if (/No such object/i.test(r.stderr)) return null;
      throw new DockerCliError(`docker inspect failed for ${name}`, r.stderr);
    }
    const [id, running, exitCode, stateError] = r.stdout.trim().split("|");
    const isRunning = running === "true";
    let exitedWithError: string | undefined;
    if (!isRunning) {
      const parsedExit = Number(exitCode ?? "0");
      if (parsedExit !== 0 || (stateError && stateError.length > 0)) {
        exitedWithError = stateError && stateError.length > 0
          ? stateError
          : `container exited with code ${parsedExit}`;
      }
    }
    return {
      id: id ?? "",
      name,
      // hostPort/image are known by the caller (persisted in DB) — we don't
      // re-parse them from inspect since the DB is authoritative.
      hostPort: 0,
      image: "",
      running: isRunning,
      exitedWithError,
    };
  }

  async stop(name: string): Promise<void> {
    // `rm -f` stops (SIGKILL after grace) and removes in one shot. Idempotent:
    // exits non-zero on "No such container" which we treat as success.
    const r = await run(["rm", "-f", name]);
    if (r.code !== 0 && !/No such container/i.test(r.stderr)) {
      throw new DockerCliError(`docker rm -f failed for ${name}`, r.stderr);
    }
  }
}

// Simple, deterministic-ish free-port picker. `net.createServer().listen(0)`
// asks the OS for an ephemeral port and the OS guarantees the assignment;
// binding a container to it a moment later is fine because Docker itself
// binds a fresh socket rather than inheriting ours.
export async function pickFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("failed to acquire free port"));
      }
    });
  });
}

// ---- Mock implementation used by tests and mock-mode boots -----------------

interface MockEntry {
  id: string;
  name: string;
  hostPort: number;
  image: string;
  env: Record<string, string>;
  running: boolean;
  exitedWithError?: string;
}

export class MockDockerClient implements DockerClient {
  private readonly containers = new Map<string, MockEntry>();
  private counter = 0;

  async ping(): Promise<void> {
    // Always fine.
  }

  async start(opts: StartOptions): Promise<RunningContainer> {
    if (this.containers.has(opts.name)) {
      throw new DockerCliError(`container ${opts.name} already exists`);
    }
    this.counter += 1;
    const id = `mock-${this.counter.toString(16).padStart(8, "0")}`;
    const entry: MockEntry = {
      id,
      name: opts.name,
      hostPort: opts.hostPort,
      image: opts.image,
      env: opts.env,
      running: true,
    };
    this.containers.set(opts.name, entry);
    return this.snapshot(entry);
  }

  async inspect(name: string): Promise<RunningContainer | null> {
    const entry = this.containers.get(name);
    if (!entry) return null;
    return this.snapshot(entry);
  }

  async stop(name: string): Promise<void> {
    this.containers.delete(name);
  }

  // ---- Test-only helpers ---------------------------------------------------
  simulateExit(name: string, error: string): void {
    const entry = this.containers.get(name);
    if (!entry) return;
    entry.running = false;
    entry.exitedWithError = error;
  }

  peek(name: string): MockEntry | undefined {
    return this.containers.get(name);
  }

  list(): MockEntry[] {
    return [...this.containers.values()];
  }

  private snapshot(entry: MockEntry): RunningContainer {
    return {
      id: entry.id,
      name: entry.name,
      hostPort: entry.hostPort,
      image: entry.image,
      running: entry.running,
      exitedWithError: entry.exitedWithError,
    };
  }
}

export function createDockerClient(mode: "docker" | "mock"): DockerClient {
  return mode === "mock" ? new MockDockerClient() : new DockerCliClient();
}
