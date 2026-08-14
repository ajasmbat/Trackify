"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { EventStatus } from "@/lib/queries";

interface Row {
  id: string;
  eventId: string;
  tenantId: string;
  journeyId: string;
  name: string;
  ts: string;
  receivedAt: string;
  status: EventStatus;
}

interface Props {
  initial: Row[];
  tenantSlug: string;
  filter: {
    name?: string;
    status?: string;
    from?: string;
    until?: string;
  };
}

const POLL_MS = 2000;

export function EventsTable({ initial, tenantSlug, filter }: Props) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [tailing, setTailing] = useState(true);
  const cursorRef = useRef<string | null>(initial[0]?.receivedAt ?? null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (filter.name) p.set("name", filter.name);
    if (filter.status) p.set("status", filter.status);
    if (filter.from) p.set("from", filter.from);
    if (filter.until) p.set("until", filter.until);
    return p;
  }, [filter.name, filter.status, filter.from, filter.until]);

  useEffect(() => {
    // Reset cursor + rows when the underlying filter changes.
    setRows(initial);
    cursorRef.current = initial[0]?.receivedAt ?? null;
  }, [initial]);

  useEffect(() => {
    if (!tailing) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      try {
        const p = new URLSearchParams(query);
        if (cursorRef.current) p.set("since", cursorRef.current);
        const res = await fetch(`/api/events?${p.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { events: Row[] };
          if (body.events.length > 0) {
            setRows((prev) => {
              const merged = [...body.events, ...prev];
              cursorRef.current = merged[0]?.receivedAt ?? cursorRef.current;
              return merged.slice(0, 500);
            });
          }
          setError(null);
        } else {
          setError(`tail: ${res.status}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "tail error");
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    }
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tailing, query]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <label style={{ fontSize: 12, opacity: 0.8, display: "flex", gap: 6 }}>
          <input
            type="checkbox"
            checked={tailing}
            onChange={(e) => setTailing(e.currentTarget.checked)}
          />
          Live tail (poll every {POLL_MS / 1000}s)
        </label>
        {error ? (
          <span style={{ color: "#ff6b6b", fontSize: 12 }}>{error}</span>
        ) : null}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.7 }}>
            <th style={th}>Received</th>
            <th style={th}>Event ts</th>
            <th style={th}>Name</th>
            <th style={th}>Status</th>
            <th style={th}>Journey</th>
            <th style={th}>ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "1rem", opacity: 0.6 }}>
                No events yet for tenant <b>{tenantSlug}</b>.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #1e242c" }}>
                <td style={td}>{fmtTime(r.receivedAt)}</td>
                <td style={td}>{fmtTime(r.ts)}</td>
                <td style={td}>
                  <Link href={`/events/${r.id}`}>{r.name}</Link>
                </td>
                <td style={td}>
                  <StatusPill status={r.status} />
                </td>
                <td style={td}>
                  <Link href={`/journey/${encodeURIComponent(r.journeyId)}`}>
                    {r.journeyId.slice(0, 10)}…
                  </Link>
                </td>
                <td style={{ ...td, fontFamily: "monospace", opacity: 0.7 }}>
                  {r.eventId.slice(0, 8)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: EventStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.3,
        background: color.bg,
        color: color.fg,
      }}
    >
      {status}
    </span>
  );
}

const STATUS_COLOR: Record<EventStatus, { bg: string; fg: string }> = {
  pending: { bg: "#3a3f4a", fg: "#e4e6eb" },
  in_flight: { bg: "#2d3a5a", fg: "#a9c1ff" },
  retrying: { bg: "#5a4a2d", fg: "#ffd591" },
  done: { bg: "#264a2d", fg: "#8fe0a5" },
  dead_letter: { bg: "#5a2d2d", fg: "#ff9b9b" },
};

const th: React.CSSProperties = { padding: "0.4rem 0.6rem", fontWeight: 500 };
const td: React.CSSProperties = { padding: "0.5rem 0.6rem", verticalAlign: "top" };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 19).replace("T", " ");
}
