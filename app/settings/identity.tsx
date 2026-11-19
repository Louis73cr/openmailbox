import { useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';
import { useLocalSearchParams, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAccounts } from '@/core/hooks';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button, FormField, FormSection, ListRow } from '@/ui/components';
import { isEmail } from '@/utils/addresses';
import { goBack } from '@/utils/navigation';

export default function IdentityScreen() {
  const { accountId, identityId } = useLocalSearchParams<{ accountId: string; identityId?: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const account = useAccounts().find((candidate) => candidate.id === accountId);
  const identities = useSettingsStore((state) => state.identities[accountId]) ?? [];
  const saveIdentity = useSettingsStore((state) => state.saveIdentity);
  const removeIdentity = useSettingsStore((state) => state.removeIdentity);
  const identity = identities.find((candidate) => candidate.id === identityId);
  const [name, setName] = useState(identity?.name ?? '');
  const [email, setEmail] = useState(identity?.email ?? '');
  const [signature, setSignature] = useState(identity?.signature ?? '');

  if (!account) return <SettingsPage title="">{null}</SettingsPage>;

  const save = () => {
    const address = email.trim();
    if (!isEmail(address)) {
      Alert.alert(t('accounts.invalidIdentityEmail'));
      return;
    }
    const taken = [account.email, ...identities.filter((other) => other.id !== identity?.id).map((other) => other.email)];
    if (taken.some((other) => other.toLowerCase() === address.toLowerCase())) {
      Alert.alert(t('accounts.identityExists'));
      return;
    }
    saveIdentity(account.id, { id: identity?.id ?? Date.now().toString(36), name: name.trim(), email: address, signature });
    goBack();
  };

  const remove = () =>
    Alert.alert(t('accounts.deleteIdentityTitle'), identity?.email, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('accounts.deleteIdentity'),
        style: 'destructive',
        onPress: () => {
          if (identity) removeIdentity(account.id, identity.id);
          goBack();
        },
      },
    ]);

  return (
    <SettingsPage title={identity?.email ?? t('accounts.newIdentity')}>
      <FormSection>
        <FormField label={t('accounts.senderName')} value={name} placeholder={account.displayName} onChangeText={setName} />
        <FormField
          label={t('accounts.setup.email')}
          value={email}
          placeholder={t('accounts.setup.emailPlaceholder')}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
        />
      </FormSection>

      <FormSection title={t('accounts.signature')} footer={t('accounts.identitySignatureHint')}>
        <TextInput
          value={signature}
          onChangeText={setSignature}
          accessibilityLabel={t('accounts.signature')}
          placeholder={t('accounts.signaturePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          textAlignVertical="top"
          style={[styles.signature, { color: colors.text }]}
        />
      </FormSection>

      <Button title={t('accounts.saveIdentity')} disabled={!email.trim()} onPress={save} />

      {identity ? (
        <FormSection>
          <ListRow title={t('accounts.deleteIdentity')} destructive chevron={false} onPress={remove} />
        </FormSection>
      ) : null}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  signature: { minHeight: 96, fontSize: 16, lineHeight: 22, paddingHorizontal: 16, paddingVertical: 12 },
});
