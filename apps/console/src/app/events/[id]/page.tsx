import Link from "next/link";
import { notFound } from "next/navigation";
import { getEventDetail } from "@/lib/queries";
import { diffAdded } from "@/lib/diff";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

export default async function EventDetailPage({ params }: Props) {
  // UUIDs only — anything else is a 404 (avoids a Postgres invalid-UUID error).
  if (!isUuid(params.id)) notFound();
  const event = await getEventDetail(params.id);
  if (!event) notFound();

  // Approximate the client's original payload: strip the server-added blocks.
  // T13's enricher will land a first-class provenance record; until then this
  // gives a useful "here's what we added" view.
  const inbound: Record<string, unknown> = { ...event.inboundPayload };
  const enrichedBlocks: Record<string, unknown> = {};
  for (const k of ["server", "identity"]) {
    if (k in inbound) {
      enrichedBlocks[k] = inbound[k];
      delete inbound[k];
    }
  }
  const enricherDiff = diffAdded(inbound, event.inboundPayload) ?? {};

  return (
    <main style={{ padding: "1.5rem" }}>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        <Link href="/events">← Events</Link>
        <span style={{ opacity: 0.5, margin: "0 0.5rem" }}>·</span>
        <Link href={`/journey/${encodeURIComponent(event.journeyId)}`}>
          Journey view
        </Link>
      </p>
      <h1 style={{ marginTop: 0 }}>
        {event.name}{" "}
        <span
          style={{
            opacity: 0.5,
            fontWeight: 400,
            fontSize: 14,
            fontFamily: "monospace",
          }}
        >
          {event.eventId}
        </span>
      </h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        ts: {event.ts.toISOString()} · received:{" "}
        {event.receivedAt.toISOString()} · journey: {event.journeyId}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "0.75rem",
          marginTop: "1rem",
        }}
      >
        <Panel title="Inbound payload">
          <Json value={inbound} />
        </Panel>

        <Panel title="Outbound per destination">
          {event.deliveries.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No delivery jobs.</p>
          ) : (
            event.deliveries.map((d) => (
              <section key={d.id} style={{ marginBottom: "0.75rem" }}>
                <header
                  style={{
                    fontSize: 12,
                    opacity: 0.8,
                    marginBottom: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>
                    <b>{d.destinationProvider}</b>{" "}
                    <span style={{ opacity: 0.6 }}>
                      · {d.status} · attempts {d.attempts}
                    </span>
                  </span>
                </header>
                <Json value={d.outboundPayload ?? null} />
              </section>
            ))
          )}
        </Panel>

        <Panel title="Upstream response">
          {event.deliveries.length === 0 ? (
            <p style={{ opacity: 0.6 }}>No delivery jobs.</p>
          ) : (
            event.deliveries.map((d) => (
              <section key={d.id} style={{ marginBottom: "0.75rem" }}>
                <header style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                  <b>{d.destinationProvider}</b>
                </header>
                {d.status === "done" ? (
                  <p style={{ color: "#8fe0a5", fontSize: 12 }}>
                    ✓ delivered at{" "}
                    {d.completedAt ? d.completedAt.toISOString() : "?"}
                  </p>
                ) : d.lastError ? (
                  <pre style={preErr}>{d.lastError}</pre>
                ) : (
                  <p style={{ opacity: 0.6, fontSize: 12 }}>
                    no upstream response yet
                  </p>
                )}
              </section>
            ))
          )}
        </Panel>
      </div>

      <Panel title="Fields added by the enricher (server + identity)">
        <p style={{ opacity: 0.6, fontSize: 12, marginTop: 0 }}>
          T13 will replace this with a first-class provenance record. For now
          we surface the two blocks (<code>server</code>, <code>identity</code>)
          that ingest attaches after receiving the client payload.
        </p>
        <Json value={enricherDiff} />
      </Panel>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#0f1318",
        border: "1px solid #1e242c",
        borderRadius: 8,
        padding: "0.75rem 1rem",
        marginTop: "1rem",
      }}
    >
      <h2 style={{ marginTop: 0, fontSize: 13, opacity: 0.85 }}>{title}</h2>
      {children}
    </section>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "0.5rem 0.75rem",
        background: "#0b0d10",
        border: "1px solid #1e242c",
        borderRadius: 6,
        overflow: "auto",
        maxHeight: 420,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const preErr: React.CSSProperties = {
  margin: 0,
  padding: "0.5rem 0.75rem",
  background: "#2b1618",
  border: "1px solid #5a2d2d",
  color: "#ff9b9b",
  borderRadius: 6,
  fontSize: 12,
  overflow: "auto",
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
