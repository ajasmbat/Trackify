// Public surface of the tracking module. Everything a storefront page needs
// to fire a CanonicalEvent (+ matching Meta pixel call) is re-exported here
// so callers do `import { … } from "@/lib/tracking"`.

export { captureClickParams, readFbc, readFbp, readGclAw, buildFbc, buildFbp } from "./fbc";
export { getJourneyId, getVisitorId } from "./journey";
export { initPixel, trackPixelEvent, PIXEL_EVENT_NAME, isPixelInitialized } from "./pixel";
export {
  identify,
  isKnownVisitor,
  markIdentified,
  track,
  defaultTransport,
  PIXEL_ID_ENV_KEY,
  RELAY_URL_ENV_KEY,
  TENANT_ID_ENV_KEY,
  type TrackInput,
  type TrackOptions,
  type TrackResult,
  type Transport,
} from "./client";
export {
  useAddToCart,
  useBeginCheckout,
  useIdentify,
  usePageView,
  usePurchase,
  useTrackingBoot,
  useViewItem,
  type BeginCheckoutSummary,
  type PurchaseSummary,
} from "./hooks";
