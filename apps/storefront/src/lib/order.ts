// One-shot order snapshot. On checkout we freeze the cart into an order the
// confirmation page can render. Persisted in an httpOnly cookie keyed by
// order id, which is enough for a mock — no DB, no server session store.
//
// The confirmation DOM MUST expose transaction_id, value, currency, and the
// item list because T8's tracking loader reads it to fire the `purchase`
// event (see plan Acceptance checks).

import { randomUUID } from "node:crypto";
import type { CartLineResolved } from "./cart";
import { CURRENCY } from "./cart";

export const ORDER_COOKIE_PREFIX = "sf_order_";

export type OrderLine = {
  readonly sku: string;
  readonly name: string;
  readonly qty: number;
  readonly unitPriceCents: number;
  readonly subtotalCents: number;
};

export type Order = {
  readonly id: string;
  readonly placedAt: string;
  readonly email: string;
  readonly phone: string;
  readonly currency: "USD";
  readonly totalCents: number;
  readonly lines: readonly OrderLine[];
};

export function newOrderId(): string {
  return `ord_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createOrder(
  resolved: readonly CartLineResolved[],
  identity: { email: string; phone: string },
  placedAtIso: string,
): Order {
  const lines: OrderLine[] = resolved.map((line) => ({
    sku: line.sku,
    name: line.product.name,
    qty: line.qty,
    unitPriceCents: line.product.priceCents,
    subtotalCents: line.subtotalCents,
  }));
  return {
    id: newOrderId(),
    placedAt: placedAtIso,
    email: identity.email,
    phone: identity.phone,
    currency: CURRENCY,
    totalCents: lines.reduce((acc, l) => acc + l.subtotalCents, 0),
    lines,
  };
}

export function orderCookieName(orderId: string): string {
  return `${ORDER_COOKIE_PREFIX}${orderId}`;
}

export function serializeOrder(order: Order): string {
  return JSON.stringify(order);
}

export function parseOrder(raw: string | undefined): Order | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Order;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}
