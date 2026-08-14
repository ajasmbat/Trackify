import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PIXEL_EVENT_NAME, _resetPixelForTests, initPixel, trackPixelEvent } from "./pixel";
import { type TrackingTestDom, installTestDom } from "./test-dom";

let dom: TrackingTestDom;

beforeEach(() => {
  dom = installTestDom();
});

afterEach(() => {
  _resetPixelForTests();
  dom.restore();
});

describe("initPixel", () => {
  it("no-ops when the pixel id is undefined (dev environments without a pixel)", () => {
    initPixel(undefined);
    // No `init` call should reach fbq.
    expect(dom.fbqCalls.some((c) => c[0] === "init")).toBe(false);
  });

  it("initialises the pixel with the given id and is idempotent across repeat calls", () => {
    initPixel("PXL-1");
    initPixel("PXL-1");
    initPixel("PXL-1");
    const initCalls = dom.fbqCalls.filter((c) => c[0] === "init");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toEqual(["init", "PXL-1"]);
  });
});

describe("trackPixelEvent", () => {
  beforeEach(() => {
    initPixel("PXL-1");
  });

  it("forwards the eventID so browser + relay hits dedupe into one conversion", () => {
    trackPixelEvent("view_item", { content_ids: ["p-101"] }, "event-xyz");
    const trackCalls = dom.fbqCalls.filter((c) => c[0] === "track");
    expect(trackCalls).toHaveLength(1);
    expect(trackCalls[0]).toEqual([
      "track",
      "ViewContent",
      { content_ids: ["p-101"] },
      { eventID: "event-xyz" },
    ]);
  });

  it("maps every CanonicalEvent name we fire from JS to a real Meta pixel name", () => {
    for (const name of ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"]) {
      expect(PIXEL_EVENT_NAME[name]).toBeDefined();
    }
    // user_identified is server-only, per plan.
    expect(PIXEL_EVENT_NAME.user_identified).toBeUndefined();
  });

  it("silently drops when the pixel isn't initialised (ad blocker etc.)", () => {
    _resetPixelForTests();
    dom.restore();
    dom = installTestDom();
    // No initPixel call. Should not throw.
    expect(() => trackPixelEvent("purchase", {}, "e-1")).not.toThrow();
    expect(dom.fbqCalls.filter((c) => c[0] === "track")).toHaveLength(0);
  });
});
