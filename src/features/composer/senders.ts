import type { Account, EmailSummary } from '@openmailbox/mail-core';

import type { Identity } from '@/stores/settingsStore';

export type Sender = { key: string; accountId: string; name: string; email: string; signature: string; identity?: Identity };

export function sendersOf(accounts: Account[], identities: Record<string, Identity[]>, signatures: Record<string, string>): Sender[] {
  return accounts.flatMap((account) => [
    { key: account.id, accountId: account.id, name: account.displayName, email: account.email, signature: signatures[account.id] ?? '' },
    ...(identities[account.id] ?? []).map((identity) => ({
      key: identity.id,
      accountId: account.id,
      name: identity.name.trim() || account.displayName,
      email: identity.email,
      signature: identity.signature,
      identity,
    })),
  ]);
}

export function replySender(senders: Sender[], email: EmailSummary): Sender | undefined {
  const own = senders.filter((sender) => sender.identity && sender.accountId === email.accountId);
  for (const address of [...email.to, ...email.cc, ...email.from]) {
    const match = own.find((sender) => sender.email.toLowerCase() === address.email.toLowerCase());
    if (match) return match;
  }
  return undefined;
}
