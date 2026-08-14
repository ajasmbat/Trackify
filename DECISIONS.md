# DECISIONS

One line per structural choice. Newest at bottom. Every downstream ticket reads
this before proposing a different approach.

- 2026-08-14 — pnpm workspaces, not Turborepo/Nx. Two shared packages
  (`@trackify/shared`, `@trackify/db`) + four apps. Keeps the tree flat, no extra
  build system to reason about.
- 2026-08-14 — Node 20+ everywhere; TypeScript strict + `noUncheckedIndexedAccess`.
- 2026-08-14 — Structured logging via `pino` (JSON to stdout only, no file
  transport — the Docker log driver handles collection). Every log line carries
  `request_id`; if a request has a `journey_id` it appears on every line for
  that request (AsyncLocalStorage-scoped in `@trackify/shared/logger`).
- 2026-08-14 — Env validated at boot with Zod in `@trackify/shared/env`. Any
  missing required key throws with the key name in the message. No defaults for
  required keys — the whole point is to fail loud on a fresh clone.
- 2026-08-14 — Postgres 16 via Docker Compose. Queue is a Postgres table
  (`delivery_jobs`), not Redis — one less service, ACID with the writes.
- 2026-08-14 — Drizzle ORM for the schema. `events` and `delivery_jobs` both
  store the inbound payload AND an `outbound_per_destination` JSONB map so hop 6
  of the flow contract is verifiable end-to-end.
- 2026-08-14 — Destination credentials encrypted at rest with **libsodium
  `crypto_secretbox_easy`** (XSalsa20-Poly1305 AEAD, 32-byte symmetric key from
  `CREDENTIAL_KEY_HEX`). Tradeoff: single symmetric key vs. per-tenant KMS
  envelope. Picked libsodium: single-node, no KMS ops, and rotating the key is
  a documented re-encrypt migration. Revisit when we move to multi-region.
- 2026-08-14 — PII normalisation + SHA-256 hashing live in
  `@trackify/shared/pii`. No PII flows through this ticket — the helpers exist
  so downstream tickets (T4 ingest, T6 Meta) use one code path.
- 2026-08-14 — Shared `journey_id` generator in `@trackify/shared/journey` so
  T4 (ingest) and T8 (loader) share one code path.
- 2026-08-14 — Relay is Fastify (not Next.js API routes) — lightweight,
  first-class request lifecycle hooks, and `pino` is the default logger.
- 2026-08-14 — Storefront, ad-network, console are Next.js App Router with
  the built-in dev server; each app owns its own port via env.
- 2026-08-14 — `packages/shared` is FROZEN once this ticket merges. Downstream
  tickets that need a change to shared contracts must request an amendment
  ticket, not edit here.
- 2026-08-14 — `apps/ad-network` does NOT import from `packages/shared`. It
  simulates an external ad network, so it must not share code with our own
  services. Its own tiny env validator + fbclid generator live under
  `apps/ad-network/src/lib`.
- 2026-08-14 — Fake `fbclid` shape: `IwAR` prefix + 36 URL-safe base64 chars
  (27 random bytes, base64url) = 40 chars total. Matches Meta's observed
  pattern in the wild. Reference: Meta's public docs on the Click Identifier —
  <https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/fbp-and-fbc/>
  — where `fbc` is `fb.<subdomain>.<creation>.<fbclid>` and `fbclid` is treated
  as an opaque token starting with `IwAR`.
- 2026-08-14 — Ad-network sets `Referrer-Policy: strict-origin-when-cross-origin`
  on every response. Real Facebook goes further and strips the path
  (`Referer: https://l.facebook.com/`) via its `l.facebook.com` redirector +
  policy; our storefront will see `Referer: https://<ad-network-apex>` (origin
  only, path stripped by the policy). Difference from real Facebook: the
  hostname is our ad-network apex rather than `l.facebook.com`. Downstream
  tests must match on "origin equals ad-network apex", not on
  `facebook.com`.
