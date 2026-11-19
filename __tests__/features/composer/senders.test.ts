import { replySender, sendersOf } from '@/features/composer/senders';

import { makeAccount, makeEmail } from '../../helpers/fixtures';

const support = { id: 'identity-1', name: 'Support', email: 'info@example.com', signature: 'Support team' };
const contact = { id: 'identity-2', name: ' ', email: 'contact@example.com', signature: '' };
const other = { id: 'identity-3', name: 'Sales', email: 'sales@soluce.example', signature: '' };
const accounts = [makeAccount(), makeAccount({ id: 'account-2', email: 'charles@soluce.example', displayName: 'Charles' })];
const senders = sendersOf(accounts, { 'account-1': [support, contact], 'account-2': [other] }, { 'account-1': 'Alice' });

describe('sendersOf', () => {
  it('lists each account followed by its identities', () => {
    expect(senders.map((sender) => [sender.key, sender.accountId, sender.name, sender.email, sender.signature])).toEqual([
      ['account-1', 'account-1', 'Alice Martin', 'alice@example.com', 'Alice'],
      ['identity-1', 'account-1', 'Support', 'info@example.com', 'Support team'],
      ['identity-2', 'account-1', 'Alice Martin', 'contact@example.com', ''],
      ['account-2', 'account-2', 'Charles', 'charles@soluce.example', ''],
      ['identity-3', 'account-2', 'Sales', 'sales@soluce.example', ''],
    ]);
    expect(senders[0].identity).toBeUndefined();
    expect(senders[1].identity).toBe(support);
  });
});

describe('replySender', () => {
  it('picks the identity the original was copied to, ignoring case', () => {
    const email = makeEmail({ cc: [{ name: undefined, email: 'INFO@example.com' }] });
    expect(replySender(senders, email)?.key).toBe('identity-1');
  });

  it('picks the identity the user sent the original from', () => {
    const email = makeEmail({ from: [{ name: 'Alice', email: 'contact@example.com' }], to: [{ name: undefined, email: 'bob@example.com' }] });
    expect(replySender(senders, email)?.key).toBe('identity-2');
  });

  it("ignores another account's identities and leaves the account's address otherwise", () => {
    expect(replySender(senders, makeEmail({ to: [{ name: undefined, email: 'sales@soluce.example' }] }))).toBeUndefined();
    expect(replySender(senders, makeEmail())).toBeUndefined();
  });
});
