import type { Identity } from "@trackify/shared";
import {
  hashEmail,
  hashPhone,
  normalisePhone,
  sha256Hex,
} from "@trackify/shared";

// Ingest-side wrapper over @trackify/shared/pii. The route handler MUST call
// `hashIdentity` before persisting so raw email/phone never land in a row or
// a log line — hashed fields go in, raw values are dropped.

export type HashedIdentity = {
  email_sha256?: string;
  phone_sha256?: string;
  external_id_sha256?: string;
};

export class InvalidPhoneError extends Error {
  constructor() {
    super("phone present but no digits after normalisation");
    this.name = "InvalidPhoneError";
  }
}

export function hashIdentity(
  identity: Identity | undefined,
): HashedIdentity | undefined {
  if (!identity) return undefined;
  const out: HashedIdentity = {};

  if (identity.email_sha256) out.email_sha256 = identity.email_sha256;
  else if (identity.email) out.email_sha256 = hashEmail(identity.email);

  if (identity.phone_sha256) out.phone_sha256 = identity.phone_sha256;
  else if (identity.phone) {
    const digits = normalisePhone(identity.phone);
    if (!digits) throw new InvalidPhoneError();
    out.phone_sha256 = sha256Hex(digits);
  }

  if (identity.external_id_sha256)
    out.external_id_sha256 = identity.external_id_sha256;
  else if (identity.external_id)
    out.external_id_sha256 = sha256Hex(identity.external_id);

  return out;
}
