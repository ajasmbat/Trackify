# Safari cookie longevity — server-set vs JS-set

**Why this exists.** The whole justification for shipping a server-set
visitor cookie (`rly_vid`) is that Safari's Intelligent Tracking Prevention
(ITP) treats cookies written via `document.cookie` more aggressively than
cookies delivered via a `Set-Cookie` response header. If the delta is
small, that undermines T12's entire product category — the measurement is
non-negotiable, and the number stays here even when it is unflattering.

## Method

Two identical cookies are placed on the same third-party subdomain
(`data.<tenant>`) from a fresh Safari profile:

- **JS-set** — `document.cookie = "js_probe=…; Max-Age=63072000; Path=/;
  Secure; SameSite=None; Partitioned"`, set from the storefront page
  script (first-party context from the storefront's point of view; third-
  party from `data.<tenant>`'s point of view when the fetch is made).
- **Server-set** — the relay's normal `rly_vid` header, same
  `SameSite=None; Partitioned; Secure; HttpOnly; Path=/;
  Max-Age=63072000` attribute set the code writes on every response.

The probe page is loaded once at t=0 and NEVER revisited. Every 24 hours a
background job on a separate device pings the storefront and reads both
cookies (server via `Cookie` header echo, JS via a fetch that hydrates a
small check page). The moment either cookie fails to come back, that leg
is marked expired and the day count is recorded.

## Environment

- Safari 17 (baseline for the 2026 ITP behaviour on macOS Sonoma / iOS 17).
- CHIPS is enabled — both cookies are `Partitioned`. Note: `Partitioned`
  cookies are wiped when the top-level site's storage is cleared, so a
  Safari user who Manage-Website-Data-cleared the storefront would zero
  both legs on the same day. The measurement therefore assumes a
  passive-return user.
- The relay lives at `data.<tenant>` (see
  [DECISIONS.md](../../DECISIONS.md)). The storefront is at
  `shop.<tenant>`. Cross-site context is real, not simulated with
  `localhost` (localhost lies about SameSite/Secure — see the same
  ADR entry).

## Results

Recorded here after each measurement round. Fields are days-since-write
until the leg goes dark.

| Round start | JS-set (N) | Server-set (M) | Delta (M − N) | Notes |
|-------------|-----------:|---------------:|--------------:|-------|
| 2026-08-14  | *not-yet-measured* | *not-yet-measured* | — | Instrumentation landed with T12. First real data expected the day the storefront runs against Safari for a fortnight. |

**Reporting rule.** When a round completes, add a row. Do NOT overwrite an
earlier row — a shrinking delta over Safari releases is exactly the
signal T12 exists to catch. If a round shows `M − N ≤ 3`, add a bold
line beneath the table saying so; that number is the entire product
category's justification, and a small delta is bigger news than a large
one.

## What this measurement is NOT

- Not a `HttpOnly` proof. ITP does not care whether the cookie is
  HttpOnly; it cares who wrote it. We keep `rly_vid` `HttpOnly`
  because there is no legitimate reason for JS to read the visitor id
  — but that decision is separate from the ITP survival number.
- Not a Chrome number. Chrome under CHIPS shortens `Partitioned`
  cookies too, but the mechanism is different (site-storage lifecycle
  vs ITP heuristics) — a separate measurement, not this one.
- Not a proxy for `_fbc` survival. The whole point of persisting
  `visitors.fbc` in Postgres (see T12's `apps/relay/src/cookies/store.ts`)
  is that we stop caring how long the client `_fbc` cookie lives —
  the server has it.
