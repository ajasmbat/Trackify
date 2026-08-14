// Session cookies for the fake login. Plaintext — this is a mock storefront;
// hashing PII is T4's job on the server. Keeping the cookie names distinct
// so nothing collides with the relay's cookie service (T12).

export const IDENTITY_COOKIE = "sf_id";

export type Identity = {
  readonly email: string;
  readonly phone: string;
};

export function parseIdentity(raw: string | undefined): Identity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const email = (parsed as { email?: unknown }).email;
    const phone = (parsed as { phone?: unknown }).phone;
    if (typeof email !== "string" || typeof phone !== "string") return null;
    if (!email || !phone) return null;
    return { email, phone };
  } catch {
    return null;
  }
}

export function serializeIdentity(identity: Identity): string {
  return JSON.stringify(identity);
}
