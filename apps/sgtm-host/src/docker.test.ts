import { describe, expect, it } from "vitest";
import { MockDockerClient, pickFreePort } from "./docker";

describe("MockDockerClient", () => {
  it("starts, inspects, and stops a container", async () => {
    const docker = new MockDockerClient();
    const started = await docker.start({
      name: "sgtm-mock",
      image: "img",
      env: { CONTAINER_CONFIG: "cfg" },
      hostPort: 65001,
      containerPort: 8080,
    });
    expect(started.running).toBe(true);

    const found = await docker.inspect("sgtm-mock");
    expect(found?.running).toBe(true);

    await docker.stop("sgtm-mock");
    expect(await docker.inspect("sgtm-mock")).toBeNull();
  });

  it("simulateExit flips running to false with an error message", async () => {
    const docker = new MockDockerClient();
    await docker.start({
      name: "boom",
      image: "img",
      env: {},
      hostPort: 65002,
      containerPort: 8080,
    });
    docker.simulateExit("boom", "OCI runtime create failed");
    const info = await docker.inspect("boom");
    expect(info?.running).toBe(false);
    expect(info?.exitedWithError).toBe("OCI runtime create failed");
  });

  it("refuses to double-start a container with the same name", async () => {
    const docker = new MockDockerClient();
    await docker.start({
      name: "dup",
      image: "img",
      env: {},
      hostPort: 65003,
      containerPort: 8080,
    });
    await expect(
      docker.start({
        name: "dup",
        image: "img",
        env: {},
        hostPort: 65004,
        containerPort: 8080,
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("pickFreePort", () => {
  it("returns a port the OS actually gave us", async () => {
    const port = await pickFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});
