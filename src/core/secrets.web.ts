// @ts-expect-error web-only export of modules/mail-core/src/index.web.ts
import { hasStoredSecret } from '@openmailbox/mail-core';

// The server stores passwords (core/crates/mail-web); this token asks it to use the stored one.
const STORED = '\u0000stored';

export async function saveSecret(_accountId: string, _secret: string): Promise<void> {}

export async function readSecret(accountId: string): Promise<string | null> {
  return (await hasStoredSecret(accountId)) ? STORED : null;
}

export async function deleteSecret(_accountId: string): Promise<void> {}
