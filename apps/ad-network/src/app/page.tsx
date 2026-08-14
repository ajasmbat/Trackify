export const dynamic = "force-dynamic";

export default function AdNetworkHome() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "3rem auto",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#111",
      }}
    >
      <p style={{ opacity: 0.55, fontSize: 12, letterSpacing: 1, marginBottom: 24 }}>
        SPONSORED · TRACKIFY AD NETWORK
      </p>

      <a
        href="/api/click?campaign=trackify_launch"
        rel="noopener"
        style={{
          display: "block",
          border: "1px solid #d0d7de",
          borderRadius: 12,
          overflow: "hidden",
          textDecoration: "none",
          color: "inherit",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div
          role="img"
          aria-label="Fake ad creative for Trackify Store"
          style={{
            height: 320,
            background:
              "linear-gradient(135deg,#4267B2 0%,#5b7bd6 45%,#e4e6eb 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 0.5,
          }}
        >
          Shop Trackify Store · 20% off
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 12, opacity: 0.6 }}>trackify.example</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
            Everyday essentials, delivered
          </div>
          <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
            Learn More
          </div>
        </div>
      </a>

      <p style={{ marginTop: 32, fontSize: 14, opacity: 0.7 }}>
        Already visited?{" "}
        <a
          href="/api/return-visit"
          rel="noopener"
          style={{ color: "#0969da" }}
        >
          Return to Trackify Store
        </a>{" "}
        (no tracking params — tests cookie-only attribution).
      </p>
    </main>
  );
}
