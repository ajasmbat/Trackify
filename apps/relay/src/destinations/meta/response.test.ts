import { describe, expect, it } from "vitest";
import { MetaHttpNetworkError } from "./http";
import { mapMetaResponse, mapMetaThrown } from "./response";

const OUTBOUND = { data: [{ x: 1 }] };

describe("mapMetaResponse", () => {
  it("maps 2xx to ok and carries fbtrace_id as provider_message_id", () => {
    const result = mapMetaResponse(
      { status: 200, body: { events_received: 1, fbtrace_id: "trace-1" } },
      OUTBOUND,
    );
    expect(result).toEqual({
      kind: "ok",
      provider_message_id: "trace-1",
      outbound_payload: OUTBOUND,
    });
  });

  it("maps 201 to ok even without fbtrace_id", () => {
    const result = mapMetaResponse({ status: 201, body: {} }, OUTBOUND);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.provider_message_id).toBeUndefined();
      expect(result.outbound_payload).toBe(OUTBOUND);
    }
  });

  it("maps 429 to transient_failure", () => {
    const result = mapMetaResponse(
      { status: 429, body: { error: { message: "rate limited" } } },
      OUTBOUND,
    );
    expect(result).toMatchObject({
      kind: "transient_failure",
      reason: "rate limited",
      status: 429,
      outbound_payload: OUTBOUND,
    });
  });

  it("maps 500 to transient_failure and falls back to http_500 when Meta has no error body", () => {
    const result = mapMetaResponse({ status: 500, body: null }, OUTBOUND);
    expect(result).toMatchObject({
      kind: "transient_failure",
      reason: "http_500",
      status: 500,
    });
  });

  it("maps 503 to transient_failure", () => {
    const result = mapMetaResponse({ status: 503, body: {} }, OUTBOUND);
    expect(result.kind).toBe("transient_failure");
  });

  it("maps 400 to permanent_failure and captures Meta's error.message", () => {
    const result = mapMetaResponse(
      {
        status: 400,
        body: {
          error: {
            message: "Invalid access token",
            code: 190,
            fbtrace_id: "trace-err",
          },
        },
      },
      OUTBOUND,
    );
    expect(result).toMatchObject({
      kind: "permanent_failure",
      reason: "Invalid access token",
      status: 400,
      outbound_payload: OUTBOUND,
    });
  });

  it("prefers error_user_msg when Meta provides both", () => {
    const result = mapMetaResponse(
      {
        status: 400,
        body: {
          error: {
            message: "Invalid access token",
            error_user_msg: "Your access token has expired.",
          },
        },
      },
      OUTBOUND,
    );
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.reason).toBe("Your access token has expired.");
    }
  });

  it("maps 404 to permanent_failure", () => {
    const result = mapMetaResponse({ status: 404, body: null }, OUTBOUND);
    expect(result).toMatchObject({
      kind: "permanent_failure",
      reason: "http_404",
      status: 404,
    });
  });
});

describe("mapMetaThrown", () => {
  it("maps a network error to transient_failure", () => {
    const err = new MetaHttpNetworkError("ECONNRESET");
    const result = mapMetaThrown(err, OUTBOUND);
    expect(result).toMatchObject({
      kind: "transient_failure",
      reason: "ECONNRESET",
      outbound_payload: OUTBOUND,
    });
  });

  it("maps unexpected errors to permanent_failure (bug guard)", () => {
    const err = new Error("adapter bug");
    const result = mapMetaThrown(err, OUTBOUND);
    expect(result).toMatchObject({
      kind: "permanent_failure",
      reason: "adapter bug",
      outbound_payload: OUTBOUND,
    });
  });
});
