// Small helper that owns the exact credentials-record shape the T6 adapter's
// Zod schema (MetaConfig) accepts. Kept in this folder so callers (setup
// script, tests, future dashboards) never have to spell Meta credential
// key names outside destinations/meta/**.

export interface MetaCredentialsInput {
  pixelId: string;
  accessToken: string;
  testEventCode?: string;
}

export function buildMetaCredentialsRecord(
  input: MetaCredentialsInput,
): Record<string, string> {
  const record: Record<string, string> = {
    pixel_id: input.pixelId,
    access_token: input.accessToken,
  };
  if (input.testEventCode && input.testEventCode.length > 0) {
    record.test_event_code = input.testEventCode;
  }
  return record;
}
