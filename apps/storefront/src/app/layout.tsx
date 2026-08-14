import { CART_COOKIE, parseCart, totalQty } from "@/lib/cart";
import { TrackingProvider } from "@/lib/tracking/trackers";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "trackify-store $",
  description: "Fake storefront used as an event-generation instrument.",
};

// T11 loader — first-party script served by the relay at a randomised
// per-tenant path so ad blockers can't match it by URL. The T8 client
// bundle still ships (the two coordinate through `event_id` — a duplicate
// hop-2 POST is deduped server-side) so a browser with no blocker keeps
// its rich event coverage while a blocked one still delivers at minimum
// page_view via the loader.
const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;
const LOADER_PATH = process.env.NEXT_PUBLIC_LOADER_PATH;

export default function RootLayout({ children }: { children: ReactNode }) {
  const cartRaw = cookies().get(CART_COOKIE)?.value;
  const cart = parseCart(cartRaw);
  const qty = totalQty(cart);
  const loaderSrc =
    RELAY_URL && LOADER_PATH ? `${RELAY_URL.replace(/\/+$/, "")}/l/${LOADER_PATH}.js` : undefined;
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <a href="/" className="brand">
            trackify-store $
          </a>
          <nav>
            <a href="/cart">cart({qty})</a>
            <span className="sep">·</span>
            <a href="/checkout">/login</a>
          </nav>
        </header>
        <main className="site-main">{children}</main>
        <TrackingProvider />
        {loaderSrc ? <script async src={loaderSrc} /> : null}
      </body>
    </html>
  );
}
