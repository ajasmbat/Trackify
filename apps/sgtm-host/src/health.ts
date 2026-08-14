import http from "node:http";

// Polls the sGTM container's own `/healthy` endpoint via loopback. Google's
// server-side tag manager image serves 200 there once the container's inner
// Go server has bound its socket and loaded its container config.

export interface HealthCheckOptions {
  hostPort: number;
  totalTimeoutMs: number;
  intervalMs: number;
  path?: string;
  fetch?: (url: string) => Promise<{ status: number }>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HealthCheckResult {
  ok: boolean;
  attempts: number;
  lastStatus?: number;
  lastError?: string;
}

const defaultFetch = async (url: string): Promise<{ status: number }> =>
  await new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      // We only care about the status line. Drain and discard the body so the
      // socket can be kept alive by the agent for the next probe.
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on("error", reject);
    req.setTimeout(2_000, () => {
      req.destroy(new Error("health probe timeout"));
    });
  });

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function waitForHealthy(
  opts: HealthCheckOptions,
): Promise<HealthCheckResult> {
  const {
    hostPort,
    totalTimeoutMs,
    intervalMs,
    path = "/healthy",
    fetch = defaultFetch,
    now = Date.now,
    sleep = defaultSleep,
  } = opts;
  const deadline = now() + totalTimeoutMs;
  const url = `http://127.0.0.1:${hostPort}${path}`;
  let attempts = 0;
  let lastStatus: number | undefined;
  let lastError: string | undefined;
  while (now() < deadline) {
    attempts += 1;
    try {
      const res = await fetch(url);
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, attempts, lastStatus };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (now() >= deadline) break;
    await sleep(intervalMs);
  }
  return { ok: false, attempts, lastStatus, lastError };
}
