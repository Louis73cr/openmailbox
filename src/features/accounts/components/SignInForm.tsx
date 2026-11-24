import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react-native';
import { Security, type Account, type ServerEndpoint } from '@openmailbox/mail-core';

import { Button, FormField, FormSection, IconButton, SegmentedControl, Typography } from '@/ui/components';

import type { MailProvider } from '../providers';
import { useAccountSetup } from '../useAccountSetup';
import { useOAuthSignIn } from '../useOAuthSignIn';
import { ProviderMark } from './ProviderMark';
import { SignInError } from './SignInError';

function EndpointSection({
  title,
  hostPlaceholder,
  endpoint,
  onChange,
}: {
  title: string;
  hostPlaceholder: string;
  endpoint: ServerEndpoint;
  onChange: (endpoint: ServerEndpoint) => void;
}) {
  const { t } = useTranslation();
  return (
    <FormSection title={title}>
      <FormField
        label={t('accounts.setup.host')}
        value={endpoint.host}
        onChangeText={(host) => onChange({ ...endpoint, host: host.trim() })}
        placeholder={hostPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <FormField
        label={t('accounts.setup.port')}
        value={endpoint.port ? String(endpoint.port) : ''}
        onChangeText={(port) => onChange({ ...endpoint, port: Number(port.replace(/\D/g, '')) || 0 })}
        keyboardType="number-pad"
      />
      <View style={styles.segmentRow}>
        <Typography variant="body1" weight="400" style={styles.segmentLabel}>
          {t('accounts.setup.security')}
        </Typography>
        <View style={styles.flex}>
          <SegmentedControl
            accessibilityLabel={t('accounts.setup.security')}
            value={endpoint.security}
            onChange={(security) => onChange({ ...endpoint, security })}
            options={[
              { value: Security.Tls, label: 'SSL/TLS' },
              { value: Security.StartTls, label: 'STARTTLS' },
            ]}
          />
        </View>
      </View>
    </FormSection>
  );
}

function ProviderButton({
  provider,
  label,
  loading,
  onPress,
}: {
  provider: MailProvider;
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  const { dark } = useTheme();
  const palette = dark ? BRANDED_DARK : BRANDED_LIGHT;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.brandedButton,
        { backgroundColor: palette.background, borderColor: palette.border },
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.text} />
      ) : (
        <ProviderMark brand={provider.brand} size={20} bare />
      )}
      <Typography variant="body1" weight="600" color={palette.text}>
        {label}
      </Typography>
    </Pressable>
  );
}

const BRANDED_LIGHT = { background: '#FFFFFF', border: '#747775', text: '#1F1F1F' };
const BRANDED_DARK = { background: '#131314', border: '#8E918F', text: '#E3E3E3' };

interface SignInFormProps {
  provider: MailProvider;
  onDone: (account: Account) => void;
}

export function SignInForm({ provider, onDone }: SignInFormProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const setup = useAccountSetup(provider, onDone);
  const oauth = useOAuthSignIn(onDone);
  const [withPassword, setWithPassword] = useState(!provider.oauth);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const host = setup.servers?.imap.host;
  const status =
    setup.phase === 'discovering'
      ? t('accounts.setup.discovering')
      : setup.phase === 'connecting'
        ? t('accounts.setup.connectingTo', { host })
        : null;
  const statusRow = status ? (
    <View style={styles.status} accessibilityLiveRegion="polite">
      <ActivityIndicator size="small" color={colors.textSecondary} />
      <Typography variant="caption" color={colors.textSecondary}>
        {status}
      </Typography>
    </View>
  ) : null;

  if (!withPassword) {
    return (
      <View style={styles.form}>
        <ProviderButton
          provider={provider}
          label={t('accounts.setup.signInWith', { provider: provider.name })}
          loading={oauth.pending !== null}
          onPress={() => oauth.signIn(provider)}
        />
        {oauth.error ? <SignInError message={oauth.error} /> : null}
        <Typography variant="caption" color={colors.textSecondary} align="center" style={styles.privacy}>
          {t('accounts.setup.oauthPrivacy', { provider: provider.name })}
        </Typography>
        <Button
          variant="link"
          title={t('accounts.setup.useAppPassword')}
          disabled={oauth.pending !== null}
          onPress={() => setWithPassword(true)}
        />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <FormSection
        footer={
          provider.appPasswordHelp ? (
            <View style={styles.footer}>
              <Typography variant="caption" color={colors.textSecondary} style={styles.footerText}>
                {t('accounts.setup.appPasswordHint', { provider: provider.name })}
              </Typography>
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(provider.appPasswordHelp!)}>
                <Typography variant="caption" color="primary" weight="600" style={styles.footerText}>
                  {t('accounts.setup.appPasswordLink')}
                </Typography>
              </Pressable>
            </View>
          ) : undefined
        }
      >
        <FormField
          label={t('accounts.setup.name')}
          value={setup.displayName}
          onChangeText={setup.setDisplayName}
          placeholder={t('accounts.setup.namePlaceholder')}
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
        <FormField
          label={t('accounts.setup.email')}
          value={setup.email}
          onChangeText={setup.setEmail}
          placeholder={provider.domains[0] ? `${t('accounts.setup.emailPlaceholderUser')}@${provider.domains[0]}` : t('accounts.setup.emailPlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <FormField
          label={t('accounts.setup.password')}
          value={setup.password}
          onChangeText={setup.setPassword}
          placeholder={provider.appPasswordHelp ? t('accounts.setup.appPasswordPlaceholder') : t('accounts.setup.required')}
          secureTextEntry={!passwordVisible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => setup.canSubmit && setup.submit()}
          trailing={
            <IconButton
              variant="plain"
              size={36}
              accessibilityLabel={passwordVisible ? t('accounts.setup.hidePassword') : t('accounts.setup.showPassword')}
              onPress={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeOff size={18} color={colors.textTertiary} /> : <Eye size={18} color={colors.textTertiary} />}
            </IconButton>
          }
        />
      </FormSection>

      {setup.error ? <SignInError message={setup.error} /> : null}

      {setup.manual && setup.servers ? (
        <>
          <EndpointSection
            title={t('accounts.setup.incoming')}
            hostPlaceholder="imap.example.com"
            endpoint={setup.servers.imap}
            onChange={(imap) => setup.setServers({ ...setup.servers!, imap })}
          />
          <EndpointSection
            title={t('accounts.setup.outgoing')}
            hostPlaceholder="smtp.example.com"
            endpoint={setup.servers.smtp}
            onChange={(smtp) => setup.setServers({ ...setup.servers!, smtp })}
          />
          <FormSection title={t('accounts.setup.authentication')}>
            <FormField
              label={t('accounts.setup.username')}
              value={setup.servers.username}
              onChangeText={(username) => setup.setServers({ ...setup.servers!, username: username.trim() })}
              placeholder={setup.email}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </FormSection>
        </>
      ) : null}

      <View style={styles.actions}>
        <Button title={t('accounts.setup.signIn')} size="large" disabled={!setup.canSubmit} onPress={setup.submit} />
        {statusRow ?? (!setup.manual ? (
          <Button variant="link" title={t('accounts.setup.manual')} disabled={setup.busy} onPress={setup.showManualSettings} />
        ) : null)}
      </View>

      <Typography variant="caption" color={colors.textSecondary} align="center" style={styles.privacy}>
        {t('accounts.setup.privacy')}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  flex: { flex: 1 },
  footer: { marginHorizontal: 16, marginTop: 6, gap: 2 },
  footerText: { fontSize: 13, lineHeight: 18 },
  segmentRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 16, gap: 8 },
  segmentLabel: { width: 116, fontSize: 16 },
  actions: { gap: 4 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 40 },
  privacy: { marginTop: 8, paddingHorizontal: 24, fontSize: 12 },
  brandedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 54,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 22,
  },
  pressed: { opacity: 0.7 },
});
