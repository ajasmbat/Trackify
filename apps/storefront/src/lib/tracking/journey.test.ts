import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  JOURNEY_COOKIE,
  JOURNEY_STORAGE,
  VISITOR_COOKIE,
  getJourneyId,
  getVisitorId,
} from "./journey";
import { type TrackingTestDom, installTestDom } from "./test-dom";

let dom: TrackingTestDom;

beforeEach(() => {
  dom = installTestDom();
});

afterEach(() => {
  dom.restore();
});

describe("getJourneyId", () => {
  it("mints a stable id on first call and returns the same id on subsequent calls", () => {
    const first = getJourneyId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{20,24}$/);
    const second = getJourneyId();
    expect(second).toBe(first);
  });

  it("prefers the T12 cookie (`tf_jid`) over sessionStorage when the two disagree", () => {
    dom.restore();
    dom = installTestDom({ cookie: `${JOURNEY_COOKIE}=journey-from-server` });
    dom.sessionStorage.setItem(JOURNEY_STORAGE, "stale-local-value");
    expect(getJourneyId()).toBe("journey-from-server");
  });

  it("mirrors the minted id back into a short-lived cookie so link-clicks carry it", () => {
    const id = getJourneyId();
    expect(dom.cookies.get(JOURNEY_COOKIE)).toBe(id);
  });
});

describe("getVisitorId", () => {
  it("mints a stable visitor id and reuses it across calls", () => {
    const a = getVisitorId();
    const b = getVisitorId();
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,24}$/);
  });

  it("prefers the T12 cookie (`tf_vid`) when set by the server", () => {
    dom.restore();
    dom = installTestDom({ cookie: `${VISITOR_COOKIE}=vid-from-server` });
    expect(getVisitorId()).toBe("vid-from-server");
  });
});
