import { redirect } from "next/navigation";

interface Props {
  searchParams: { journey_id?: string };
}

// GET /journey renders a simple input; posting jumps to /journey/<id>.
// A GET with ?journey_id=… (from a form submission) also redirects there so
// the URL is bookmarkable.
export default function JourneyIndex({ searchParams }: Props) {
  const raw = searchParams.journey_id?.trim();
  if (raw) redirect(`/journey/${encodeURIComponent(raw)}`);

  return (
    <main style={{ padding: "1.5rem", maxWidth: 640 }}>
      <h1 style={{ marginTop: 0 }}>Journey view</h1>
      <p style={{ opacity: 0.75, fontSize: 14 }}>
        Enter a <code>journey_id</code> to see all seven hops of the flow
        contract for one visitor.
      </p>
      <form method="get" style={{ display: "flex", gap: 8 }}>
        <input
          name="journey_id"
          placeholder="e.g. tJ4Ku8s7…"
          style={{
            flex: 1,
            background: "#151a20",
            color: "#e4e6eb",
            border: "1px solid #2a323d",
            borderRadius: 6,
            padding: "0.5rem 0.75rem",
            fontSize: 14,
            fontFamily: "monospace",
          }}
        />
        <button
          type="submit"
          style={{
            background: "#3a72ff",
            color: "#fff",
            border: 0,
            borderRadius: 6,
            padding: "0.5rem 1rem",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Open
        </button>
      </form>
    </main>
  );
}
