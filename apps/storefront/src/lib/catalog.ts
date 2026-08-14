// Static fake catalog — 7 products. NOT a CMS; do not add one (per plan).
// Prices are in cents to match `packages/shared` LineItem.price_cents.

export type Product = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly priceCents: number;
  readonly currency: "USD";
  readonly description: string;
};

const CATALOG: readonly Product[] = [
  {
    id: "p-101",
    name: "canvas tote",
    category: "bags",
    priceCents: 1800,
    currency: "USD",
    description: "Heavy 12oz cotton canvas. Reinforced straps. Fits a laptop.",
  },
  {
    id: "p-102",
    name: "enamel mug",
    category: "home",
    priceCents: 1200,
    currency: "USD",
    description: "12oz steel with white enamel. Dishwasher safe.",
  },
  {
    id: "p-103",
    name: "field notebook",
    category: "paper",
    priceCents: 850,
    currency: "USD",
    description: "Pocket-sized. 48 pages. Dot grid.",
  },
  {
    id: "p-104",
    name: "wool beanie",
    category: "apparel",
    priceCents: 2400,
    currency: "USD",
    description: "Ribbed knit merino wool. One size. Not machine washable.",
  },
  {
    id: "p-105",
    name: "cotton tee",
    category: "apparel",
    priceCents: 2200,
    currency: "USD",
    description: "Ringspun cotton. Crew neck. Runs slightly small.",
  },
  {
    id: "p-106",
    name: "ceramic vase",
    category: "home",
    priceCents: 3400,
    currency: "USD",
    description: "Stoneware, 20cm tall. Hand-thrown, no two identical.",
  },
  {
    id: "p-107",
    name: "leather keyring",
    category: "accessories",
    priceCents: 900,
    currency: "USD",
    description: "Full-grain leather loop with brass split ring.",
  },
];

export function listProducts(): readonly Product[] {
  return CATALOG;
}

export function getProduct(id: string): Product | undefined {
  return CATALOG.find((p) => p.id === id);
}
