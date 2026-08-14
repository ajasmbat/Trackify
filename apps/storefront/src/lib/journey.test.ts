import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_CART, addLine, parseCart, resolveLines, serializeCart, totalCents } from "./cart";
import { getProduct } from "./catalog";
import { createOrder, orderCookieName, parseOrder, serializeOrder } from "./order";

// Integration-style: reproduces the browser flow at the data layer.
// add_to_cart -> begin_checkout -> purchase (freeze) -> confirmation render inputs.
// This is what Wave 1 can assert without a running Next server; T15 owns the
// Playwright harness that walks the actual DOM.
describe("add_to_cart -> begin_checkout -> purchase", () => {
  it("survives serialization at every hop and preserves the fields T8 will read", () => {
    // Hop 1: two PDP add-to-cart actions land in the cookie.
    let cart = EMPTY_CART;
    cart = addLine(cart, "p-104", 1); // wool beanie, 2400
    cart = addLine(cart, "p-103", 2); // field notebook, 850

    // The cookie serialization is what actually persists across refreshes.
    const cookieAfterAdd = serializeCart(cart);
    const cartAfterRefresh = parseCart(cookieAfterAdd);
    expect(cartAfterRefresh.lines).toEqual(cart.lines);

    // Hop 2: checkout resolves the cart against the live catalog.
    const resolved = resolveLines(cartAfterRefresh);
    expect(resolved).toHaveLength(2);
    expect(totalCents(cartAfterRefresh)).toBe(2400 + 850 * 2);

    // Hop 3: place_order freezes the resolved cart into an order snapshot.
    const placedAt = "2026-08-14T12:00:00.000Z";
    const order = createOrder(
      resolved,
      { email: "jane@example.com", phone: "+14155550100" },
      placedAt,
    );

    // Confirmation cookie roundtrip — the confirmation page reads exactly this.
    const cookieName = orderCookieName(order.id);
    expect(cookieName.startsWith("sf_order_")).toBe(true);
    const fromCookie = parseOrder(serializeOrder(order));
    expect(fromCookie).not.toBeNull();

    // The DOM fields T8's tracking loader must be able to read for `purchase`.
    expect(fromCookie?.id).toMatch(/^ord_[0-9a-f]{12}$/);
    expect(fromCookie?.currency).toBe("USD");
    expect(fromCookie?.totalCents).toBe(2400 + 850 * 2);
    expect(fromCookie?.lines.map((l) => l.sku)).toEqual(["p-104", "p-103"]);
    for (const line of fromCookie?.lines ?? []) {
      const catalog = getProduct(line.sku);
      expect(catalog).toBeDefined();
      expect(line.unitPriceCents).toBe(catalog?.priceCents);
      expect(line.subtotalCents).toBe(line.unitPriceCents * line.qty);
    }
  });

  it("generates a unique transaction_id per order", () => {
    const resolved = resolveLines(addLine(EMPTY_CART, "p-101", 1));
    const identity = { email: "a@b.co", phone: "555" };
    const iso = "2026-08-14T00:00:00.000Z";
    const a = createOrder(resolved, identity, iso);
    const b = createOrder(resolved, identity, iso);
    expect(a.id).not.toBe(b.id);
  });
});

describe("no tracking imports", () => {
  // Acceptance check: this ticket must not import from apps/storefront/lib/tracking/**
  // or reach data.<domain>. The path does not exist yet (T8 owns it), so a stray
  // import would already fail typecheck — this is belt-and-suspenders.
  const APP_ROOT = join(__dirname, "..");
  const FORBIDDEN_PATTERNS = [/\/lib\/tracking\b/, /['"]data\.[a-z0-9-]+['"]/i];

  it("has no references to lib/tracking or data.<domain> anywhere in the app source", () => {
    for (const file of walk(APP_ROOT)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      // Skip this test file — the forbidden patterns appear here as assertions.
      if (file === __filename) continue;
      const contents = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(pattern.test(contents), `${relative(APP_ROOT, file)} contains ${pattern}`).toBe(
          false,
        );
      }
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}
