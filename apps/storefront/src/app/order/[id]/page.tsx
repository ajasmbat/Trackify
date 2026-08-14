import { formatUsd } from "@/lib/cart";
import { orderCookieName, parseOrder } from "@/lib/order";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

type Props = { params: { id: string } };

export default function OrderConfirmationPage({ params }: Props) {
  const jar = cookies();
  const orderRaw = jar.get(orderCookieName(params.id))?.value;
  const order = parseOrder(orderRaw);
  if (!order || order.id !== params.id) notFound();

  const valueMajor = (order.totalCents / 100).toFixed(2);

  return (
    <>
      <h1 className="page-title">order/{order.id} --receipt</h1>
      <pre className="receipt" data-testid="order-receipt">
        {"order    : "}
        <b data-testid="transaction_id">{order.id}</b>
        {"\nstatus   : placed\nplaced   : "}
        {order.placedAt}
        {"\nvalue    : "}
        <b data-testid="value">{valueMajor}</b>
        {"\ncurrency : "}
        <b data-testid="currency">{order.currency}</b>
        {"\nlines    :"}
        {order.lines.map((line) => (
          <span
            key={line.sku}
            data-testid="order-line"
            data-sku={line.sku}
            data-qty={line.qty}
            data-unit-cents={line.unitPriceCents}
            data-subtotal-cents={line.subtotalCents}
          >
            {`\n  - sku=${line.sku} qty=${line.qty} unit=${formatUsd(line.unitPriceCents)} subtotal=${formatUsd(
              line.subtotalCents,
            )}`}
          </span>
        ))}
        {`\nidentity :\n  email  : ${order.email}  (hashed server-side by T4)\n  phone  : ${order.phone}  (hashed server-side by T4)\n`}
        <span className="caret" aria-hidden />
      </pre>
      <p className="muted" style={{ marginTop: "0.9rem" }}>
        This block is the DOM T8&apos;s tracking loader will read to fire the <code>purchase</code>{" "}
        event.
      </p>
      <p style={{ marginTop: "0.6rem" }}>
        <a href="/">← keep shopping</a>
      </p>
    </>
  );
}
