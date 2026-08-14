import type { CanonicalEvent, Destination, SendResult } from "@trackify/shared";

// Test-only Destination — the queue tests script per-tenant outcomes so we can
// assert retry classification without ever importing a real adapter. Real
// adapters (Meta) are wired at server boot; the queue MUST NOT depend on any
// specific adapter, and this file is the only Destination the queue owns.

export type FakeScript =
  | { kind: "ok" }
  | { kind: "transient"; status?: number; reason?: string }
  | { kind: "permanent"; status?: number; reason?: string }
  | { kind: "throw"; message?: string }
  | {
      // "sequence": for retry tests — pop one entry per call, then use the last
      // entry forever.
      kind: "sequence";
      steps: FakeScript[];
    };

export class FakeDestination implements Destination {
  readonly provider = "fake";
  readonly calls: Array<{ event: CanonicalEvent; credentials: Record<string, string> }> = [];
  private scripts = new Map<string, FakeScript>();
  private sequenceCursors = new Map<string, number>();

  script(tenantId: string, script: FakeScript): void {
    this.scripts.set(tenantId, script);
    this.sequenceCursors.set(tenantId, 0);
  }

  async send(
    event: CanonicalEvent,
    credentials: Record<string, string>,
  ): Promise<SendResult> {
    this.calls.push({ event, credentials });
    const script = this.scripts.get(event.tenant_id) ?? { kind: "ok" };
    const step = this.nextStep(event.tenant_id, script);
    const outbound_payload = {
      provider: this.provider,
      event_id: event.event_id,
      name: event.name,
    };
    switch (step.kind) {
      case "ok":
        return {
          kind: "ok",
          provider_message_id: `fake-${event.event_id}`,
          outbound_payload,
        };
      case "transient":
        return {
          kind: "transient_failure",
          reason: step.reason ?? "transient",
          status: step.status,
          outbound_payload,
        };
      case "permanent":
        return {
          kind: "permanent_failure",
          reason: step.reason ?? "permanent",
          status: step.status,
          outbound_payload,
        };
      case "throw":
        throw new Error(step.message ?? "fake destination threw");
    }
  }

  private nextStep(tenantId: string, script: FakeScript): Exclude<FakeScript, { kind: "sequence" }> {
    if (script.kind !== "sequence") return script;
    const idx = this.sequenceCursors.get(tenantId) ?? 0;
    const step = script.steps[Math.min(idx, script.steps.length - 1)];
    this.sequenceCursors.set(tenantId, idx + 1);
    if (!step) throw new Error(`empty sequence script for tenant ${tenantId}`);
    if (step.kind === "sequence") throw new Error("nested sequence scripts are not supported");
    return step;
  }
}
