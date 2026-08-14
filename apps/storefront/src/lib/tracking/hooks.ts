"use client";

// React hooks that turn a mounting component into a single, idempotent
// CanonicalEvent + pixel call. Every hook is defended against React 18
// StrictMode's double-invoke (dev-only re-mount) AND against page-level
// re-renders — mounting the PDP twice fires `view_item` once.
//
// The dedupe strategy is two-layered on purpose:
//   - hook-local `useRef` keeps the current component's own re-renders quiet
//   - client-level `dedupeKey` catches the case where the SAME hook mounts in
//     two components in the same session (e.g. modal + inline)

import type { LineItem } from "@trackify/shared";
import { useCallback, useEffect, useRef } from "react";
import {
  PIXEL_ID_ENV_KEY,
  type TrackInput,
  type TrackOptions,
  type TrackResult,
  identify as clientIdentify,
  isKnownVisitor as clientIsKnownVisitor,
  track as clientTrack,
} from "./client";
import { captureClickParams } from "./fbc";
import { PIXEL_EVENT_NAME, initPixel } from "./pixel";

/**
 * One-time boot: init the Meta pixel, capture ad-click params from the
 * current URL, and mint the client-side visitor + journey ids. Safe to mount
 * multiple times — every internal step is idempotent.
 */
export function useTrackingBoot(): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const pixelId = (process.env as Record<string, string | undefined>)[PIXEL_ID_ENV_KEY];
    initPixel(pixelId);
    if (typeof window !== "undefined" && window.location?.href) {
      captureClickParams({ url: window.location.href, nowMs: Date.now() });
    }
  }, []);
}

export function usePageView(path: string): void {
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    if (lastPath.current === path) return;
    lastPath.current = path;
    clientTrack({ name: "page_view", path }, { dedupeKey: `page_view:${path}` });
  }, [path]);
}

export function useViewItem(item: LineItem): void {
  const fired = useRef<string | null>(null);
  // We deliberately depend on `sku` alone — a re-render with a new price or
  // quantity is still the same product view.
  const sku = item.sku;
  useEffect(() => {
    if (fired.current === sku) return;
    fired.current = sku;
    clientTrack({ name: "view_item", item }, { dedupeKey: `view_item:${sku}` });
  }, [sku, item]);
}

/**
 * Returns an imperative `fireAddToCart(item)` — the PDP submits a server
 * action so the tracking call needs to run on click, not on mount. Not
 * deduped: adding the same item twice is two legitimate cart events.
 */
export function useAddToCart(): (item: LineItem) => TrackResult {
  return useCallback((item) => clientTrack({ name: "add_to_cart", item }), []);
}

export interface BeginCheckoutSummary {
  readonly items: readonly LineItem[];
  readonly valueCents: number;
  readonly currency: string;
}

export function useBeginCheckout(summary: BeginCheckoutSummary): void {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    if (summary.items.length === 0) return;
    fired.current = true;
    // Dedupe by the line-summary fingerprint so an F5 during checkout is one
    // begin_checkout, but a genuinely different cart on a second visit fires
    // its own.
    const key = `begin_checkout:${summary.items
      .map((i) => `${i.sku}x${i.quantity}`)
      .join(",")}:${summary.valueCents}`;
    clientTrack(
      {
        name: "begin_checkout",
        items: summary.items,
        valueCents: summary.valueCents,
        currency: summary.currency,
      },
      { dedupeKey: key },
    );
  }, [summary]);
}

export interface PurchaseSummary {
  readonly orderId: string;
  readonly items: readonly LineItem[];
  readonly valueCents: number;
  readonly currency: string;
}

export function usePurchase(order: PurchaseSummary): void {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (fired.current === order.orderId) return;
    fired.current = order.orderId;
    clientTrack(
      {
        name: "purchase",
        orderId: order.orderId,
        items: order.items,
        valueCents: order.valueCents,
        currency: order.currency,
      },
      { dedupeKey: `purchase:${order.orderId}` },
    );
  }, [order.orderId, order.items, order.valueCents, order.currency]);
}

/**
 * Fire `user_identified` once per email-phone tuple. Marks the visitor as
 * known so downstream code can flip UX without exposing PII to logs.
 */
export function useIdentify(identity: { email?: string; phone?: string } | null | undefined): void {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!identity) return;
    const key = `${identity.email ?? ""}|${identity.phone ?? ""}`;
    if (key === "|") return;
    if (fired.current === key) return;
    fired.current = key;
    clientIdentify(identity, { dedupeKey: `user_identified:${key}` });
  }, [identity]);
}

// Re-export so callers can do `import { … } from "@/lib/tracking/hooks"`.
export {
  clientIsKnownVisitor as isKnownVisitor,
  clientTrack as track,
  PIXEL_EVENT_NAME,
  type TrackInput,
  type TrackOptions,
};
