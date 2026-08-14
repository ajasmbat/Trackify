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
- 2026-08-14 — T11 loader. The relay serves a per-tenant tracking snippet
  from its own apex at `GET /l/<loader_path>.js`. `loader_path` is a
  48-bit CSPRNG URL-safe base64 segment (`node:crypto.randomBytes(6)`)
  stored on the `tenants` row, generated once at provisioning and NEVER
  auto-rotated — rotating breaks cached storefront `<script src>` tags,
  so it's a manual operator action if a path leaks. The snippet body has
  no matchable literal for `POST /e`, no `facebook`/`fbq`/`_fbc`/`pixel`
  strings, and assembles its ingest URL from three concatenated locals
  (`host + "/" + endpoint`). It reuses the T12 cookie names (`tf_jid`,
  `tf_vid`) so a page that also runs the T8 client shares one journey;
  the T8 client stays intact and both delivery vehicles are deduped by
  the server on `event_id`. The loader route is exempted from the
  Host-based tenancy hook in `apps/relay/src/tenancy/middleware.ts`
  because it identifies its tenant from the URL path, not the Host.
- 2026-08-14 — T11 ad-blocker measurement is **deferred, not run**. The
  loader code + storefront `<script src>` are in place; a real number
  needs both Cloudflare tunnels up (`data.<A>` + `shop.<A>`), a browser
  with uBlock Origin and Adblock Plus installed, and a full journey
  driven manually. That environment couldn't be assembled from the CI/
  worktree this ticket built in, so the honest record is: **before = ?,
  after = ?, TODO to fill in on the first end-to-end run** using
  `DevTools › Network` counts of successful `POST /e` per journey
  (landing → view_item → add_to_cart → begin_checkout → purchase).
  Two things we already know analytically:
  - On the default uBlock + ABP lists, the T8 client's own `POST /e` to
    `data.<domain>` is not on any filter we could find, so the baseline
    "before" number is likely already at parity with a no-blocker
    session. The loader's win over T8 alone is bounded by that.
  - The measurable value shows up against aggressive custom lists
    (EasyPrivacy sub-lists, enterprise filters) that DO block the
    literal `/e` URL or the `data.*` host pattern. That's where the
    randomised path + concatenated-URL source pays off, and where the
    "after" number should exceed the "before". If the first real
    measurement shows Y ≈ X on all lists we can throw at it, say so
    honestly in this file and re-open the question of whether the
    loader is earning its complexity.
- 2026-08-14 — Relay's visitor cookie is `rly_vid`, `HttpOnly; Secure;
  SameSite=None; Partitioned; Max-Age=63072000`. `HttpOnly` is
  deliberate: T8's JS must not read it, and it makes zero difference to
  Safari's ITP survival (see `docs/measurements/safari-cookie-longevity.md`).
  `Partitioned` (CHIPS) is required alongside `SameSite=None` in
  Chrome 2024+; it also shortens the server-set survival number under
  ITP — that is called out in the measurement doc. The optional
  `RELAY_COOKIE_DOMAIN` env pins the `Domain=` attribute in production;
  omitted in dev to get host-only.
- 2026-08-14 — Journey continuity uses a second, JS-visible cookie
  `tf_jid` (no `HttpOnly`). Splitting visitor identity (`rly_vid`,
  HttpOnly) from journey state (`tf_jid`, JS-readable) keeps the
  loader / pixel free of any need to read the visitor id while still
  letting client + server agree on the same journey.
- 2026-08-14 — `visitors.fbc` / `visitors.fbp` persist server-side. The
  cookie service upserts them on every ingest that carries `_fbc` (or
  a URL `fbclid`) / `_fbp`, so a later event with no client `_fbc`
  can still ship `fbc` on the outbound Meta payload once T13's
  enricher lands. Persistence is composed at T12's `onResponse` hook —
  not inside T4's route handler — so T4's ownership boundary stays
  clean and a persistence failure never turns a 202 into a 5xx.
- 2026-08-14 — T14 live Meta wiring. Real credentials never touch the
  runtime env: the operator fills three `META_*` vars in `.env`, then
  runs `pnpm setup:meta` (apps/relay/src/destinations/meta/setup.ts)
  which encrypts them via the T1 helper and upserts one seeded tenant's
  `destinations` row. The setup script lives INSIDE
  `apps/relay/src/destinations/meta/` (not `packages/db/`) so this
  folder stays the only place that spells Meta credential field names —
  the containment test in `meta/index.test.ts` enforces that boundary.
  Rationale: keeps the runtime code path identical to production
  tenants (all creds live encrypted in Postgres) and keeps live tokens
  out of `.env` on shared boxes. `pixel_id` intentionally lives INSIDE
  the encrypted credentials blob (not just in the plaintext
  `destinations.config` column) because the T6 adapter only receives
  the decrypted credentials record at send time — MetaConfig's Zod
  schema requires `pixel_id` there.
- 2026-08-14 — T14 boot guardrail. `apps/relay/src/server.ts` registers
  `metaDestination` in the DestinationRegistry (the `T6 lands and wires
  this line` stub is now real) and fires `warnMetaTestEventInProdAtBoot`
  right after `bootWorker`. The helper walks every enabled Meta row,
  decrypts, and calls T6's `warnIfTestEventInProduction`, which logs
  `meta_test_event_in_prod` per offender in production. Fire-and-forget
  so a DB blip at boot never blocks `listen()`; a DB blip during the
  walk itself logs `meta_boot_warn_failed` instead of throwing. Test:
  `apps/relay/src/destinations/meta/boot.test.ts`.
- 2026-08-14 — T14 verification runbook. The manual journey +
  Events Manager screenshots live under `docs/verification/README.md`,
  with `purchase-received.png` / `purchase-deduplicated.png` /
  `event-match-quality.png` dropped alongside it once the operator
  runs the sequence. The runbook stays inside `docs/verification/**`
  (this ticket's `Owns:` boundary) so a later live-verification pass
  can update the screenshots without touching any code.
