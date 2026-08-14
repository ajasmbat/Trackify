import Link from "next/link";
import { currentTenant } from "@/lib/tenant";
import { listJourneyEvents } from "@/lib/queries";
import { evaluateJourney } from "@/lib/flow-contract";

export const dynamic = "force-dynamic";

interface Props {
  params: { journey_id: string };
}

export default async function JourneyPage({ params }: Props) {
  const journeyId = decodeURIComponent(params.journey_id);
  const { active } = await currentTenant();
  if (!active) {
    return (
      <main style={{ padding: "1.5rem" }}>
        <h1>Journey</h1>
        <p>No tenant. Run <code>pnpm seed</code>.</p>
      </main>
    );
  }

  const events = await listJourneyEvents(active.id, journeyId);
  const rows = evaluateJourney(events);

  return (
    <main style={{ padding: "1.5rem" }}>
      <p style={{ marginTop: 0, fontSize: 13 }}>
        <Link href="/journey">← Journey lookup</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>
        Journey{" "}
        <span style={{ fontFamily: "monospace", opacity: 0.7, fontSize: 16 }}>
          {journeyId}
        </span>
      </h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        tenant: <b>{active.name}</b> · events: <b>{events.length}</b>
      </p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
          marginTop: "1rem",
        }}
      >
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th style={th}>Hop</th>
            <th style={th}>Name</th>
            <th style={th}>Status</th>
            <th style={th}>Expected</th>
            <th style={th}>Observed</th>
            <th style={th}>Events</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const style = ROW_STYLE[row.result.severity][row.result.ok ? "ok" : "bad"];
            return (
              <tr
                key={row.hop}
                style={{ borderTop: "1px solid #1e242c", ...style.row }}
              >
                <td style={{ ...td, fontWeight: 700, fontSize: 15 }}>{row.hop}</td>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{row.name}</div>
                  <div style={{ opacity: 0.65, fontSize: 12, marginTop: 2 }}>
                    {row.description}
                  </div>
                </td>
                <td style={td}>
                  <span style={{ ...pill, ...style.pill }}>
                    {row.result.ok ? "✓ ok" : "✗ missing"}
                  </span>
                </td>
                <td style={td}>{row.result.expected}</td>
                <td style={{ ...td, ...style.observed }}>{row.result.observed}</td>
                <td style={td}>
                  {row.result.supportingEventIds.length === 0 ? (
                    <span style={{ opacity: 0.5 }}>—</span>
                  ) : (
                    row.result.supportingEventIds.map((id) => (
                      <Link
                        key={id}
                        href={`/events/${id}`}
                        style={{
                          display: "inline-block",
                          marginRight: 6,
                          fontFamily: "monospace",
                          fontSize: 12,
                        }}
                      >
                        {id.slice(0, 8)}
                      </Link>
                    ))
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section
        style={{
          background: "#0f1318",
          border: "1px solid #1e242c",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginTop: "1.5rem",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 13, opacity: 0.85 }}>
          All events in this journey ({events.length})
        </h2>
        {events.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No events for this journey_id yet.</p>
        ) : (
          <ol style={{ marginTop: 0 }}>
            {events.map((e) => (
              <li key={e.id} style={{ marginBottom: 4 }}>
                <Link href={`/events/${e.id}`}>{e.name}</Link>{" "}
                <span style={{ opacity: 0.55, fontSize: 12 }}>
                  · {e.ts.toISOString()}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

const th: React.CSSProperties = { padding: "0.5rem 0.6rem", fontWeight: 500 };
const td: React.CSSProperties = { padding: "0.7rem 0.6rem", verticalAlign: "top" };
const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
};

// The tone of each row keys off severity + pass/fail. "error" + fail is the
// RED that the ticket specifically calls out for hops 5 and 6.
const ROW_STYLE = {
  info: {
    ok: {
      row: { background: "transparent" },
      pill: { background: "#264a2d", color: "#8fe0a5" },
      observed: {},
    },
    bad: {
      row: { background: "transparent" },
      pill: { background: "#3a3f4a", color: "#e4e6eb" },
      observed: {},
    },
  },
  warn: {
    ok: {
      row: { background: "transparent" },
      pill: { background: "#264a2d", color: "#8fe0a5" },
      observed: {},
    },
    bad: {
      row: { background: "#3a2f18" },
      pill: { background: "#5a4a2d", color: "#ffd591" },
      observed: { color: "#ffd591" },
    },
  },
  error: {
    ok: {
      row: { background: "transparent" },
      pill: { background: "#264a2d", color: "#8fe0a5" },
      observed: {},
    },
    bad: {
      row: { background: "#2b1618" },
      pill: { background: "#5a2d2d", color: "#ff9b9b" },
      observed: { color: "#ff9b9b", fontWeight: 600 },
    },
  },
} as const;
