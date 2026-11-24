// Web build: the Rust core runs on the server (core/crates/mail-web); every call goes over HTTP.
// The wire format mirrors the uniffi TypeScript shapes ({ tag, inner } enums, camelCase records),
// so the generated types and their `instanceOf` helpers keep working unchanged.
import type { Draft, EventListener, MailCoreLike } from './generated/mail_ffi';

export * from './generated/mail_ffi';

const noNulls = (_key: string, value: unknown) => (value === null ? undefined : value);

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch(`/api/rpc/${method}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args.map((arg) => (arg === undefined ? null : arg))),
  });
  const text = await response.text();
  if (response.status === 422) throw Object.assign(new Error(text), JSON.parse(text, noNulls));
  if (!response.ok) throw Object.assign(new Error(text || response.statusText), { tag: 'Network', inner: { message: text } });
  return (text ? JSON.parse(text, noNulls) : undefined) as T;
}

/** Files picked in the browser (blob:) or forwarded from another mail (/api/) live client-side: upload them first. */
async function uploaded(path: string, filename: string): Promise<string> {
  if (!/^(blob:|data:|\/api\/)/.test(path)) return path;
  const body = await (await fetch(path, { credentials: 'same-origin' })).blob();
  const response = await fetch(`/api/upload?name=${encodeURIComponent(filename)}`, { method: 'POST', body });
  if (!response.ok) throw Object.assign(new Error(await response.text()), { tag: 'Network', inner: { message: 'upload' } });
  return (await response.json()).path;
}

export class MailCore implements MailCoreLike {
  static open(_dataDirectory: string): MailCoreLike {
    return new MailCore();
  }

  subscribe(listener: EventListener): void {
    const source = new EventSource('/api/events', { withCredentials: true });
    source.onmessage = (message) => listener.onEvent(JSON.parse(message.data, noNulls));
  }

  discover = (email: string) => call<any>('discover', email);
  addAccount = (config: any, secret: string) => call<any>('addAccount', config, secret);
  unlockAccount = (accountId: string, secret: string) => void call('unlockAccount', accountId, secret);
  updatePassword = (accountId: string, secret: string) => call<void>('updatePassword', accountId, secret);
  listAccounts = () => call<any>('listAccounts');
  renameAccount = (accountId: string, displayName: string) => call<void>('renameAccount', accountId, displayName);
  removeAccount = (accountId: string) => call<void>('removeAccount', accountId);
  listMailboxes = (accountId: string | undefined) => call<any>('listMailboxes', accountId);
  listThreads = (scope: any, filter: any, category: any, cursor: string | undefined, limit: number) =>
    call<any>('listThreads', scope, filter, category, cursor, limit);
  threadEmails = (threadId: string, contextMailboxId: string | undefined) =>
    call<any>('threadEmails', threadId, contextMailboxId);
  checkNewMail = (budgetMs: number) => call<any>('checkNewMail', budgetMs);
  body = (emailId: string) => call<any>('body', emailId);
  unsubscribe = (emailId: string) => call<any>('unsubscribe', emailId);
  /** Returns a URL the browser can open or download; `directory` has no meaning here. */
  saveAttachment = async (emailId: string, index: number, _directory: string) =>
    `/api/attachment/${encodeURIComponent(emailId)}/${index}`;
  suggestAddresses = (query: string, limit: number) => call<any>('suggestAddresses', query, limit);
  search = (query: string, limit: number, mailboxIds: string[]) => call<any>('search', query, limit, mailboxIds);
  setSenderCategory = (sender: string, category: any) => call<void>('setSenderCategory', sender, category);
  setKeywords = (emailIds: string[], add: any[], remove: any[]) => call<void>('setKeywords', emailIds, add, remove);
  setThreadKeywords = (mailboxId: string, threadId: string, add: any[], remove: any[]) =>
    call<void>('setThreadKeywords', mailboxId, threadId, add, remove);
  moveThread = (mailboxId: string, threadId: string, destination: any, holdMs: number) =>
    call<any>('moveThread', mailboxId, threadId, destination, holdMs);
  moveEmails = (emailIds: string[], fromMailboxId: string, destination: any, holdMs: number) =>
    call<any>('moveEmails', emailIds, fromMailboxId, destination, holdMs);
  send = async (draft: Draft) => {
    const attachments = await Promise.all(
      draft.attachments.map(async (file) => ({ ...file, path: await uploaded(file.path, file.filename) })),
    );
    return call<void>('send', { ...draft, attachments });
  };
  syncNow = (accountId: string | undefined) => void call('syncNow', accountId);
  openMailbox = (mailboxId: string) => call<void>('openMailbox', mailboxId);
  loadOlder = (mailboxId: string) => call<void>('loadOlder', mailboxId);
  onForeground = () => void call('onForeground');
  onBackground = () => void call('onBackground');
}

/** Whether the server keeps a password for this account (web only). */
export const hasStoredSecret = (accountId: string) => call<boolean>('hasSecret', accountId);

export async function uniffiInitAsync() {}

import * as mail_ffi from './generated/mail_ffi';
export default { mail_ffi: { ...mail_ffi, MailCore } };
