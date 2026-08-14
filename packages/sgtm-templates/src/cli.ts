#!/usr/bin/env node
import { render, type RenderInput } from "./render";

// CLI shape:
//   pnpm --filter @trackify/sgtm-templates render \
//     --gtm-container-id GTM-ABCDE12 \
//     --pixel-id 111111111111111 \
//     --access-token TEST \
//     [--test-event-code TEST42] \
//     [--ga4-measurement-id G-XXXX --ga4-api-secret SECRET] \
//     [--format base64|json|env]
//
// Default output is a bare base64 string on stdout so the caller can pipe it
// straight into `docker run -e CONTAINER_CONFIG=$(...)`. `--format env` prints
// `CONTAINER_CONFIG=<base64>` for docker-compose `.env` files; `--format json`
// prints the pretty JSON for eyeballing.

type ArgMap = Record<string, string>;

function parseArgs(argv: readonly string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw || !raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(args: ArgMap, key: string): string {
  const v = args[key];
  if (!v) {
    process.stderr.write(`missing required --${key}\n`);
    process.exit(2);
  }
  return v;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args["help"] || args["h"]) {
    process.stdout.write(
      "Usage: sgtm-render --gtm-container-id GTM-XXX --pixel-id N --access-token TOK [--test-event-code X] [--ga4-measurement-id G-X --ga4-api-secret S] [--format base64|json|env]\n",
    );
    return;
  }

  const input: RenderInput = {
    gtmContainerId: required(args, "gtm-container-id"),
    meta: {
      pixelId: required(args, "pixel-id"),
      accessToken: required(args, "access-token"),
      ...(args["test-event-code"]
        ? { testEventCode: args["test-event-code"] }
        : {}),
    },
    ...(args["ga4-measurement-id"] && args["ga4-api-secret"]
      ? {
          ga4: {
            measurementId: args["ga4-measurement-id"],
            apiSecret: args["ga4-api-secret"],
          },
        }
      : {}),
  };

  const result = render(input);
  const format = args["format"] ?? "base64";
  switch (format) {
    case "base64":
      process.stdout.write(result.base64 + "\n");
      return;
    case "json":
      process.stdout.write(JSON.stringify(result.config, null, 2) + "\n");
      return;
    case "env":
      process.stdout.write(`CONTAINER_CONFIG=${result.base64}\n`);
      return;
    default:
      process.stderr.write(`unknown --format ${format}\n`);
      process.exit(2);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(
    `sgtm-render failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
