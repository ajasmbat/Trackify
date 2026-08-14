import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Enforce the ticket's constraint: the queue MUST NOT import any specific
// destination adapter. Adapters are handed in through DestinationRegistry at
// app boot — the queue routes to them by string provider only.
//
// A grep-style test is deliberately simple: the second it stops matching a
// real import, refactor the pattern rather than the rule.

const QUEUE_DIR = join(__dirname);

const FORBIDDEN_PATTERNS = [
  /from\s+["']\.\.\/modules\/destinations\/meta/,
  /from\s+["']@trackify\/relay\/modules\/destinations\/meta/,
  /require\(\s*["']\.\.\/modules\/destinations\/meta/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

describe("queue boundary", () => {
  it("no file under apps/relay/src/queue/** imports the Meta adapter", () => {
    const offenders: Array<{ file: string; line: string }> = [];
    for (const file of walk(QUEUE_DIR)) {
      // The boundary test itself contains the patterns as literal strings.
      if (file === __filename) continue;
      const text = readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (FORBIDDEN_PATTERNS.some((p) => p.test(line))) {
          offenders.push({ file, line: line.trim() });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
