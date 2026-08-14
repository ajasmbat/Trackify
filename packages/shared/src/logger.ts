import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger, type LoggerOptions } from "pino";

// Structured JSON logging to stdout. Every log line carries `request_id`; when
// the current request also has a `journey_id`, it appears on every line for
// that request. Enforced via AsyncLocalStorage — no per-call plumbing.
//
// Docker's log driver takes care of transport. We never write to files.

export interface RequestLogContext {
  // request_id is optional so callers whose framework already binds it (e.g.
  // Fastify's per-request child logger via `requestIdLogLabel`) can leave it
  // out — otherwise pino would emit the key twice on every log line.
  request_id?: string;
  journey_id?: string;
  tenant_id?: string;
  [key: string]: unknown;
}

const als = new AsyncLocalStorage<RequestLogContext>();

/**
 * The pino LoggerOptions every app uses. Exported so Fastify (which accepts
 * pino options directly) creates an instance with the SAME formatter — that
 * way Fastify's own request/response log lines pick up request_id + journey_id
 * from ALS just like our app-level logger does.
 */
export function pinoOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      level(label) {
        return { level: label };
      },
      log(obj) {
        const ctx = als.getStore();
        if (!ctx) return obj;
        // Merge ALS context, but never overwrite a key the log already has —
        // Fastify's per-request child logger already adds request_id via
        // requestIdLogLabel; letting ALS re-add it would emit the key twice.
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(ctx)) {
          if (v !== undefined && !(k in obj)) out[k] = v;
        }
        return { ...out, ...obj };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

const base = pino(pinoOptions());

export function logger(): Logger {
  return base;
}

export function withRequestContext<T>(
  ctx: RequestLogContext,
  fn: () => T,
): T {
  return als.run(ctx, fn);
}

export function currentRequestContext(): RequestLogContext | undefined {
  return als.getStore();
}

/** Merge extra fields into the CURRENT request context in place (e.g. tenant_id resolved mid-request). */
export function updateRequestContext(patch: Partial<RequestLogContext>): void {
  const ctx = als.getStore();
  if (!ctx) return;
  Object.assign(ctx, patch);
}
