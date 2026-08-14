import { CART_COOKIE, CURRENCY, formatUsd, parseCart, resolveLines, totalCents } from "@/lib/cart";
import { placeOrderAction } from "@/lib/checkout-actions";
import { IDENTITY_COOKIE, parseIdentity } from "@/lib/session";
import { cookies } from "next/headers";

type SearchParams = { error?: string };

export default function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const jar = cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const lines = resolveLines(cart);
  const total = totalCents(cart);
  const identity = parseIdentity(jar.get(IDENTITY_COOKIE)?.value);
  const errorMsg = errorFor(searchParams.error);

  return (
    <>
      <h1 className="page-title">checkout --identify</h1>
      <p className="muted">
        This is the moment the visitor stops being anonymous. Fields are plaintext in the browser —
        hashing happens server-side (T4).
      </p>
      {errorMsg && <div className="error">{errorMsg}</div>}

      {lines.length === 0 ? (
        <p>
          Cart is empty. <a href="/">Browse the catalog →</a>
        </p>
      ) : (
        <>
          <form action={placeOrderAction} className="stack" data-testid="checkout-form">
            <label htmlFor="email">email</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              defaultValue={identity?.email ?? ""}
              autoComplete="email"
            />
            <label htmlFor="phone">phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              required
              defaultValue={identity?.phone ?? ""}
              autoComplete="tel"
            />
            <span />
            <button type="submit">place_order</button>
          </form>

          <p className="muted" style={{ marginTop: "1.2rem" }}>
            Order summary: {lines.length} {lines.length === 1 ? "line" : "lines"} ·{" "}
            <span className="price">{formatUsd(total)}</span> · {CURRENCY}
          </p>
          <table className="data" data-testid="checkout-summary" style={{ maxWidth: 520 }}>
            <thead>
              <tr>
                <th>sku</th>
                <th>name</th>
                <th className="right">qty</th>
                <th className="right">subtotal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.sku} data-sku={line.sku}>
                  <td>{line.sku}</td>
                  <td>{line.product.name}</td>
                  <td className="right">{line.qty}</td>
                  <td className="right price">{formatUsd(line.subtotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function errorFor(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "missing_identity") return "Email and phone are both required.";
  return null;
}
