import { formatUsd } from "@/lib/cart";
import { addToCartAction } from "@/lib/cart-actions";
import { getProduct } from "@/lib/catalog";
import { AddToCartTracker, ViewItemTracker } from "@/lib/tracking/trackers";
import { notFound } from "next/navigation";

type Props = { params: { id: string } };

export default function ProductDetailPage({ params }: Props) {
  const product = getProduct(params.id);
  if (!product) notFound();

  const trackedItem = {
    sku: product.id,
    name: product.name,
    quantity: 1,
    price_cents: product.priceCents,
    currency: product.currency,
  } as const;

  return (
    <>
      <h1 className="page-title">catalog/{product.id} --describe</h1>
      <ViewItemTracker item={trackedItem} />
      <div className="pdp" data-testid="pdp" data-sku={product.id}>
        <div className="photo">
          <span className="muted">[{product.name}]</span>
        </div>
        <div>
          <p style={{ margin: "0 0 0.4rem" }}>
            <strong>{product.name}</strong>
          </p>
          <p className="muted" style={{ margin: "0.2rem 0" }}>
            sku={product.id} · category={product.category} · currency={product.currency}
          </p>
          <p
            className="price"
            data-testid="pdp-price"
            style={{ fontSize: "1.4rem", margin: "0.4rem 0" }}
          >
            {formatUsd(product.priceCents)}
          </p>
          <p>{product.description}</p>
          <AddToCartTracker
            product={{
              sku: product.id,
              name: product.name,
              priceCents: product.priceCents,
              currency: product.currency,
            }}
          >
            <form action={addToCartAction} className="stack">
              <input type="hidden" name="sku" value={product.id} />
              <label htmlFor="qty">quantity</label>
              <input
                id="qty"
                name="qty"
                type="number"
                min={1}
                max={9}
                defaultValue={1}
                style={{ maxWidth: "6rem" }}
              />
              <span />
              <button type="submit">add_to_cart</button>
            </form>
          </AddToCartTracker>
        </div>
      </div>
    </>
  );
}
