"use client";

// Small client-only bridges: pages are server components so the hooks in
// ./hooks can't be called there. Each tracker is a mount-and-forget component
// with no visual output — its `useEffect` fires the CanonicalEvent exactly
// once per meaningful key change.

import type { LineItem } from "@trackify/shared";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "./client";
import { PIXEL_ID_ENV_KEY } from "./client";
import { captureClickParams } from "./fbc";
import {
  type BeginCheckoutSummary,
  type PurchaseSummary,
  useBeginCheckout,
  useIdentify,
  usePageView,
  usePurchase,
  useTrackingBoot,
  useViewItem,
} from "./hooks";
import { initPixel } from "./pixel";

/**
 * Mount once at the app root. Boots the pixel, captures ad-click params on
 * first landing, and fires `page_view` on every route change.
 */
export function TrackingProvider(): null {
  useTrackingBoot();
  const pathname = usePathname() ?? "/";
  usePageView(pathname);
  return null;
}

// --- Individual per-page trackers ------------------------------------------
// Reading `LineItem` from a plain object shape means server components can
// pass POJOs across the RSC boundary without extra ceremony.

export function ViewItemTracker(props: { readonly item: LineItem }): null {
  useViewItem(props.item);
  return null;
}

export function BeginCheckoutTracker(props: { readonly summary: BeginCheckoutSummary }): null {
  useBeginCheckout(props.summary);
  return null;
}

export function PurchaseTracker(props: {
  readonly order: PurchaseSummary;
  readonly identity?: { readonly email?: string; readonly phone?: string } | null;
}): null {
  usePurchase(props.order);
  useIdentify(props.identity ?? null);
  return null;
}

/**
 * Wraps the Add-to-Cart form. Fires `add_to_cart` synchronously on submit,
 * BEFORE the server action navigates away — same JS turn, same `event_id`
 * flows to both the pixel and the relay via `sendBeacon`/pixel. The qty is
 * whatever is in the form at click time.
 */
export function AddToCartTracker(props: {
  readonly product: {
    readonly sku: string;
    readonly name: string;
    readonly priceCents: number;
    readonly currency: string;
  };
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      onClickCapture={(evt) => {
        const target = evt.target as HTMLElement | null;
        if (!target) return;
        // Only react to submit-button clicks — a click on the number input
        // shouldn't record an add.
        const button = target.closest?.("button, input[type='submit']") as HTMLElement | null;
        if (!button) return;
        const form = button.closest("form");
        const qtyRaw = form?.querySelector<HTMLInputElement>("input[name='qty']")?.value ?? "1";
        const qty = Math.max(1, Math.floor(Number.parseInt(qtyRaw, 10) || 1));
        const item: LineItem = {
          sku: props.product.sku,
          name: props.product.name,
          quantity: qty,
          price_cents: props.product.priceCents,
          currency: props.product.currency,
        };
        track({ name: "add_to_cart", item });
      }}
    >
      {props.children}
    </span>
  );
}

/**
 * Fallback boot for pages that render before the root layout wraps its
 * children (edge cases, error boundaries). Idempotent.
 */
export function EagerBoot(): null {
  useEffect(() => {
    const pixelId = (process.env as Record<string, string | undefined>)[PIXEL_ID_ENV_KEY];
    initPixel(pixelId);
    if (typeof window !== "undefined" && window.location?.href) {
      captureClickParams({ url: window.location.href, nowMs: Date.now() });
    }
  }, []);
  return null;
}
