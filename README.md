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
cp .env.example .env          # fill in CREDENTIAL_KEY_HEX + the three *_URL vars
pnpm db:push && pnpm seed     # schema + demo tenant
pnpm dev                      # storefront:3000, ad-network:3001, console:3002, relay:3003
```

## HTTPS dev environment — **required**

Trackify's whole reason for existing is server-side tracking around cookies,
and every browser lies about cookies on `localhost`. You will build the wrong
thing if you develop against `http://localhost`.

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
