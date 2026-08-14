// Thin, mockable HTTP wrapper. Tests inject their own client; production uses
// the default `fetch` implementation. Everything above this file works in terms
// of `MetaHttpClient` — no direct `fetch` calls anywhere else in the adapter.

export interface MetaHttpResponse {
  status: number;
  body: unknown;
}

export interface MetaHttpRequest {
  url: string;
  body: unknown;
}

export type MetaHttpClient = (
  req: MetaHttpRequest,
) => Promise<MetaHttpResponse>;

/**
 * Thrown when the network call itself failed — DNS, TCP, TLS, abort. Consumers
 * treat this as a transient failure (see response.ts). Anything with an HTTP
 * status is returned via MetaHttpResponse instead.
 */
export class MetaHttpNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MetaHttpNetworkError";
  }
}

export const defaultMetaHttpClient: MetaHttpClient = async ({ url, body }) => {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new MetaHttpNetworkError(
      err instanceof Error ? err.message : "network error",
      { cause: err },
    );
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  return { status: res.status, body: parsed };
};
