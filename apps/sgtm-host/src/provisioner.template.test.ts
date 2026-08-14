import { describe, expect, it } from "vitest";
import { render } from "@trackify/sgtm-templates";
import { MockDockerClient } from "./docker";
import { Provisioner } from "./provisioner";
import { FakeRepo } from "./testing/fake-repo";

const TENANT_ID = "00000000-0000-0000-0000-00000000abcd";
const IMAGE = "gcr.io/cloud-tagging-10302018/server:latest";

// End-to-end check that the base template + render() produces a
// CONTAINER_CONFIG string the sGTM host container starts against without
// erroring. Uses the mock Docker client so this stays in-process.
describe("Provisioner ← @trackify/sgtm-templates", () => {
  it("provisions healthily with a rendered base container config", async () => {
    const rendered = render({
      gtmContainerId: "GTM-ACME99",
      meta: {
        pixelId: "111111111111111",
        accessToken: "SEED_ACME_META_TOKEN",
      },
    });

    const repo = new FakeRepo();
    const docker = new MockDockerClient();
    const provisioner = new Provisioner({
      repo,
      docker,
      image: IMAGE,
      logger: { info() {}, warn() {}, error() {} },
      pickHostPort: async () => 65501,
      healthOverrides: {
        totalTimeoutMs: 1_000,
        intervalMs: 1,
        now: () => 0,
        sleep: async () => {},
        fetch: async () => ({ status: 200 }),
      },
    });

    const row = await provisioner.provision({
      tenantId: TENANT_ID,
      gtmContainerId: "GTM-ACME99",
      containerConfig: rendered.base64,
      subdomain: "acme",
    });

    expect(row.status).toBe("ready");
    const entry = docker.peek(`sgtm-${TENANT_ID}-${row.id}`);
    expect(entry).toBeDefined();
    // The container receives the exact base64 render() produced.
    expect(entry?.env["CONTAINER_CONFIG"]).toBe(rendered.base64);
    // Round-trip: the decoded config is valid JSON with a Trackify data client.
    const decoded = JSON.parse(
      Buffer.from(entry!.env["CONTAINER_CONFIG"]!, "base64").toString("utf8"),
    ) as {
      containerVersion: {
        client: Array<{ name: string }>;
      };
    };
    expect(decoded.containerVersion.client[0]?.name).toBe(
      "Trackify Data Client",
    );
  });
});
