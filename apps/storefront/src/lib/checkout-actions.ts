"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CART_COOKIE, EMPTY_CART, parseCart, resolveLines, serializeCart } from "./cart";
import { createOrder, orderCookieName, serializeOrder } from "./order";
import { IDENTITY_COOKIE, serializeIdentity } from "./session";

const IDENTITY_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const ORDER_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

function normalizeEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}

function normalizePhone(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim();
}

export async function placeOrderAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(formData.get("email"));
  const phone = normalizePhone(formData.get("phone"));
  if (!email || !phone) {
    redirect("/checkout?error=missing_identity");
  }

  const jar = cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const resolved = resolveLines(cart);
  if (resolved.length === 0) {
    redirect("/cart?error=empty");
  }

  const nowIso = new Date().toISOString();
  const order = createOrder(resolved, { email, phone }, nowIso);

  jar.set(IDENTITY_COOKIE, serializeIdentity({ email, phone }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: IDENTITY_MAX_AGE,
  });

  jar.set(orderCookieName(order.id), serializeOrder(order), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ORDER_MAX_AGE,
  });

  jar.set(CART_COOKIE, serializeCart(EMPTY_CART), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  redirect(`/order/${order.id}`);
}
