import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  installCookies,
  JOURNEY_COOKIE,
  RELAY_VISITOR_COOKIE,
  DEFAULT_VISITOR_MAX_AGE_SECONDS,
} from "./middleware";

async function build(
  opts: Parameters<typeof installCookies>[1] = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await installCookies(app, opts);
  app.get("/e", async (req, reply) => {
    reply.header("x-visitor", req.visitorId ?? "");
    reply.header("x-journey", req.journeyId ?? "");
    reply.header("x-minted", req.visitorIdMinted ? "1" : "0");
    return { ok: true };
  });
  app.get("/healthz", async () => ({ ok: true }));
  await app.ready();
  return app;
}

function setCookieHeaders(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers["set-cookie"];
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw.map(String) : [String(raw)];
}

function cookieByName(cookies: string[], name: string): string | undefined {
  return cookies.find((c) => c.startsWith(`${name}=`));
}

describe("installCookies — first visit", () => {
  it("mints rly_vid and sets it with the plan's canonical attribute list", async () => {
    const app = await build({ mintVisitorId: () => "MINTED_ID_1" });
    const res = await app.inject({ method: "GET", url: "/e" });
    const cookies = setCookieHeaders(res);
    const rly = cookieByName(cookies, RELAY_VISITOR_COOKIE);
    expect(rly).toBeDefined();
    expect(rly).toContain("rly_vid=MINTED_ID_1");
    expect(rly).toContain("Path=/");
    expect(rly).toContain(`Max-Age=${DEFAULT_VISITOR_MAX_AGE_SECONDS}`);
    expect(rly).toContain("SameSite=None");
    expect(rly).toContain("Secure");
    expect(rly).toContain("HttpOnly");
    expect(rly).toContain("Partitioned");
    expect(res.headers["x-minted"]).toBe("1");
    expect(res.headers["x-visitor"]).toBe("MINTED_ID_1");
  });

  it("also sets a JS-visible tf_jid (no HttpOnly) — journey cookie", async () => {
    const app = await build({
      mintVisitorId: () => "V",
      mintJourneyId: () => "J",
    });
    const res = await app.inject({ method: "GET", url: "/e" });
    const cookies = setCookieHeaders(res);
    const jid = cookieByName(cookies, JOURNEY_COOKIE);
    expect(jid).toBeDefined();
    expect(jid).toContain("tf_jid=J");
    expect(jid).not.toContain("HttpOnly");
    expect(jid).toContain("SameSite=None");
    expect(jid).toContain("Partitioned");
  });

  it("stamps req.journeyId from the value it just Set-Cookied so client + server agree", async () => {
    const app = await build({
      mintVisitorId: () => "V",
      mintJourneyId: () => "MATCH-ME",
    });
    const res = await app.inject({ method: "GET", url: "/e" });
    const jid = cookieByName(setCookieHeaders(res), JOURNEY_COOKIE);
    expect(res.headers["x-journey"]).toBe("MATCH-ME");
    // Same value on the Set-Cookie means a same-page client fetch reading
    // document.cookie sees exactly what the server just used.
    expect(jid).toContain("tf_jid=MATCH-ME");
  });

  it("includes Domain when configured", async () => {
    const app = await build({
      cookieDomain: "data.acme.test",
      mintVisitorId: () => "V",
    });
    const res = await app.inject({ method: "GET", url: "/e" });
    expect(
      cookieByName(setCookieHeaders(res), RELAY_VISITOR_COOKIE),
    ).toContain("Domain=data.acme.test");
  });
});

describe("installCookies — return visit", () => {
  it("reuses the rly_vid the client sent (no mint) and refreshes Max-Age", async () => {
    let mintCalls = 0;
    const app = await build({
      mintVisitorId: () => {
        mintCalls += 1;
        return "SHOULD-NOT-BE-USED";
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/e",
      headers: { cookie: "rly_vid=EXISTING_ID" },
    });
    expect(mintCalls).toBe(0);
    expect(res.headers["x-visitor"]).toBe("EXISTING_ID");
    expect(res.headers["x-minted"]).toBe("0");
    const rly = cookieByName(setCookieHeaders(res), RELAY_VISITOR_COOKIE);
    expect(rly).toContain("rly_vid=EXISTING_ID");
    // Rolling expiry: every response re-sets Max-Age.
    expect(rly).toContain(`Max-Age=${DEFAULT_VISITOR_MAX_AGE_SECONDS}`);
  });

  it("second request from the same client keeps a stable id AND re-emits Set-Cookie (rolling expiry)", async () => {
    const app = await build({ mintVisitorId: () => "STABLE_ID" });
    const first = await app.inject({ method: "GET", url: "/e" });
    const rlyFirst = cookieByName(setCookieHeaders(first), RELAY_VISITOR_COOKIE);
    expect(rlyFirst).toContain("rly_vid=STABLE_ID");

    const second = await app.inject({
      method: "GET",
      url: "/e",
      headers: { cookie: `${RELAY_VISITOR_COOKIE}=STABLE_ID` },
    });
    const rlySecond = cookieByName(
      setCookieHeaders(second),
      RELAY_VISITOR_COOKIE,
    );
    expect(rlySecond).toContain("rly_vid=STABLE_ID");
    expect(rlySecond).toContain(`Max-Age=${DEFAULT_VISITOR_MAX_AGE_SECONDS}`);
    expect(second.headers["x-minted"]).toBe("0");
  });
});

describe("installCookies — journey resolution", () => {
  it("prefers an x-journey-id header over the tf_jid cookie", async () => {
    const app = await build({
      mintVisitorId: () => "V",
      mintJourneyId: () => "SHOULD-NOT-MINT",
    });
    const res = await app.inject({
      method: "GET",
      url: "/e",
      headers: {
        "x-journey-id": "FROM-HEADER",
        cookie: "tf_jid=FROM-COOKIE",
      },
    });
    expect(res.headers["x-journey"]).toBe("FROM-HEADER");
  });

  it("falls back to tf_jid cookie when no header", async () => {
    const app = await build({
      mintVisitorId: () => "V",
      mintJourneyId: () => "SHOULD-NOT-MINT",
    });
    const res = await app.inject({
      method: "GET",
      url: "/e",
      headers: { cookie: "tf_jid=FROM-COOKIE" },
    });
    expect(res.headers["x-journey"]).toBe("FROM-COOKIE");
  });
});

describe("installCookies — exempt routes", () => {
  it("skips /healthz entirely — no Set-Cookie header on the reply", async () => {
    const app = await build({ mintVisitorId: () => "V" });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(setCookieHeaders(res)).toHaveLength(0);
    expect(res.headers["x-visitor"]).toBeUndefined();
  });
});
