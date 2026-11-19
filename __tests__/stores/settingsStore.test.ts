import { storage } from '@/storage';
import { useSettingsStore } from '@/stores/settingsStore';

describe('settings store', () => {
  it('keeps remote images blocked until the user allows them', () => {
    expect(useSettingsStore.getState().loadRemoteImages).toBe(false);
  });

  it('persists preferences to storage', () => {
    useSettingsStore.getState().setThemePreference('dark');
    useSettingsStore.getState().setLanguage('oc');
    useSettingsStore.getState().setLoadRemoteImages(true);
    useSettingsStore.getState().setAccountName('account-1', 'Work');
    useSettingsStore.getState().toggleCollapsed('account-1');
    useSettingsStore.getState().markCategorySeen('updates', 2_000);
    useSettingsStore.getState().markCategorySeen('updates', 1_000);
    const saved = JSON.parse(storage.getString('settings-store') ?? '{}');
    expect(saved.state).toMatchObject({
      themePreference: 'dark',
      language: 'oc',
      loadRemoteImages: true,
      accountNames: { 'account-1': 'Work' },
      collapsedIds: ['account-1'],
      categorySeenAt: { updates: 2_000 },
    });
  });

  it('persists identities and forgets them with their account', () => {
    const support = { id: 'identity-1', name: 'Support', email: 'info@example.com', signature: '' };
    const contact = { id: 'identity-2', name: '', email: 'contact@example.com', signature: 'Contact' };
    const { saveIdentity, removeIdentity, forgetAccount } = useSettingsStore.getState();
    saveIdentity('account-1', support);
    saveIdentity('account-1', contact);
    saveIdentity('account-1', { ...support, name: 'Help Desk' });
    removeIdentity('account-1', 'identity-2');
    const saved = () => JSON.parse(storage.getString('settings-store') ?? '{}').state.identities;
    expect(saved()).toEqual({ 'account-1': [{ ...support, name: 'Help Desk' }] });

    removeIdentity('account-1', 'identity-1');
    expect(saved()).toEqual({});

    saveIdentity('account-1', contact);
    forgetAccount('account-1');
    expect(saved()).toEqual({});
  });

  it('keeps the mailbox filter off with unread mail as its criterion', () => {
    expect(useSettingsStore.getState().filterEnabled).toBe(false);
    expect(useSettingsStore.getState().filterCriteria.unread).toBe(true);
  });

  it('persists the mailbox filter and forgets removed accounts in it', () => {
    useSettingsStore.getState().setFilterEnabled(true);
    useSettingsStore.getState().setFilterCriteria({ flagged: true, excludedAccountIds: ['account-1', 'account-2'] });
    useSettingsStore.getState().forgetAccount('account-1');
    const saved = JSON.parse(storage.getString('settings-store') ?? '{}');
    expect(saved.state).toMatchObject({
      filterEnabled: true,
      filterCriteria: { unread: true, flagged: true, excludedAccountIds: ['account-2'] },
    });
  });
});
