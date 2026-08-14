import { CART_COOKIE, CURRENCY, formatUsd, parseCart, resolveLines, totalCents } from "@/lib/cart";
import { removeFromCartAction } from "@/lib/cart-actions";
import { cookies } from "next/headers";

type SearchParams = { error?: string };

export default function CartPage({ searchParams }: { searchParams: SearchParams }) {
  const jar = cookies();
  const cart = parseCart(jar.get(CART_COOKIE)?.value);
  const lines = resolveLines(cart);
  const total = totalCents(cart);
  const errorMsg = errorFor(searchParams.error);

  return (
    <>
      <h1 className="page-title">cart --show</h1>
      {errorMsg && <div className="error">{errorMsg}</div>}
      {lines.length === 0 ? (
        <p>
          Cart is empty. <a href="/">Browse the catalog →</a>
        </p>
      ) : (
        <>
          <table className="data" data-testid="cart-table">
            <thead>
              <tr>
                <th>sku</th>
                <th>name</th>
                <th className="right">qty</th>
                <th className="right">unit</th>
                <th className="right">subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.sku} data-sku={line.sku}>
                  <td>{line.sku}</td>
                  <td>{line.product.name}</td>
                  <td className="right">{line.qty}</td>
                  <td className="right price">{formatUsd(line.product.priceCents)}</td>
                  <td className="right price">{formatUsd(line.subtotalCents)}</td>
                  <td>
                    <form action={removeFromCartAction} className="inline-form">
                      <input type="hidden" name="sku" value={line.sku} />
                      <button
                        type="submit"
                        className="ghost"
                        style={{
                          padding: 0,
                          border: "none",
                          background: "transparent",
                          color: "#0a58ca",
                          textDecoration: "underline",
                          cursor: "pointer",
                        }}
                      >
                        remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="totals" data-testid="cart-totals">
            <div className="row">
              <span>subtotal</span>
              <span className="price">{formatUsd(total)}</span>
            </div>
            <div className="row">
              <span>shipping</span>
              <span className="price">{formatUsd(0)}</span>
            </div>
            <div className="row total">
              <span>total ({CURRENCY})</span>
              <span className="price" data-testid="cart-total">
                {formatUsd(total)}
              </span>
            </div>
          </div>
          <p className="actions-right">
            <a href="/checkout">
              <button type="button">begin_checkout →</button>
            </a>
          </p>
        </>
      )}
    </>
  );
}

function errorFor(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "empty") return "Your cart is empty — add something before checking out.";
  return null;
}
