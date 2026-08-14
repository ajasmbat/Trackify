# Trackify

Server-side conversion tracking for Shopify-style storefronts. Ingests browser
events at a relay, enriches + hashes PII, fans them out to destination pixels
(Meta first). See `DECISIONS.md` for structural choices and `CONTEXT.md` for
domain vocabulary.

## Quickstart

You need Node 20+, pnpm 9, and Docker.

```sh
pnpm install
docker compose up -d          # Postgres 16 on :5432
cp .env.example .env          # fill in CREDENTIAL_KEY_HEX + AUTH_SECRET
pnpm db:push && pnpm seed     # schema + demo tenants
pnpm dev                      # storefront:3000, ad-network:3001, console:3002, relay:3003
```

Then open `http://localhost:3001`, click the ad, and the click should land as a
row on `http://localhost:3002/events` within a few seconds. The seed attaches
`localhost` to the acme tenant and adds the storefront + ad-network origins to
its CORS allowlist so the localhost flow works with zero manual DB edits — see
[HTTPS dev environment](#https-dev-environment--required) below for the real
cross-site cookie setup you'll want once you're past the smoke test.

**Empty console after clicking the ad?** Open the storefront's DevTools →
Network tab and confirm the click POSTs to `http://localhost:3003/e` with a 2xx
response. If it POSTs to `https://data.example.dev/e` instead, your `.env`'s
`NEXT_PUBLIC_RELAY_URL` was set at build time — restart `pnpm dev` after
editing.

## HTTPS dev environment — **required**

Trackify's whole reason for existing is server-side tracking around cookies,
and every browser lies about cookies on `localhost`. The localhost Quickstart
above still runs the full flow end-to-end, but cookie stitching (visitor
identity, `fbc`/`fbp` persistence) is degraded on `localhost` — you will build
the wrong thing if you rely on it. Use the tunnels for anything cookie-related.

Instead we run two Cloudflare Tunnels giving three real HTTPS URLs on **two
different apex domains**:

| Env var | Serves | Apex |
| --- | --- | --- |
| `STOREFRONT_URL` | `apps/storefront` (Next.js) | `shop.<A>` |
| `RELAY_URL` | `apps/relay` (Fastify) | `data.<A>` |
| `AD_NETWORK_URL` | `apps/ad-network` (Next.js) | `ads.<B>` — a **different** apex |

Full one-time setup (Cloudflare account, `cloudflared` install, DNS routes,
credential rotation): **[`infra/README.md`](./infra/README.md)**.

Once set up:

```sh
pnpm tunnel   # in a second terminal — starts both cloudflared tunnels
```

`<A>` and `<B>` **must** be different registrable apex domains. Sibling
subdomains of one apex are same-site to the browser and defeat cross-site
cookie testing. `localhost`, `*.localhost`, and `*.local` are all forbidden
for the same reason.

## Layout

```
apps/
  storefront/     Next.js 14 App Router — the fake shop
  ad-network/     Next.js 14 App Router — the fake third-party ad site
  console/        Next.js 14 App Router — operator UI
  relay/          Fastify — ingest, enrich, fan out to destinations
packages/
  shared/         Contracts: CanonicalEvent, Destination, env loader, logger
  db/             Drizzle schema, seed, credential encryption
infra/
  tunnel/         Cloudflare Tunnel configs — see infra/README.md
docker-compose.yml Postgres 16
```

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | All four apps in parallel |
| `pnpm tunnel` | Both Cloudflare tunnels (needs one-time setup) |
| `pnpm build` | Build every app |
| `pnpm typecheck` | Type-check every workspace |
| `pnpm test` | Vitest (unit) |
| `pnpm db:push` | Apply Drizzle schema to `DATABASE_URL` |
| `pnpm seed` | Seed a demo tenant + destinations |
