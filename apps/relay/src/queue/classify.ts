import type { SendResult } from "@trackify/shared";

// Classify the outcome of one destination send. The Destination adapter has
// already made the HTTP call and mapped its response to a SendResult kind, so
// the queue never touches raw HTTP — that boundary is why the retry rules can
// be stated as tiny match on `kind`.
//
// Contract with adapters (this ticket's plan):
//   - `2xx`                        → `ok`               → done
//   - `429` / `5xx` / network      → `transient_failure` → retry
//   - other `4xx`                  → `permanent_failure` → dead-letter (never retry)
//
// If an adapter throws (a bug or an unexpected exception), the worker wraps it
// as a `transient_failure` before calling into here — better to retry a
// possibly-transient adapter bug than to drop a conversion silently.

export type Outcome = "done" | "retry" | "permanent";

export interface Classification {
  outcome: Outcome;
  reason?: string;
  status?: number;
}

export function classify(result: SendResult): Classification {
  switch (result.kind) {
    case "ok":
      return { outcome: "done" };
    case "transient_failure":
      return {
        outcome: "retry",
        reason: result.reason,
        status: result.status,
      };
    case "permanent_failure":
      return {
        outcome: "permanent",
        reason: result.reason,
        status: result.status,
      };
  }
}
