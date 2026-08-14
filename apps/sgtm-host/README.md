# @trackify/sgtm-host

Per-tenant Google **server-side Google Tag Manager** container host.

Two responsibilities in one Fastify service:

1. **Provisioning API** (`/internal/*`) — start, stop, and status-check the
   `gcr.io/cloud-tagging-10302018/server` container per tenant. Rows in
   `sgtm_containers` are the shared source of truth between this app and the
   T19 console UI.
2. **Streaming reverse proxy** (`/*`) — routes incoming
   `<subdomain>.sgtm.<apex>` requests to the correct container's loopback
   port, streaming both request and response so `gtm.js` (>200KB) reaches
   the browser without buffering.

## Endpoints

| Method | Path                          | Purpose                                              |
| ------ | ----------------------------- | ---------------------------------------------------- |
| GET    | `/healthz`                    | Liveness — returns `{ok:true, apex}`.                |
| POST   | `/internal/containers`        | Provision a container. Body: `{tenantId, gtmContainerId, containerConfig, subdomain, previewServerUrl?}`. Returns `201` + the DB row once healthy. |
| GET    | `/internal/containers/:id`    | Current status. Polls Docker to flip `error` on crashes. |
| DELETE | `/internal/containers/:id`    | Stop + remove container, mark `status=stopped`.      |
| `*`    | `*` (Host-matched)            | Streams to the container matched by request Host.    |

## Env

See `.env.example` for the full list. Required:

- `SGTM_HOST_PORT` — Fastify listen port (default `3004`).
- `SGTM_HOST_APEX` — wildcard apex, e.g. `sgtm.example.dev`.
- `SGTM_HOST_DOCKER` — `docker` (default) or `mock` (for CI/tests).
- `SGTM_HOST_IMAGE` — Google's sGTM image; pin to a digest in prod.
- `DATABASE_URL` — same Postgres the rest of the stack uses.
- `SGTM_GEO_BACKEND` — `cloudflare` (default), `maxmind`, or `off` (T22).
- `SGTM_MAXMIND_DB_PATH` — path to a GeoLite2-City `.mmdb`. Required only
  when `SGTM_GEO_BACKEND=maxmind`.

## GEO enrichment (T22)

Every proxied request is augmented with request-scoped
`X-Geo-Country` / `X-Geo-Region` / `X-Geo-City` / `X-Geo-Postal` headers so
the container's GTM tags can read them as variables. Missing fields are
omitted (never sent as `""`). Two backends:

- **`cloudflare`** (default): reads `CF-IPCountry`, `CF-Region-Code`
  (fallback `CF-Region`), `CF-IPCity`, `CF-Postal-Code` — headers Cloudflare
  already stamps when the *"Add visitor location headers"* managed transform
  is enabled. Zero-config in the T18 tunnel setup. Sentinel values (`XX`,
  `T1`) are dropped rather than forwarded.
- **`maxmind`**: loads a local GeoLite2-City DB once at startup (60MB+;
  memory-mapped, synchronous `get`), then looks up the request's client IP.
  IP is taken from `CF-Connecting-IP`, else the first hop of
  `X-Forwarded-For`, else the raw socket peer.
- **`off`**: no enrichment. Still strips inbound `X-Geo-*` — the browser is
  never trusted to set these.

Per-container opt-out: the `sgtm_containers.geo_headers_enabled` column
defaults to `true`. Flip it to `false` on a specific container to skip
injection (the strip still runs, so a forged inbound header cannot leak
through). Backend selection is process-wide; per-container backend is a
Wave 7+ follow-up.

### Acquiring the MaxMind DB

MaxMind's free GeoLite2 databases require a (free) license key from
maxmind.com and are redistributable with attribution:

```
curl -L -u<ACCOUNT>:<MAXMIND_LICENSE_KEY> \
  "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&suffix=tar.gz" \
  | tar xz --strip-components=1 -C /var/lib/maxmind
export SGTM_MAXMIND_DB_PATH=/var/lib/maxmind/GeoLite2-City.mmdb
```

Trackify does **not** ship the DB — ops downloads it and points at the file.

## Docker client choice

This app **shells out to the `docker` CLI** rather than depending on
`dockerode`. Rationale: zero deps (no `ssh2`, no native modules to build in
CI), and every verb we need (`run`, `inspect`, `rm`) is one CLI invocation.
The `DockerClient` interface in `src/docker.ts` abstracts the shell-out
behind the same surface as the in-memory `MockDockerClient`, so swapping
implementations later is a one-file change.

## Security / auth boundary

**`/internal/*` has NO authentication in Wave 5.** Bind this app to a
private interface (loopback or a trusted overlay) and let the T19 console
call it directly. The reverse proxy `/*` is the only surface intended for
public exposure through Cloudflare (T18). Filing this ticket for the auth
layer is a Wave 6+ follow-up.
