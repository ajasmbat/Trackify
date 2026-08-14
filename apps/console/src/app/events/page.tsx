import { EVENT_NAMES } from "@trackify/shared";
import { currentTenant } from "@/lib/tenant";
import { listEvents, type EventStatus } from "@/lib/queries";
import { EventsTable } from "./EventsTable";

export const dynamic = "force-dynamic";

const STATUSES: EventStatus[] = [
  "pending",
  "in_flight",
  "retrying",
  "done",
  "dead_letter",
];

interface Props {
  searchParams: {
    name?: string;
    status?: string;
    from?: string;
    until?: string;
  };
}

export default async function EventsPage({ searchParams }: Props) {
  const { active } = await currentTenant();
  if (!active) {
    return (
      <main style={{ padding: "1.5rem" }}>
        <h1>Events</h1>
        <p>No tenants in the database. Run <code>pnpm seed</code>.</p>
      </main>
    );
  }

  const name =
    searchParams.name && (EVENT_NAMES as readonly string[]).includes(searchParams.name)
      ? searchParams.name
      : undefined;
  const status =
    searchParams.status && STATUSES.includes(searchParams.status as EventStatus)
      ? (searchParams.status as EventStatus)
      : undefined;
  const fromTs = maybeDate(searchParams.from);
  const untilTs = maybeDate(searchParams.until);

  const events = await listEvents({
    tenantId: active.id,
    name,
    status,
    fromTs,
    untilTs,
    limit: 100,
  });

  return (
    <main style={{ padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "1rem" }}>
        <h1 style={{ marginTop: 0 }}>Events</h1>
        <span style={{ opacity: 0.65, fontSize: 13 }}>
          tenant: <b>{active.name}</b> · live tail on
        </span>
      </div>
      <FilterBar current={{ name, status, from: searchParams.from, until: searchParams.until }} />
      <EventsTable
        initial={events.map(serializeRow)}
        tenantSlug={active.slug}
        filter={{ name, status, from: searchParams.from, until: searchParams.until }}
      />
    </main>
  );
}

function maybeDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function serializeRow(r: Awaited<ReturnType<typeof listEvents>>[number]) {
  return {
    ...r,
    ts: r.ts.toISOString(),
    receivedAt: r.receivedAt.toISOString(),
  };
}

function FilterBar({
  current,
}: {
  current: {
    name?: string;
    status?: EventStatus;
    from?: string;
    until?: string;
  };
}) {
  return (
    <form
      method="get"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.75rem",
        margin: "1rem 0 1.25rem",
      }}
    >
      <label style={label}>
        Event name
        <select name="name" defaultValue={current.name ?? ""} style={select}>
          <option value="">(any)</option>
          {EVENT_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label style={label}>
        Status
        <select name="status" defaultValue={current.status ?? ""} style={select}>
          <option value="">(any)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label style={label}>
        From (ts)
        <input
          type="datetime-local"
          name="from"
          defaultValue={current.from ?? ""}
          style={input}
        />
      </label>
      <label style={label}>
        Until (ts)
        <input
          type="datetime-local"
          name="until"
          defaultValue={current.until ?? ""}
          style={input}
        />
      </label>
      <button type="submit" style={submit}>
        Apply
      </button>
    </form>
  );
}

const label: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  opacity: 0.8,
  gap: 4,
};
const select: React.CSSProperties = {
  background: "#151a20",
  color: "#e4e6eb",
  border: "1px solid #2a323d",
  borderRadius: 6,
  padding: "0.35rem 0.55rem",
  fontSize: 13,
};
const input = select;
const submit: React.CSSProperties = {
  alignSelf: "flex-end",
  background: "#3a72ff",
  color: "#fff",
  border: 0,
  borderRadius: 6,
  padding: "0.4rem 0.9rem",
  fontSize: 13,
  cursor: "pointer",
};
