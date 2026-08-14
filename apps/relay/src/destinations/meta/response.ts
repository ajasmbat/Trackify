import type { SendResult } from "@trackify/shared";
import type { MetaHttpResponse } from "./http";
import { MetaHttpNetworkError } from "./http";

// Map a Meta HTTP response — or a thrown network error — onto SendResult.
//
// 2xx           → ok (carry provider_message_id if Meta returned one)
// 429, 5xx      → transient_failure (retry)
// network error → transient_failure (retry)
// other 4xx     → permanent_failure with Meta's error.message captured
//
// `outbound_payload` is stapled on by the caller in index.ts — this module
// only produces the classification.

interface MetaSuccessBody {
  events_received?: number;
  fbtrace_id?: string;
  messages?: string[];
}

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    error_user_msg?: string;
  };
}

export function mapMetaResponse(
  res: MetaHttpResponse,
  outboundPayload: unknown,
): SendResult {
  const { status } = res;

  if (status >= 200 && status < 300) {
    const body = (res.body ?? {}) as MetaSuccessBody;
    return {
      kind: "ok",
      provider_message_id: body.fbtrace_id,
      outbound_payload: outboundPayload,
    };
  }

  const errorMessage = extractErrorMessage(res.body);

  if (status === 429 || (status >= 500 && status < 600)) {
    return {
      kind: "transient_failure",
      reason: errorMessage ?? `http_${status}`,
      status,
      outbound_payload: outboundPayload,
    };
  }

  return {
    kind: "permanent_failure",
    reason: errorMessage ?? `http_${status}`,
    status,
    outbound_payload: outboundPayload,
  };
}

export function mapMetaThrown(
  err: unknown,
  outboundPayload: unknown,
): SendResult {
  if (err instanceof MetaHttpNetworkError) {
    return {
      kind: "transient_failure",
      reason: err.message || "network_error",
      outbound_payload: outboundPayload,
    };
  }
  // Anything else is a bug inside our adapter — surface as permanent so retry
  // does not thrash. The queue will log it.
  const message = err instanceof Error ? err.message : "unknown_error";
  return {
    kind: "permanent_failure",
    reason: message,
    outbound_payload: outboundPayload,
  };
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const err = (body as MetaErrorBody).error;
  if (!err) return undefined;
  return err.error_user_msg ?? err.message;
}
