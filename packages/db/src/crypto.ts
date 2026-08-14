import sodium from "libsodium-wrappers";
import { loadEnv, credentialKeyEnv } from "@trackify/shared";

// libsodium `crypto_secretbox_easy` (XSalsa20-Poly1305) with a 32-byte
// symmetric master key. See DECISIONS.md — picked over KMS envelope because
// this is single-node; rotation is a documented re-encrypt migration.
//
// Storage layout: base64(nonce || ciphertext). Nonce is 24 bytes.

let readyPromise: Promise<void> | null = null;
async function ready(): Promise<void> {
  if (!readyPromise) readyPromise = sodium.ready;
  await readyPromise;
}

function key(): Uint8Array {
  const env = loadEnv(credentialKeyEnv);
  return Buffer.from(env.CREDENTIAL_KEY_HEX, "hex");
}

export async function encryptCredentials(
  plain: Record<string, string>,
): Promise<string> {
  await ready();
  const json = Buffer.from(JSON.stringify(plain), "utf8");
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(json, nonce, key());
  const combined = Buffer.concat([Buffer.from(nonce), Buffer.from(cipher)]);
  return combined.toString("base64");
}

export async function decryptCredentials(
  cipherB64: string,
): Promise<Record<string, string>> {
  await ready();
  const combined = Buffer.from(cipherB64, "base64");
  const nonce = combined.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const cipher = combined.subarray(sodium.crypto_secretbox_NONCEBYTES);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, key());
  return JSON.parse(Buffer.from(plain).toString("utf8"));
}
