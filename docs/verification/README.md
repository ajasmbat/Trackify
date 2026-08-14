# Live Meta verification runbook (T14)

Once through this runbook in about 15 minutes. The goal is to prove — with a
screenshot from Meta Events Manager — that ONE real Purchase lands in the
pixel from BOTH the browser (T8 client) and the server (T6 CAPI adapter),
that Meta counts the pair as one, and that Event Match Quality clears 6.

If it counts twice, STOP and fix the `event_id` alignment (see the
[Dedup contract](#dedup-contract) at the bottom) before continuing. This is
the bug that silently doubles customer numbers for weeks.

## Prerequisites

1. **Cloudflare tunnels are up** on two apex domains (see
   [`infra/README.md`](../../infra/README.md)) — `shop.<A>`, `data.<A>`,
   `ads.<B>`. Real HTTPS is non-negotiable for cookies to behave.
2. **`.env` is filled** — every key in `.env.example`, including
   `CREDENTIAL_KEY_HEX` and the three `*_URL` vars.
3. **A dedicated Meta test pixel.** Create one under
   [Events Manager → Connect data sources → Web](https://www.facebook.com/events_manager/). **Never** wire a
   production customer pixel here.
4. **A CAPI access token** for that pixel. Events Manager →
   Data Sources → your pixel → Settings → *Generate Access Token*.
5. **A Test Events Code** for that pixel. Events Manager → Test Events →
   *Test Events Code*. Copy the string — you'll need it below.

## Step 1 — Fill Meta credentials in `.env`

Open the T14 block near the bottom of `.env.example`, then set the same
keys in your local `.env`:

```env
META_PIXEL_ID=1234567890123456
META_ACCESS_TOKEN=EAABsbCS…                    # keep secret; never commit
META_TEST_EVENT_CODE=TEST12345                  # for the first run only
META_SETUP_TENANT_SLUG=acme                     # matches one of the seeded tenants
```

Then push them into the seeded tenant's `destinations` row:

```sh
docker compose up -d          # Postgres
pnpm db:push && pnpm seed     # baseline schema + seed tenants (only if fresh)
pnpm setup:meta               # writes META_* into destinations for META_SETUP_TENANT_SLUG
```

You should see a log line `updated meta destination with live credentials` with
`mode: "TEST"` (because `META_TEST_EVENT_CODE` is set).

Sanity check the row landed:

```sh
docker compose exec -T postgres \
  psql -U trackify -d trackify -c \
  "SELECT provider, config, length(credentials_encrypted) AS len \
   FROM destinations WHERE provider='meta';"
```

Expect one row with `provider = meta`, `config` containing your pixel id, and
`credentials_encrypted` a non-zero length base64 string.

## Step 2 — Also set the browser pixel

The browser sends the SAME pixel id through T8's client. Set it in
`apps/storefront/.env.local`:

```env
NEXT_PUBLIC_META_PIXEL_ID=1234567890123456
```

(Same value as `META_PIXEL_ID`. Different env because Next.js inlines
`NEXT_PUBLIC_*` at build time.)

## Step 3 — Boot everything

Two terminals:

```sh
# Terminal A — tunnels
pnpm tunnel

# Terminal B — apps
pnpm dev
```

Wait for all four apps to log a `listening` line. Confirm the relay is
reachable:

```sh
curl -sf https://data.<A>/healthz | jq .
# → {"ok": true}
```

### Verify the boot warning wiring (production mode)

The relay logs `meta_test_event_in_prod` at startup when
`NODE_ENV=production` **and** any Meta destination has a `test_event_code`
set. Do a quick smoke run in production mode to prove the guardrail fires:

```sh
NODE_ENV=production pnpm --filter @trackify/relay dev 2>&1 | \
  head -80 | grep '"code":"meta_test_event_in_prod"'
```

Expect exactly one match (one Meta destination, `test_event_code` set).
Ctrl-C, drop back to `NODE_ENV=development`, restart with `pnpm dev` for
the rest of the runbook.

## Step 4 — Drive the journey

Open a fresh browser window (no extensions, no adblock — you want the T8
pixel to actually load; T11's ad-blocker resilience gets tested elsewhere):

1. `https://ads.<B>/` — the fake ad network. Click the ad.
2. Land on `https://shop.<A>/?fbclid=IwAR…`. Note the `fbclid` — it must be
   there.
3. Click a product. `view_item` fires.
4. Add to cart. `add_to_cart` fires.
5. Checkout with **real-looking** email + phone (e.g.
   `qa+trackify@yourdomain.dev`, `+14155550142`).
6. Complete purchase. `purchase` fires.

Watch the storefront devtools Network tab. You should see:

- One `POST /e` per event to `data.<A>` (the T8 client + the T11 loader).
- One request per event to `https://www.facebook.com/tr/?…` (Meta's browser
  pixel).

Watch the relay logs (terminal B). For every ingested event you should see:

```
"incoming request" method:POST url:/e
"delivery ok"    provider:meta
```

## Step 5 — Confirm in Events Manager (TEST mode)

Open [Events Manager](https://www.facebook.com/events_manager/) → your
pixel → **Test Events** tab (Test Events matches your `META_TEST_EVENT_CODE`
and shows events immediately; the live Overview has a 20-minute delay).

You should see the full journey stream in: `PageView`, `ViewContent`,
`AddToCart`, `InitiateCheckout`, **`Purchase`**.

Click the `Purchase` event. In the panel:

- **Received from**: expect both `Browser` and `Server` rows.
- **Event ID**: expect the SAME `event_id` on both rows. If they differ,
  Meta will count twice — stop, see [Dedup contract](#dedup-contract).
- **Deduplicated**: expect ✓. Meta shows a "Received from 2 sources,
  Deduplicated" pill next to the count.
- **User data**: expand it and verify hashed `em`, `ph`, `fbc`, `fbp`,
  `client_ip_address`, `client_user_agent` are all present. That is what
  gets Event Match Quality > 6.

Screenshot the panel three times and drop into `docs/verification/`:

- `purchase-received.png` — full event card showing both `Browser` + `Server`.
- `purchase-deduplicated.png` — the Deduplicated pill visible.
- `event-match-quality.png` — the score bar reading > 6 (Meta labels this
  "Good" or "Great" depending on your account UI vintage).

Each screenshot MUST show the exact `event_id` matching. Crop tightly.

## Step 6 — Rerun in LIVE mode (final verification)

Once TEST mode is clean, drop `META_TEST_EVENT_CODE` from `.env`, re-run
`pnpm setup:meta` (it'll update the row and log `mode: "LIVE"`), then
repeat the journey. In Events Manager, watch the **Overview** tab — the
purchase will surface after ~20 minutes. Re-screenshot the Purchase event
card to confirm the same dedup pill in live mode. Save alongside the TEST
screenshots (append `-live` to the filename if you keep both).

Do NOT commit the access token, do NOT commit `.env`.

## Dedup contract

The four pieces of the flow that MUST agree so Meta counts one purchase:

1. **T8 pixel** on the storefront fires `fbq('track', 'Purchase', props,
   { eventID: <event_id> })`.
2. **T4 ingest** persists the same `event_id` on the CanonicalEvent.
3. **T5 delivery worker** hands that CanonicalEvent to the T6 adapter.
4. **T6 Meta payload builder** puts the same value into
   `data[0].event_id`.

Meta then joins on `(pixel_id, event_name, event_id, event_time ±60s)` and
counts one conversion. If your Events Manager shows two rows with different
`event_id`s, one of those four steps is generating a fresh id — start with
the browser (`eventID` on the `fbq` call) and walk down.
