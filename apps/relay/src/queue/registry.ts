import type { Destination } from "@trackify/shared";

// A tiny provider→Destination lookup. Kept as a plain map so tests can inject a
// FakeDestination without any DI framework, and production wires real adapters
// from server boot (see apps/relay/src/server.ts).
//
// The queue MUST reach adapters only through this registry — it must never
// import a specific adapter itself. That is enforced by the boundary lint
// test in queue/registry.test.ts (and by module review).

export class DestinationRegistry {
  private readonly byProvider = new Map<string, Destination>();

  register(destination: Destination): void {
    this.byProvider.set(destination.provider, destination);
  }

  get(provider: string): Destination | undefined {
    return this.byProvider.get(provider);
  }

  has(provider: string): boolean {
    return this.byProvider.has(provider);
  }

  clear(): void {
    this.byProvider.clear();
  }
}
