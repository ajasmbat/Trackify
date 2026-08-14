// journey_id — one id per visitor "session" that follows every event into the
// relay. Kept in sessionStorage (per-tab lifetime) with a fallback cookie so a
// same-tab reload survives. T12's cookie service will eventually own the
// authoritative visitor cookie; when it lands and sets `tf_jid`, that value
// wins over the client-generated one.
//
// visitor_id — a stable-across-sessions id. Also owned by T12 once that lands;
// until then we generate one client-side and cache it in localStorage so a
// return visit reuses it.

import { readCookie, writeCookie } from "./cookies";
import { newJourneyId } from "./ids";

// Names match the shared T12 contract as documented in the ticket description.
export const JOURNEY_COOKIE = "tf_jid";
export const VISITOR_COOKIE = "tf_vid";
export const JOURNEY_STORAGE = "tf_jid";
export const VISITOR_STORAGE = "tf_vid";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function safeSession(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function safeLocal(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function getJourneyId(): string {
  // Cookie set by T12 wins — it is the same id the server hashed into a row.
  const fromCookie = readCookie(JOURNEY_COOKIE);
  if (fromCookie) {
    safeSession()?.setItem(JOURNEY_STORAGE, fromCookie);
    return fromCookie;
  }
  const stored = safeSession()?.getItem(JOURNEY_STORAGE);
  if (stored) return stored;

  const minted = newJourneyId();
  safeSession()?.setItem(JOURNEY_STORAGE, minted);
  // Best-effort mirror to a short-lived cookie so a same-domain link click
  // arrives at the next page with an id already in scope.
  writeCookie(JOURNEY_COOKIE, minted, { maxAgeSeconds: 60 * 60 * 6 });
  return minted;
}

export function getVisitorId(): string {
  const fromCookie = readCookie(VISITOR_COOKIE);
  if (fromCookie) return fromCookie;
  const stored = safeLocal()?.getItem(VISITOR_STORAGE);
  if (stored) return stored;
  const minted = newJourneyId();
  safeLocal()?.setItem(VISITOR_STORAGE, minted);
  writeCookie(VISITOR_COOKIE, minted, { maxAgeSeconds: ONE_YEAR_SECONDS });
  return minted;
}
