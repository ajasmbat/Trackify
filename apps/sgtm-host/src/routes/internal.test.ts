import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { MockDockerClient } from "../docker";
import { FakeRepo } from "../testing/fake-repo";

const TENANT_ID = "00000000-0000-0000-0000-00000000abcd";

function build(): { app: Promise<FastifyInstance>; repo: FakeRepo; docker: MockDockerClient } {
  const repo = new FakeRepo();
  const docker = new MockDockerClient();
  const app = buildApp({
    repo,
    docker,
    image: "gcr.io/cloud-tagging-10302018/server:latest",
    apex: "sgtm.example.dev",
    logger: false,
    provisionerOverrides: {
      // Fast health-check loop: succeed on the second attempt after 5ms.
      healthOverrides: {
        totalTimeoutMs: 5_000,
        intervalMs: 1,
        // deterministic clock so waitForHealthy stays inside the deadline
        now: () => 0,
        sleep: async () => {},
        fetch: async () => ({ status: 200 }),
      },
      // Stable port so assertions don't chase the OS.
      pickHostPort: async () => 65500,
    },
  });
  return { app, repo, docker };
}

describe("POST /internal/containers", () => {
  let app: FastifyInstance;
  let repo: FakeRepo;
  let docker: MockDockerClient;

  beforeEach(async () => {
    const b = build();
    repo = b.repo;
    docker = b.docker;
    app = await b.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it("provisions a container, sets env, publishes port, marks ready", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-XYZ",
        containerConfig: "AABBCC",
        subdomain: "acme",
        previewServerUrl: "https://preview.example.dev",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.subdomain).toBe("acme");
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.containerState).toMatchObject({
      hostPort: 65500,
      containerName: `sgtm-${TENANT_ID}-${body.id}`,
      image: "gcr.io/cloud-tagging-10302018/server:latest",
    });

    const mockEntry = docker.peek(`sgtm-${TENANT_ID}-${body.id}`);
    expect(mockEntry).toBeDefined();
    expect(mockEntry?.env["CONTAINER_CONFIG"]).toBe("AABBCC");
    expect(mockEntry?.env["RUN_AS_PREVIEW_SERVER"]).toBe("false");
    expect(mockEntry?.env["PREVIEW_SERVER_URL"]).toBe(
      "https://preview.example.dev",
    );
    expect(mockEntry?.hostPort).toBe(65500);
    expect(repo.all()).toHaveLength(1);
  });

  it("rejects an invalid subdomain shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-XYZ",
        containerConfig: "cfg",
        subdomain: "UPPERCASE",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_body");
  });
});

describe("POST /internal/containers — health-check retry", () => {
  it("retries until healthy — then persists ready", async () => {
    const repo = new FakeRepo();
    const docker = new MockDockerClient();
    let attempt = 0;
    const app = await buildApp({
      repo,
      docker,
      image: "img",
      apex: "sgtm.example.dev",
      logger: false,
      provisionerOverrides: {
        healthOverrides: {
          totalTimeoutMs: 5_000,
          intervalMs: 1,
          now: () => 0,
          sleep: async () => {},
          fetch: async () => {
            attempt += 1;
            if (attempt < 4) throw new Error("ECONNREFUSED");
            return { status: 200 };
          },
        },
        pickHostPort: async () => 65501,
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-RETRY",
        containerConfig: "cfg",
        subdomain: "retry",
      },
    });
    expect(res.statusCode).toBe(201);
    expect(attempt).toBe(4);
    expect(res.json().status).toBe("ready");
    await app.close();
  });

  it("marks the row `error` and stops the container when health never comes up", async () => {
    const repo = new FakeRepo();
    const docker = new MockDockerClient();
    const now = { t: 0 };
    const app = await buildApp({
      repo,
      docker,
      image: "img",
      apex: "sgtm.example.dev",
      logger: false,
      provisionerOverrides: {
        healthOverrides: {
          totalTimeoutMs: 50,
          intervalMs: 10,
          now: () => now.t,
          sleep: async (ms: number) => {
            now.t += ms;
          },
          fetch: async () => {
            throw new Error("ECONNREFUSED");
          },
        },
        pickHostPort: async () => 65502,
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-FAIL",
        containerConfig: "cfg",
        subdomain: "fail",
      },
    });
    expect(res.statusCode).toBe(500);
    // The row should have moved to `error` with `lastError` set.
    const row = repo.all()[0];
    expect(row?.status).toBe("error");
    expect(row?.lastError).toMatch(/health check/);
    // And the container should have been cleaned up.
    expect(docker.list()).toHaveLength(0);
    await app.close();
  });
});

describe("GET /internal/containers/:id", () => {
  it("returns 404 when unknown", async () => {
    const { app: p } = build();
    const app = await p;
    const res = await app.inject({
      method: "GET",
      url: "/internal/containers/does-not-exist",
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("flips status to error + writes lastError when the container has exited", async () => {
    const { app: p, repo, docker } = build();
    const app = await p;
    const create = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-STAT",
        containerConfig: "cfg",
        subdomain: "stat",
      },
    });
    const id = create.json().id;
    // Simulate the container crashing after provisioning.
    docker.simulateExit(`sgtm-${TENANT_ID}-${id}`, "OOMKilled");

    const res = await app.inject({
      method: "GET",
      url: `/internal/containers/${id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("error");
    expect(res.json().lastError).toBe("OOMKilled");
    expect(repo.all()[0]?.status).toBe("error");
    await app.close();
  });
});

describe("DELETE /internal/containers/:id", () => {
  it("stops the container, marks status=stopped, returns 204", async () => {
    const { app: p, repo, docker } = build();
    const app = await p;
    const create = await app.inject({
      method: "POST",
      url: "/internal/containers",
      payload: {
        tenantId: TENANT_ID,
        gtmContainerId: "GTM-DEL",
        containerConfig: "cfg",
        subdomain: "del",
      },
    });
    const id = create.json().id;
    const containerName = `sgtm-${TENANT_ID}-${id}`;
    expect(docker.peek(containerName)).toBeDefined();

    const res = await app.inject({
      method: "DELETE",
      url: `/internal/containers/${id}`,
    });
    expect(res.statusCode).toBe(204);
    expect(docker.peek(containerName)).toBeUndefined();
    expect(repo.all()[0]?.status).toBe("stopped");
    await app.close();
  });
});
