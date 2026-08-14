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
