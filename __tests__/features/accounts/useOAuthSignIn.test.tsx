import { act, renderHook } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { Authentication, CoreError } from '@openmailbox/mail-core';

import { queryClient, queryKeys } from '@/core/queryClient';
import { PROVIDERS } from '@/features/accounts/providers';
import { useOAuthSignIn } from '@/features/accounts/useOAuthSignIn';
import i18n from '@/utils/i18n';

import { core, makeAccount } from '../../helpers/fixtures';

const MICROSOFT = PROVIDERS.find((provider) => provider.identifier === 'microsoft')!;
const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const SIGN_IN = { url: 'https://login.microsoftonline.com/authorize', redirectUri: 'openmailbox://oauth' };
const ANSWER = 'openmailbox://oauth?code=c&state=s';

function setup() {
  const onDone = jest.fn();
  const hook = renderHook(() => useOAuthSignIn(onDone));
  return { ...hook, onDone };
}

describe('OAuth sign-in', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient.clear();
    core.beginSignIn.mockReturnValue(SIGN_IN);
  });

  it('signs in on the provider page and adds the account, busy until it is added', async () => {
    const account = makeAccount({ id: 'account-7', email: 'alice@outlook.com', authentication: Authentication.Microsoft });
    let finish: (account: ReturnType<typeof makeAccount>) => void = () => undefined;
    openAuthSession.mockResolvedValue({ type: 'success', url: ANSWER });
    core.addOauthAccount.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    core.listAccounts.mockResolvedValue([account]);
    const { result, onDone } = setup();

    let signing: Promise<void> = Promise.resolve();
    await act(async () => {
      signing = result.current.signIn(MICROSOFT);
    });
    expect(result.current.pending).toBe('microsoft');
    await act(async () => {
      finish(account);
      await signing;
    });

    expect(core.beginSignIn).toHaveBeenCalledWith(Authentication.Microsoft, undefined);
    expect(openAuthSession).toHaveBeenCalledWith(SIGN_IN.url, SIGN_IN.redirectUri);
    expect(core.addOauthAccount).toHaveBeenCalledWith(ANSWER, '');
    expect(queryClient.getQueryData(queryKeys.accounts)).toEqual([account]);
    expect(onDone).toHaveBeenCalledWith(account);
    expect(result.current.pending).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('stays quiet when the sign-in page is closed or cancelled', async () => {
    openAuthSession.mockResolvedValue({ type: 'cancel' });
    const { result, onDone } = setup();

    await act(() => result.current.signIn(MICROSOFT));
    expect(core.addOauthAccount).not.toHaveBeenCalled();

    openAuthSession.mockResolvedValue({ type: 'success', url: ANSWER });
    core.addOauthAccount.mockRejectedValue(new CoreError.Cancelled());
    await act(() => result.current.signIn(MICROSOFT));

    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows what the provider answered when it refuses', async () => {
    openAuthSession.mockResolvedValue({ type: 'success', url: ANSWER });
    core.addOauthAccount.mockRejectedValue(new CoreError.Server({ message: 'Need admin approval' }));
    const { result, onDone } = setup();

    await act(() => result.current.signIn(MICROSOFT));

    expect(result.current.error).toContain('Need admin approval');
    expect(onDone).not.toHaveBeenCalled();
  });
});
