import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, useTheme } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useTranslation } from 'react-i18next';
import { LogIn, Plus, RefreshCw } from 'lucide-react-native';
import { Authentication, CoreError, Security, type ServerEndpoint } from '@openmailbox/mail-core';

import { useAccounts } from '@/core/hooks';
import { mailCore } from '@/core/mailCore';
import { queryClient, queryKeys } from '@/core/queryClient';
import { deleteSecret, saveSecret } from '@/core/secrets';
import { accountName } from '@/features/accounts/accountName';
import { describeCoreError } from '@/features/accounts/coreErrors';
import { ProviderMark } from '@/features/accounts/components/ProviderMark';
import { providerForAccount, providerName } from '@/features/accounts/providers';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { SignatureSection } from '@/features/signatures/SignatureSection';
import { useSyncFailureMessage, useSyncLabel } from '@/features/sync/useSyncLabel';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { Button, FormField, FormSection, ListRow, Typography } from '@/ui/components';
import { goBack } from '@/utils/navigation';

const NO_SIGNATURE = { html: '', text: '' };

function describeEndpoint(endpoint: ServerEndpoint): string {
  return `${endpoint.host}:${endpoint.port} · ${endpoint.security === Security.Tls ? 'SSL/TLS' : 'STARTTLS'}`;
}

export default function AccountSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const account = useAccounts().find((candidate) => candidate.id === id);
  const authRequired = useSyncStore((state) => state.authRequired[id] === true);
  const syncLabel = useSyncLabel([id]);
  const syncFailure = useSyncFailureMessage(id);
  const [displayName, setDisplayName] = useState(account?.displayName ?? '');
  const [password, setPassword] = useState('');
  const signature = useSettingsStore((state) => state.signatures[id]) ?? NO_SIGNATURE;
  const setSignature = useSettingsStore((state) => state.setSignature);
  const identities = useSettingsStore((state) => state.identities[id]) ?? [];
  const accountNames = useSettingsStore((state) => state.accountNames);
  const setAccountName = useSettingsStore((state) => state.setAccountName);
  const [updating, setUpdating] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ text: string; failed: boolean } | null>(null);

  if (!account) return <SettingsPage title="">{null}</SettingsPage>;

  const saveName = () => {
    const trimmed = displayName.trim();
    if (trimmed && trimmed !== account.displayName) mailCore().renameAccount(account.id, trimmed).catch(() => undefined);
  };

  const updatePassword = async () => {
    setUpdating(true);
    setPasswordMessage(null);
    try {
      await mailCore().updatePassword(account.id, password);
      await saveSecret(account.id, password);
      useSyncStore.getState().setAuthRequired(account.id, false);
      setPassword('');
      setPasswordMessage({ text: t('accounts.passwordUpdated'), failed: false });
    } catch (error) {
      setPasswordMessage({ text: describeCoreError(error, t), failed: true });
    } finally {
      setUpdating(false);
    }
  };

  const signInAgain = async () => {
    setUpdating(true);
    setPasswordMessage(null);
    try {
      const request = mailCore().beginSignIn(account.authentication, account.email);
      const answer = await WebBrowser.openAuthSessionAsync(request.url, request.redirectUri);
      if (answer.type !== 'success') return;
      await mailCore().reauthorize(account.id, answer.url);
      useSyncStore.getState().setAuthRequired(account.id, false);
      setPasswordMessage({ text: t('accounts.signedIn'), failed: false });
    } catch (error) {
      if (!CoreError.Cancelled.instanceOf(error)) setPasswordMessage({ text: describeCoreError(error, t), failed: true });
    } finally {
      setUpdating(false);
    }
  };

  const oauth = account.authentication !== Authentication.Password;
  const provider = providerName(account);

  const remove = () =>
    Alert.alert(t('accounts.removeTitle'), t('accounts.removeMessage', { email: account.email }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('accounts.remove'),
        style: 'destructive',
        onPress: async () => {
          await mailCore().removeAccount(account.id);
          await deleteSecret(account.id);
          useSettingsStore.getState().forgetAccount(account.id);
          await queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
          goBack();
        },
      },
    ]);

  return (
    <SettingsPage title={accountName(account, accountNames)}>
      <FormSection footer={t('accounts.namesHint')}>
        <FormField
          label={t('accounts.accountName')}
          value={accountNames[account.id] ?? ''}
          placeholder={account.email}
          onChangeText={(text) => setAccountName(account.id, text)}
          returnKeyType="done"
        />
        <FormField
          label={t('accounts.senderName')}
          value={displayName}
          placeholder={t('accounts.setup.namePlaceholder')}
          onChangeText={setDisplayName}
          onBlur={saveName}
          onSubmitEditing={saveName}
          returnKeyType="done"
        />
      </FormSection>

      <FormSection footer={syncFailure ? `${syncLabel} · ${syncFailure}` : (syncLabel ?? undefined)}>
        <FormField
          label={t('accounts.setup.email')}
          value={account.email}
          editable={false}
          style={{ color: colors.textSecondary }}
        />
        <ListRow
          title={t('accounts.syncNow')}
          leading={<RefreshCw size={20} color={colors.primary} />}
          chevron={false}
          onPress={() => mailCore().syncNow(account.id)}
        />
      </FormSection>

      <FormSection title={t('accounts.servers')}>
        <ListRow
          title={t('accounts.provider')}
          detail={providerName(account)}
          leading={<ProviderMark brand={providerForAccount(account)?.provider.brand} size={28} />}
          chevron={false}
        />
        <ListRow title={t('accounts.setup.incoming')} subtitle={describeEndpoint(account.imap)} />
        <ListRow title={t('accounts.setup.outgoing')} subtitle={describeEndpoint(account.smtp)} />
        <ListRow title={t('accounts.setup.username')} subtitle={account.username} />
      </FormSection>

      <SignatureSection value={signature} footer={t('accounts.signatureHint')} onChange={(next) => setSignature(account.id, next)} />

      <FormSection title={t('accounts.identities')} footer={t('accounts.identitiesHint')}>
        {identities.map((identity) => (
          <ListRow
            key={identity.id}
            title={identity.email}
            subtitle={identity.name || undefined}
            onPress={() => router.push({ pathname: '/settings/identity', params: { accountId: account.id, identityId: identity.id } })}
          />
        ))}
        <ListRow
          title={t('accounts.addIdentity')}
          leading={<Plus size={20} color={colors.primary} />}
          chevron={false}
          onPress={() => router.push({ pathname: '/settings/identity', params: { accountId: account.id } })}
        />
      </FormSection>

      <View style={styles.group}>
        {oauth ? (
          <FormSection
            title={provider}
            footer={authRequired ? t('accounts.signInRequired', { provider }) : t('accounts.oauthHint', { provider })}
          >
            <ListRow
              title={t('accounts.signInAgain')}
              leading={<LogIn size={20} color={colors.primary} />}
              chevron={false}
              disabled={updating}
              onPress={signInAgain}
            />
          </FormSection>
        ) : (
          <FormSection
            title={t('accounts.password')}
            footer={authRequired ? t('accounts.reconnectRequired') : t('accounts.passwordHint')}
          >
            <FormField
              label={t('accounts.newPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="password"
            />
          </FormSection>
        )}
        {passwordMessage ? (
          <Typography variant="caption" color={passwordMessage.failed ? colors.danger : colors.textSecondary} style={styles.message}>
            {passwordMessage.text}
          </Typography>
        ) : null}
        {oauth ? null : (
          <Button title={t('accounts.updatePassword')} loading={updating} disabled={!password || updating} onPress={updatePassword} />
        )}
      </View>

      <FormSection>
        <ListRow title={t('accounts.remove')} destructive chevron={false} onPress={remove} />
      </FormSection>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  group: { gap: 12 },
  message: { marginHorizontal: 16 },
});
