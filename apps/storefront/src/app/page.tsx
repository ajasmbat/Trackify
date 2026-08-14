import { formatUsd } from "@/lib/cart";
import { listProducts } from "@/lib/catalog";

export default function StorefrontHome() {
  const products = listProducts();
  return (
    <>
      <h1 className="page-title">catalog --all</h1>
      <table className="data" data-testid="product-list">
        <thead>
          <tr>
            <th>sku</th>
            <th>name</th>
            <th className="cat">category</th>
            <th className="right">price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id} data-sku={p.id}>
              <td>{p.id}</td>
              <td>
                <a href={`/products/${p.id}`}>{p.name}</a>
              </td>
              <td className="cat">{p.category}</td>
              <td className="right price">{formatUsd(p.priceCents)}</td>
              <td>
                <a href={`/products/${p.id}`}>view</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: "0.8rem" }}>
        {products.length} items · currency=USD · sort=default
      </p>
    </>
  );
}
