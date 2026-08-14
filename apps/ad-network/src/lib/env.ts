function requireUrl(name: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim() === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new Error(`Invalid URL for env ${name}: ${raw}`);
  }
}

let cachedStorefrontOrigin: string | null = null;

export function storefrontOrigin(): string {
  if (cachedStorefrontOrigin === null) {
    cachedStorefrontOrigin = requireUrl("AD_NETWORK_STOREFRONT_URL");
  }
  return cachedStorefrontOrigin;
}
