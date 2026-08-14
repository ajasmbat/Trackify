# Trackify dev infrastructure

Everything that runs *around* the app: Postgres, and — the point of this
directory — the HTTPS tunnels that give the storefront, relay, and ad network
real, publicly-resolvable hostnames on **two different apex domains** so
browsers apply real cross-site cookie rules to them.

## Why not `localhost`?

Every browser gives `localhost`, `*.localhost`, and `*.local` special
treatment. Cookies you set there follow different rules from cookies on a real
domain: SameSite defaults are relaxed, `Secure` is not enforced, and the ad
network never looks like a third party to the storefront. Building Trackify
against `localhost` teaches you cookie behaviour that will not survive
production.

The rest of this doc walks you through the one-time setup for `pnpm tunnel`,
which puts three real HTTPS URLs in front of your local dev servers.

---

## Prerequisites

You need **two apex domains you control**, on different registrable eTLD+1s:

| Role | Example | What lives here |
| --- | --- | --- |
| `<A>` — first-party apex | `example.dev` | `shop.<A>` (storefront) + `data.<A>` (relay) |
| `<B>` — third-party apex | `some-other.xyz` | `ads.<B>` (ad network) |

**They must be different registrable domains.** `shop.example.com` +
`ads2.example.com` are *same-site* to the browser and defeat the whole
exercise. If you don't own two, you can grab a `.dev` for ~$12/yr and a
`.xyz`/`.top` for a few dollars — both work with Cloudflare's free plan.

Then:

1. Move each apex's nameservers to Cloudflare (free plan is fine). Give it a
   few minutes to propagate; `dig NS <A>` should show `*.ns.cloudflare.com`.
2. Install `cloudflared` (macOS: `brew install cloudflared`; other platforms:
   <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>).
3. `cloudflared tunnel login` — opens a browser, pick each of your two zones
   in turn to authorise cert issuance. This writes `~/.cloudflared/cert.pem`.

---

## One-time tunnel setup

We use **two named tunnels** — one per apex — because a single tunnel's
credentials are scoped to one Cloudflare account/zone-set and we want the two
apexes truly independent.

```sh
# Tunnel A — storefront + relay
cloudflared tunnel create trackify-shop
#  → prints a UUID and writes ~/.cloudflared/<UUID>.json — keep both.
cloudflared tunnel route dns trackify-shop shop.<A>
cloudflared tunnel route dns trackify-shop data.<A>

# Tunnel B — ad network (DIFFERENT apex)
cloudflared tunnel create trackify-ad
cloudflared tunnel route dns trackify-ad ads.<B>
```

Each `route dns` command creates a proxied CNAME in the corresponding
Cloudflare zone. Verify in the dashboard: two records on `<A>` and one on
`<B>`, all showing the orange cloud (proxied).

Then render the local configs from the templates in this repo:

```sh
cp infra/tunnel/shop.yml.example infra/tunnel/shop.yml
cp infra/tunnel/ad.yml.example   infra/tunnel/ad.yml
```

Edit each file and replace:

- `TUNNEL_A_ID` / `TUNNEL_B_ID` — the UUIDs printed above
- `TUNNEL_A_CREDENTIALS` / `TUNNEL_B_CREDENTIALS` — the absolute paths to the
  JSON credential files (`~/.cloudflared/<UUID>.json`)
- `APEX_A` / `APEX_B` — your two apex domains

`shop.yml` and `ad.yml` are gitignored — the tunnel IDs and credential paths
are per-developer.

---

## Running

```sh
pnpm dev      # start all four apps (storefront:3000, ad-network:3001, console:3002, relay:3003)
pnpm tunnel   # in a second terminal — starts both cloudflared tunnels
```

Set the three public URLs in your local `.env` (see `.env.example`):

```
STOREFRONT_URL=https://shop.<A>
RELAY_URL=https://data.<A>
AD_NETWORK_URL=https://ads.<B>
```

Every app reads these from env — no tunnel domain is hardcoded anywhere in
the codebase.

## Verifying

```sh
curl -sI https://shop.<A>/       # storefront → 200 (or 404 if the page isn't built yet)
curl -sI https://data.<A>/healthz # relay → 200
curl -sI https://ads.<B>/         # ad network → 200
```

**Third-party cookie sanity check** (Safari + Chrome, both):

1. Open `https://ads.<B>` and let it set a cookie (the ad network's own
   `/set-cookie` route, whatever T3 exposes).
2. Open `https://shop.<A>` and inspect the request DevTools makes to
   `https://ads.<B>/...` — the cookie from step 1 **must not** appear on that
   cross-site request unless it was minted with `SameSite=None; Secure`. If
   it does appear regardless, your two apexes are actually same-site and one
   of them needs to change.

---

## Rotating the tunnel token

If a credential file leaks (checked-in by mistake, laptop lost, whatever):

```sh
cloudflared tunnel delete trackify-shop   # revokes the old credentials
cloudflared tunnel create trackify-shop   # writes a fresh UUID + JSON
# re-run the two `route dns` commands from the setup section
```

Update the `TUNNEL_A_ID` / `TUNNEL_A_CREDENTIALS` fields in `shop.yml` to
match. Same procedure for `trackify-ad`.

Losing `~/.cloudflared/cert.pem` is recoverable — just re-run
`cloudflared tunnel login`.

---

## Postgres

`docker compose up -d` at the repo root brings up Postgres 16 on `:5432` with
the credentials in `.env.example`. Nothing tunnel-related; documented here
because this directory is "dev infra".
