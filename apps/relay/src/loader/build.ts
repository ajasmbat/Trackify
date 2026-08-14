import {
  SLOT_TENANT_ID,
  SLOT_HOST,
  SLOT_EP,
  SLOT_JID_COOKIE,
  SLOT_VID_COOKIE,
  TEMPLATE,
} from "./template";

// Assemble the per-tenant snippet from the template + values plucked off the
// resolved tenant. Kept as a pure function so route.ts is a thin adapter and
// tests can feed synthetic tenants in without spinning up Fastify.

export interface LoaderBuildInput {
  tenantId: string;
  /**
   * Origin of the relay from the browser's point of view — the snippet posts
   * events back to `${host}/<endpoint>`. Trailing slashes are stripped so the
   * assembled URL doesn't get a double slash.
   */
  host: string;
  /**
   * Cookie names the snippet reads/writes for journey + visitor continuity.
   * Falls back to the T8 client defaults when the caller doesn't override
   * them (T12 will lock these down).
   */
  journeyCookie?: string;
  visitorCookie?: string;
  /**
   * The one-character ingest endpoint — the snippet joins it to `host` at
   * call time so the literal `/e` never appears in the source.
   */
  endpoint?: string;
}

export const DEFAULT_JOURNEY_COOKIE = "tf_jid";
export const DEFAULT_VISITOR_COOKIE = "tf_vid";
export const DEFAULT_ENDPOINT = "e";

export function buildSnippet(input: LoaderBuildInput): string {
  const host = input.host.replace(/\/+$/, "");
  const jc = input.journeyCookie ?? DEFAULT_JOURNEY_COOKIE;
  const vc = input.visitorCookie ?? DEFAULT_VISITOR_COOKIE;
  const ep = input.endpoint ?? DEFAULT_ENDPOINT;

  return minify(
    TEMPLATE.replace(quotedSlot(SLOT_TENANT_ID), JSON.stringify(input.tenantId))
      .replace(quotedSlot(SLOT_HOST), JSON.stringify(host))
      .replace(quotedSlot(SLOT_EP), JSON.stringify(ep))
      .replace(quotedSlot(SLOT_JID_COOKIE), JSON.stringify(jc))
      .replace(quotedSlot(SLOT_VID_COOKIE), JSON.stringify(vc)),
  );
}

function quotedSlot(slot: string): string {
  // The template literal encodes slots as `JSON.stringify(SLOT)` which yields
  // a double-quoted string; substitute the whole quoted form so the tokens
  // never survive into the emitted bytes even if a value happens to contain
  // the slot text.
  return JSON.stringify(slot);
}

// Micro-minifier: collapse leading whitespace on each line and drop
// single-line `//` comments. Deliberately naive — full minification isn't
// the point here; we keep the source small and free of literal signal a
// filter list can pattern-match. Newlines survive so ASI hazards from
// concatenating expression-form statements never bite us.
function minify(src: string): string {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    const trimmed = rawLine.replace(/^\s+/, "");
    if (!trimmed) continue;
    if (trimmed.startsWith("//")) continue;
    out.push(trimmed);
  }
  return out.join("\n");
}
