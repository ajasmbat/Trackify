import { z } from "zod";
import { CanonicalEvent } from "./events";

// Wire shapes for the relay's public ingest endpoint (POST /e).
// The relay's route handler (T4) plugs these in verbatim — never re-invented.

export const IngestRequest = z
  .object({
    events: z.array(CanonicalEvent).min(1).max(100),
  })
  .strict();
export type IngestRequest = z.infer<typeof IngestRequest>;

export const IngestResponse = z
  .object({
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    // Per-event outcomes in the same order as the request.
    results: z.array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("ok"),
          event_id: z.string().uuid(),
        }),
        z.object({
          kind: z.literal("rejected"),
          event_id: z.string().uuid().optional(),
          reason: z.string(),
        }),
      ]),
    ),
  })
  .strict();
export type IngestResponse = z.infer<typeof IngestResponse>;
