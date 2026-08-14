# Trackify dev infrastructure

Everything that runs *around* the app: Postgres, and — the point of this
directory — the HTTPS tunnels that give the storefront, relay, ad network,
and per-tenant sGTM containers real, publicly-resolvable hostnames on
**two different apex domains** so browsers apply real cross-site cookie
rules to them.

## Why not `localhost`?

Every browser gives `localhost`, `*.localhost`, and `*.local` special
treatment. Cookies you set there follow different rules from cookies on a real
domain: SameSite defaults are relaxed, `Secure` is not enforced, and the ad
network never looks like a third party to the storefront. Building Trackify
against `localhost` teaches you cookie behaviour that will not survive
production.

The rest of this doc walks you through the one-time setup for `pnpm tunnel`,
which puts three real HTTPS URLs in front of your local dev servers plus a
wildcard for per-tenant sGTM subdomains.

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
apexes truly independent. The third tunnel (sGTM wildcard) lives *under*
apex `<A>` and gets its own credentials for the same reason — the wildcard
DNS record is added in the Cloudflare dashboard, not by `cloudflared`.
See "Third tunnel: sGTM wildcard" below.

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

## Third tunnel: sGTM wildcard

`apps/sgtm-host` is a per-tenant reverse proxy that fronts Google's
`tagging-server` containers. Every tenant with `subdomain=<sub>` answers on
`<sub>.sgtm.<A>`, and sgtm-host peels `<sub>` off the incoming `Host` header
to look the container up. A single wildcard route on Cloudflare — one DNS
record, one cert, one tunnel — covers every current and future tenant with
no per-tenant Cloudflare change. It piggy-backs on apex `<A>` (same-site
with the storefront and relay data-plane); no third apex is introduced.

### 1. Create the third named tunnel

```sh
# Tunnel C — sGTM wildcard (SAME apex as shop.yml)
cloudflared tunnel create trackify-sgtm
#  → prints a UUID and writes ~/.cloudflared/<UUID>.json — keep both.
```

### 2. Add the wildcard DNS record (dashboard, not `cloudflared`)

`cloudflared tunnel route dns` does not accept wildcard hostnames. Add the
record manually:

1. Cloudflare dashboard → the `<A>` zone → **DNS → Records → Add record**.
2. Type: **CNAME**, Name: `*.sgtm`, Target: `<TUNNEL_C_UUID>.cfargotunnel.com`,
   Proxy status: **Proxied** (orange cloud). TTL: **Auto**.
3. Verify: `dig +short acme.sgtm.<A>` returns a Cloudflare edge IP (any
   subdomain resolves because the record is a wildcard).

### 3. Provision the wildcard TLS cert (DNS-01 challenge, UI)

Cloudflare's free **Universal SSL** covers the apex and one level of
subdomains (`*.<A>`). It does **not** cover a second-level wildcard like
`*.sgtm.<A>` — visitors would see a cert mismatch. Two options:

- **Advanced Certificate Manager** (paid, ~$10/mo/zone): dashboard →
  **SSL/TLS → Edge Certificates → Order Advanced Certificate**, hostnames
  `sgtm.<A>` and `*.sgtm.<A>`, validation method **TXT (DNS-01)**. Cloudflare
  provisions the validation TXT records automatically because the zone is on
  Cloudflare DNS; the cert is live in a few minutes. Renewal is automatic.
- **Total TLS (free plan)**: dashboard → **SSL/TLS → Edge Certificates → Total
  TLS**, enable and set the certificate authority. Cloudflare then issues
  covering certs for every hostname that has DNS in the zone, including the
  wildcard, using DNS-01 in the background. Slower to provision than ACM but
  free.

Confirm with `curl -vI https://healthz-check.sgtm.<A>/ 2>&1 | grep -i
subject` — the returned cert's SAN list should include `*.sgtm.<A>`.

### 4. Render the local config

```sh
cp infra/tunnel/sgtm.yml.example infra/tunnel/sgtm.yml
```

Edit `sgtm.yml` and replace:

- `TUNNEL_C_ID` — the UUID from step 1
- `TUNNEL_C_CREDENTIALS` — the absolute path to that tunnel's JSON credential
  file (`~/.cloudflared/<TUNNEL_C_ID>.json`)
- `APEX_A` — the same first apex you used in `shop.yml`

`sgtm.yml` is gitignored (same reason as the other two).

**Do not add `originRequest.httpHostHeader` to this config.** cloudflared
forwards the incoming `Host` header to the origin by default, and sgtm-host
depends on it to identify the tenant — an override would collapse every
subdomain to one tenant.

### 5. Set `SGTM_HOST_APEX` in `.env`

```
SGTM_HOST_APEX=sgtm.<A>
```

The reverse proxy suffix-matches this value to peel `<sub>` off. It must
match the wildcard's parent exactly (no leading `*.` or `.`).

### Adding a second wildcard later

If you want a *second* sGTM apex (e.g. a staging namespace on a different
zone), repeat the four steps for a new tunnel — `trackify-sgtm-staging`,
its own wildcard CNAME on that zone, its own cert — and add a
`sgtm-staging.yml` alongside. `infra/tunnel/run.sh` accepts an override for
each config path via env vars (`SHOP_CONFIG`, `AD_CONFIG`, `SGTM_CONFIG`);
extend it the same way to launch the fourth cloudflared alongside the rest.

---

## Running

```sh
pnpm dev      # start all four apps (storefront:3000, ad-network:3001, console:3002, relay:3003) + sgtm-host:3004
pnpm tunnel   # in a second terminal — starts all three cloudflared tunnels
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
curl -s  https://acme.sgtm.<A>/healthz  # sgtm-host: {"ok":true,"apex":"sgtm.<A>"} — reaches the reverse proxy end-to-end
curl -si https://acme.sgtm.<A>/anything | head -1  # unknown-tenant path → 404 (proves the tunnel is transparent on unknown hosts)
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
match. Same procedure for `trackify-ad`. For `trackify-sgtm`, also update
the `*.sgtm` CNAME target in the Cloudflare dashboard to the new UUID
(cloudflared can't rewrite a wildcard route for you).

Losing `~/.cloudflared/cert.pem` is recoverable — just re-run
`cloudflared tunnel login`.

---

## Postgres

`docker compose up -d` at the repo root brings up Postgres 16 on `:5432` with
the credentials in `.env.example`. Nothing tunnel-related; documented here
because this directory is "dev infra".
