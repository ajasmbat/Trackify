// Thin wrapper around Meta's browser pixel (`fbq`). Everything that leaves
// this file is DRY on two invariants:
//   1. Only ONE pixel init per document, no matter how many components mount.
//   2. Every `trackEvent` call MUST accept an `eventId` and forward it as
//      Meta's `eventID` — the SAME id also travels to the relay as
//      CanonicalEvent.event_id so Meta can dedupe browser + server hits into
//      one conversion. This is the deduplication contract; T8's whole
//      existence hinges on this one property.

type FbqFn = (...args: unknown[]) => void;

// Minimal shape — Meta's real fbq shim is a hybrid function + queue array;
// we only ever read `loaded` and call it as a function.
type FbqShim = FbqFn & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  push?: FbqFn;
  callMethod?: FbqFn;
};

declare global {
  interface Window {
    fbq?: FbqShim;
    _fbq?: FbqShim;
  }
}

/** Canonical Meta pixel event names for the CanonicalEvent set we fire. */
export const PIXEL_EVENT_NAME: Readonly<Record<string, string>> = {
  page_view: "PageView",
  view_item: "ViewContent",
  add_to_cart: "AddToCart",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
} as const;

let initialized = false;

export function isPixelInitialized(): boolean {
  return initialized;
}

/**
 * Inject Meta's pixel snippet. Idempotent — calling multiple times is safe;
 * only the first call injects the script. `pixelId` may be undefined in dev
 * environments; the function no-ops in that case so tests and local runs
 * without a real pixel id keep working.
 */
export function initPixel(pixelId: string | undefined): void {
  if (initialized) return;
  if (!pixelId) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Meta's canonical inline snippet, rewritten in TS. Sets up `window.fbq` as
  // a queue-then-flush shim, injects the fbevents.js script, then dispatches
  // `init` + `PageView`. We suppress the automatic `PageView` because the
  // client's `track()` sends its own with a matching `event_id`.
  if (!window.fbq) {
    const n = ((...args: unknown[]) => {
      if (n.callMethod) n.callMethod.apply(n, args);
      else n.queue?.push(args);
    }) as FbqShim;
    if (!window._fbq) window._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [];
    window.fbq = n;

    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }

  // `init` twice with the same id is a no-op inside Meta's script, but we
  // still guard so downstream diagnostic logs stay clean.
  window.fbq?.("init", pixelId);
  initialized = true;
}

/**
 * Fire a Meta standard event with an explicit `eventID`. Non-throwing — if
 * the pixel wasn't initialised (bad env, ad blocker) the call quietly drops
 * so a failed pixel never breaks the relay call that fires alongside it.
 */
export function trackPixelEvent(
  canonicalName: string,
  params: Record<string, unknown>,
  eventId: string,
): void {
  if (typeof window === "undefined") return;
  // `initialized` is false when either the pixel id env is missing or the
  // hook that boots the pixel hasn't run yet — either way, no call goes out.
  if (!initialized) return;
  const fbq = window.fbq;
  if (!fbq) return;
  const pixelName = PIXEL_EVENT_NAME[canonicalName];
  if (!pixelName) return;
  fbq("track", pixelName, params, { eventID: eventId });
}

// Test-only reset — the initialised flag is module-local so a fresh vitest
// worker starts fresh, but the same worker running multiple tests needs to
// forget the flag between cases.
export function _resetPixelForTests(): void {
  initialized = false;
  if (typeof window !== "undefined") {
    window.fbq = undefined;
    window._fbq = undefined;
  }
}
