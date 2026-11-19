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

  it('adds Sent from Open Mailbox until the user turns it off', () => {
    expect(useSettingsStore.getState().sentFromFooter).toBe(true);
    useSettingsStore.getState().setSentFromFooter(false);
    expect(JSON.parse(storage.getString('settings-store') ?? '{}').state.sentFromFooter).toBe(false);
  });

  it('turns plain-text signatures saved by older versions into HTML, links included', async () => {
    storage.set(
      'settings-store',
      JSON.stringify({
        state: {
          signatures: { 'account-1': 'Charles <CEO>\nhttps://soluce.eu' },
          identities: { 'account-1': [{ id: 'identity-1', name: '', email: 'info@example.com', signature: 'Team' }] },
        },
        version: 0,
      }),
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().signatures['account-1']).toEqual({
      html: 'Charles &lt;CEO&gt;<br><a href="https://soluce.eu">https://soluce.eu</a>',
      text: 'Charles <CEO>\nhttps://soluce.eu',
    });
    expect(useSettingsStore.getState().identities['account-1'][0].signature).toEqual({ html: 'Team', text: 'Team' });
  });

  it('keeps a logo-only signature and drops a blank one', () => {
    const logo = { html: '<img src="https://soluce.eu/logo.png">', text: '' };
    useSettingsStore.getState().setSignature('account-1', logo);
    expect(useSettingsStore.getState().signatures['account-1']).toEqual(logo);
    const backgroundLogo = { html: '<td style="background-image: url(&quot;https://soluce.eu/logo.png&quot;)"></td>', text: '' };
    useSettingsStore.getState().setSignature('account-1', backgroundLogo);
    expect(useSettingsStore.getState().signatures['account-1']).toEqual(backgroundLogo);
    useSettingsStore.getState().setSignature('account-1', { html: '<br>', text: ' ' });
    expect(useSettingsStore.getState().signatures['account-1']).toBeUndefined();
  });

  it('persists identities and forgets them with their account', () => {
    const support = { id: 'identity-1', name: 'Support', email: 'info@example.com', signature: { html: '', text: '' } };
    const contact = { id: 'identity-2', name: '', email: 'contact@example.com', signature: { html: 'Contact', text: 'Contact' } };
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
