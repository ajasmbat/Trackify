"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CART_COOKIE, addLine, parseCart, removeLine, serializeCart } from "./cart";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export async function addToCartAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  const qtyRaw = Number(formData.get("qty") ?? "1");
  const qty = Number.isFinite(qtyRaw) ? qtyRaw : 1;
  const jar = cookies();
  const current = parseCart(jar.get(CART_COOKIE)?.value);
  const next = addLine(current, sku, qty);
  jar.set(CART_COOKIE, serializeCart(next), baseCookieOptions());
  redirect("/cart");
}

export async function removeFromCartAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "");
  const jar = cookies();
  const current = parseCart(jar.get(CART_COOKIE)?.value);
  const next = removeLine(current, sku);
  jar.set(CART_COOKIE, serializeCart(next), baseCookieOptions());
  redirect("/cart");
}
