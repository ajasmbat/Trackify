// Session cart persisted in an httpOnly cookie. Small and dumb on purpose:
// the whole cart is JSON.stringify'd into a single cookie so refreshes and
// route changes survive. No DB, no server session store.
//
// Cookie name is deliberately `sf_cart` (storefront-scoped) so it never
// collides with the relay's cookie service (T12).

import { type Product, getProduct } from "./catalog";

export const CART_COOKIE = "sf_cart";
export const CURRENCY = "USD" as const;
const MAX_QTY_PER_LINE = 99;

export type CartLine = {
  readonly sku: string;
  readonly qty: number;
};

export type CartLineResolved = {
  readonly sku: string;
  readonly qty: number;
  readonly product: Product;
  readonly subtotalCents: number;
};

export type Cart = {
  readonly lines: readonly CartLine[];
};

export const EMPTY_CART: Cart = { lines: [] };

export function parseCart(raw: string | undefined): Cart {
  if (!raw) return EMPTY_CART;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || !("lines" in parsed)) return EMPTY_CART;
    const linesUnknown = (parsed as { lines: unknown }).lines;
    if (!Array.isArray(linesUnknown)) return EMPTY_CART;
    const lines: CartLine[] = [];
    for (const line of linesUnknown) {
      if (!line || typeof line !== "object") continue;
      const sku = (line as { sku?: unknown }).sku;
      const qty = (line as { qty?: unknown }).qty;
      if (typeof sku !== "string" || sku.length === 0) continue;
      if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) continue;
      lines.push({ sku, qty: Math.min(Math.floor(qty), MAX_QTY_PER_LINE) });
    }
    return { lines };
  } catch {
    return EMPTY_CART;
  }
}

export function serializeCart(cart: Cart): string {
  return JSON.stringify({ lines: cart.lines });
}

export function addLine(cart: Cart, sku: string, qty: number): Cart {
  const cleanQty = Math.max(1, Math.min(Math.floor(qty), MAX_QTY_PER_LINE));
  if (!Number.isFinite(cleanQty) || cleanQty <= 0) return cart;
  if (!getProduct(sku)) return cart;

  const existing = cart.lines.find((line) => line.sku === sku);
  const nextLines: CartLine[] = existing
    ? cart.lines.map((line) =>
        line.sku === sku ? { sku, qty: Math.min(line.qty + cleanQty, MAX_QTY_PER_LINE) } : line,
      )
    : [...cart.lines, { sku, qty: cleanQty }];
  return { lines: nextLines };
}

export function removeLine(cart: Cart, sku: string): Cart {
  return { lines: cart.lines.filter((line) => line.sku !== sku) };
}

export function setQty(cart: Cart, sku: string, qty: number): Cart {
  const clean = Math.floor(qty);
  if (!Number.isFinite(clean) || clean <= 0) return removeLine(cart, sku);
  return {
    lines: cart.lines.map((line) =>
      line.sku === sku ? { sku, qty: Math.min(clean, MAX_QTY_PER_LINE) } : line,
    ),
  };
}

export function resolveLines(cart: Cart): readonly CartLineResolved[] {
  const out: CartLineResolved[] = [];
  for (const line of cart.lines) {
    const product = getProduct(line.sku);
    if (!product) continue;
    out.push({
      sku: line.sku,
      qty: line.qty,
      product,
      subtotalCents: product.priceCents * line.qty,
    });
  }
  return out;
}

export function totalCents(cart: Cart): number {
  return resolveLines(cart).reduce((acc, line) => acc + line.subtotalCents, 0);
}

export function totalQty(cart: Cart): number {
  return cart.lines.reduce((acc, line) => acc + line.qty, 0);
}

export function formatUsd(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${dollars.toFixed(2)}`;
}
