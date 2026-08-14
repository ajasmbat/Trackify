import { CART_COOKIE, parseCart, totalQty } from "@/lib/cart";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "trackify-store $",
  description: "Fake storefront used as an event-generation instrument.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const cartRaw = cookies().get(CART_COOKIE)?.value;
  const cart = parseCart(cartRaw);
  const qty = totalQty(cart);
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
      </body>
    </html>
  );
}
