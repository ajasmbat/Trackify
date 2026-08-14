import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  addLine,
  parseCart,
  removeLine,
  resolveLines,
  serializeCart,
  setQty,
  totalCents,
  totalQty,
} from "./cart";

describe("addLine", () => {
  it("appends a new sku", () => {
    const cart = addLine(EMPTY_CART, "p-101", 2);
    expect(cart.lines).toEqual([{ sku: "p-101", qty: 2 }]);
  });

  it("merges qty when the sku is already in the cart", () => {
    const cart = addLine(addLine(EMPTY_CART, "p-101", 1), "p-101", 3);
    expect(cart.lines).toEqual([{ sku: "p-101", qty: 4 }]);
  });

  it("ignores unknown skus", () => {
    const cart = addLine(EMPTY_CART, "does-not-exist", 1);
    expect(cart.lines).toEqual([]);
  });

  it("clamps qty to at least 1 and floors fractional values", () => {
    expect(addLine(EMPTY_CART, "p-101", 0).lines).toEqual([{ sku: "p-101", qty: 1 }]);
    expect(addLine(EMPTY_CART, "p-101", 2.7).lines).toEqual([{ sku: "p-101", qty: 2 }]);
  });

  it("caps qty at the per-line max even after merges", () => {
    const cart = addLine(addLine(EMPTY_CART, "p-101", 90), "p-101", 90);
    expect(cart.lines[0]?.qty).toBe(99);
  });
});

describe("removeLine", () => {
  it("drops a sku regardless of qty", () => {
    const cart = removeLine(
      {
        lines: [
          { sku: "p-101", qty: 3 },
          { sku: "p-102", qty: 1 },
        ],
      },
      "p-101",
    );
    expect(cart.lines).toEqual([{ sku: "p-102", qty: 1 }]);
  });
});

describe("setQty", () => {
  it("updates an existing line", () => {
    const cart = setQty({ lines: [{ sku: "p-101", qty: 1 }] }, "p-101", 5);
    expect(cart.lines).toEqual([{ sku: "p-101", qty: 5 }]);
  });

  it("removes the line when qty <= 0", () => {
    const cart = setQty({ lines: [{ sku: "p-101", qty: 3 }] }, "p-101", 0);
    expect(cart.lines).toEqual([]);
  });
});

describe("totals", () => {
  it("sums subtotals from the resolved catalog prices", () => {
    // p-101 = 1800 cents, p-104 = 2400 cents
    const cart = {
      lines: [
        { sku: "p-101", qty: 2 },
        { sku: "p-104", qty: 1 },
      ],
    };
    const total = totalCents(cart);
    expect(total).toBe(1800 * 2 + 2400 * 1);
    expect(totalQty(cart)).toBe(3);
  });

  it("ignores lines whose product no longer exists", () => {
    const cart = {
      lines: [
        { sku: "p-101", qty: 2 },
        { sku: "gone", qty: 5 },
      ],
    };
    const resolved = resolveLines(cart);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.sku).toBe("p-101");
    expect(totalCents(cart)).toBe(1800 * 2);
  });
});

describe("serializeCart / parseCart", () => {
  it("roundtrips a cart through JSON cleanly", () => {
    const cart = addLine(addLine(EMPTY_CART, "p-101", 2), "p-104", 1);
    const roundtrip = parseCart(serializeCart(cart));
    expect(roundtrip).toEqual(cart);
  });

  it("returns EMPTY_CART for missing or garbage cookies", () => {
    expect(parseCart(undefined)).toEqual(EMPTY_CART);
    expect(parseCart("")).toEqual(EMPTY_CART);
    expect(parseCart("not json")).toEqual(EMPTY_CART);
    expect(parseCart('{"lines":"nope"}')).toEqual(EMPTY_CART);
  });

  it("filters malformed line entries out of a mixed cookie", () => {
    const raw = JSON.stringify({
      lines: [
        { sku: "p-101", qty: 2 },
        { sku: "", qty: 3 },
        { sku: "p-104" },
        { sku: "p-104", qty: -1 },
        "not-an-object",
      ],
    });
    expect(parseCart(raw).lines).toEqual([{ sku: "p-101", qty: 2 }]);
  });
});
