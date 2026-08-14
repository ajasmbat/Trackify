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
- 2026-08-14 — Dev HTTPS via **Cloudflare Tunnel** (`cloudflared`), not ngrok.
  Two named tunnels on two apexes: storefront + relay on `<A>`, ad network on
  `<B>`. Cloudflared gives free stable custom-domain subdomains (ngrok's free
  tier reshuffles the hostname each restart), a single dashboard for DNS +
  cert issuance, and it survives laptop reboots. Tradeoff: requires each dev
  to own two apex domains and move their nameservers to Cloudflare — a
  documented one-time cost (see `infra/README.md`) and cheaper than debugging
  fake cookie behaviour later. `localhost` is banned outright: browsers treat
  it specially and lie about SameSite/Secure.
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
- 2026-08-14 — Console auth is Auth.js v5 (next-auth beta) with a
  single-operator Credentials provider driven by env
  (`CONSOLE_USERNAME` / `CONSOLE_PASSWORD` + `AUTH_SECRET`). Picked over
  Clerk to avoid a hosted-service signup for a single-operator dev tool, and
  over hand-rolled cookies because Auth.js manages the session JWT + CSRF.
  When the console grows a real team, swap the provider (GitHub / Google /
  SSO) without touching the rest of the app — the layout only consumes
  `auth()`.
- 2026-08-14 — Console reads Postgres directly via Drizzle, never via the
  relay. A dedicated `CONSOLE_DATABASE_URL` optionally points at a
  read-only role; in dev it falls back to `DATABASE_URL`. The console's
  query layer never SELECTs `destinations.credentials_encrypted`, so a
  misconfigured dev DB won't leak the ciphertext either.
- 2026-08-14 — Console live tail is client-side polling every 2s against
  `/api/events?since=<received_at>` — no SSE, no WebSocket. One less
  infra piece; the console is one-operator-per-tenant so polling load is
  trivial. Revisit only if polling starts costing meaningful DB time.
