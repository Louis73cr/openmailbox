import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { CoreError, type Account } from '@openmailbox/mail-core';

import { mailCore } from '@/core/mailCore';
import { queryClient, queryKeys } from '@/core/queryClient';

import { describeCoreError } from './coreErrors';
import type { MailProvider, ProviderIdentifier } from './providers';

export function useOAuthSignIn(onDone: (account: Account) => void) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<ProviderIdentifier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (provider: MailProvider) => {
    if (!provider.oauth) return;
    setError(null);
    setPending(provider.identifier);
    try {
      const request = mailCore().beginSignIn(provider.oauth, undefined);
      const answer = await WebBrowser.openAuthSessionAsync(request.url, request.redirectUri);
      if (answer.type !== 'success') return;
      const account = await mailCore().addOauthAccount(answer.url, '');
      queryClient.setQueryData(queryKeys.accounts, await mailCore().listAccounts());
      onDone(account);
    } catch (failure) {
      if (!CoreError.Cancelled.instanceOf(failure)) setError(describeCoreError(failure, t));
    } finally {
      setPending(null);
    }
  };

  return { signIn, pending, error };
}
