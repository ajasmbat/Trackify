import type { ReactNode } from "react";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import { currentTenant } from "@/lib/tenant";
import { TenantSwitcher } from "@/components/TenantSwitcher";
import "./globals.css";

export const metadata = {
  title: "Trackify · Console",
  description: "Operator console for Trackify tenants, events, and journeys.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  // Skip the header for unauthenticated pages — the signin page renders its
  // own centered card and the chrome would just look out of place.
  const chrome = session ? await headerChrome() : null;

  return (
    <html lang="en">
      <body>
        {chrome}
        {children}
      </body>
    </html>
  );
}

async function headerChrome() {
  const { active, all } = await currentTenant();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "0.75rem 1.5rem",
        borderBottom: "1px solid #1e242c",
        background: "#0b0d10",
        color: "#e4e6eb",
        fontFamily: "system-ui",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <Link href="/" style={{ color: "#e4e6eb", textDecoration: "none", fontWeight: 700 }}>
        Trackify
      </Link>
      <nav style={{ display: "flex", gap: "1rem", fontSize: 14 }}>
        <Link href="/events" style={{ color: "#a9b3c1", textDecoration: "none" }}>
          Events
        </Link>
        <Link href="/journey" style={{ color: "#a9b3c1", textDecoration: "none" }}>
          Journey
        </Link>
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <TenantSwitcher active={active} tenants={all} />
        <form action={signOutAction}>
          <button
            type="submit"
            style={{
              background: "transparent",
              color: "#a9b3c1",
              border: "1px solid #2a323d",
              borderRadius: 6,
              padding: "0.3rem 0.6rem",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
