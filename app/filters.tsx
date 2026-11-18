import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, Flag, Inbox, Mail, Paperclip } from 'lucide-react-native';

import { useAccounts } from '@/core/hooks';
import { accountName } from '@/features/accounts/accountName';
import type { FilterCriteria } from '@/features/threads/threadFilter';
import { useSettingsStore } from '@/stores/settingsStore';
import { FormSection, IconButton, ListRow, ScreenHeader, Toggle, Typography, ViewContainer } from '@/ui/components';
import { NATIVE_CHROME } from '@/ui/nativeChrome';

type CheckedCriterion = 'unread' | 'flagged' | 'toMe' | 'ccMe';
type ToggledCriterion = 'withAttachment' | 'today';

function RecipientBadge({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.badge, { borderColor: colors.textSecondary }]}>
      <Typography variant="caption" color={colors.textSecondary} style={styles.badgeText}>
        {text}
      </Typography>
    </View>
  );
}

export default function FiltersScreen() {
  const { unified } = useLocalSearchParams<{ unified?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accounts = useAccounts();
  const accountNames = useSettingsStore((state) => state.accountNames);
  const criteria = useSettingsStore((state) => state.filterCriteria);
  const setCriteria = useSettingsStore((state) => state.setFilterCriteria);
  const excluded = criteria.excludedAccountIds;
  const includedCount = accounts.filter((account) => !excluded.includes(account.id)).length;

  const toggleAccount = (accountId: string) => {
    if (excluded.includes(accountId)) setCriteria({ excludedAccountIds: excluded.filter((id) => id !== accountId) });
    else if (includedCount > 1) setCriteria({ excludedAccountIds: [...excluded, accountId] });
  };

  const checkRow = (title: string, selected: boolean, leading: React.ReactNode, onPress: () => void, key?: string) => (
    <ListRow
      key={key}
      title={title}
      leading={leading}
      chevron={false}
      onPress={onPress}
      accessibilityState={{ selected }}
      trailing={selected ? <Check size={20} color={colors.primary} /> : null}
    />
  );
  const criterionRow = (criterion: CheckedCriterion, leading: React.ReactNode) =>
    checkRow(t(`threads.filters.${criterion}`), criteria[criterion], leading, () =>
      setCriteria({ [criterion]: !criteria[criterion] } as Partial<FilterCriteria>),
    );
  const toggleRow = (criterion: ToggledCriterion, label: string, leading: React.ReactNode) => (
    <ListRow
      title={label}
      leading={leading}
      trailing={
        <Toggle
          value={criteria[criterion]}
          onValueChange={(value) => setCriteria({ [criterion]: value } as Partial<FilterCriteria>)}
          accessibilityLabel={label}
        />
      }
    />
  );

  const close = () => router.back();
  const content = (
    <ScrollView contentContainerStyle={styles.scroll} contentInsetAdjustmentBehavior="automatic">
      {unified ? (
        <FormSection title={t('threads.filters.includeFrom')}>
          {accounts.map((account) =>
            checkRow(
              accountName(account, accountNames),
              !excluded.includes(account.id),
              <Inbox size={22} color={colors.primary} />,
              () => toggleAccount(account.id),
              account.id,
            ),
          )}
        </FormSection>
      ) : null}
      <FormSection title={t('threads.filters.include')}>
        {criterionRow('unread', <Mail size={22} color={colors.primary} />)}
        {criterionRow('flagged', <Flag size={22} color={colors.warning} fill={colors.warning} />)}
      </FormSection>
      <FormSection title={t('threads.filters.addressed')}>
        {criterionRow('toMe', <RecipientBadge text="TO" />)}
        {criterionRow('ccMe', <RecipientBadge text="CC" />)}
      </FormSection>
      <FormSection>
        {toggleRow('withAttachment', t('threads.filters.attachments'), <Paperclip size={22} color={colors.primary} />)}
        {toggleRow('today', t('threads.filters.today'), <CalendarDays size={22} color={colors.primary} />)}
      </FormSection>
    </ScrollView>
  );

  if (NATIVE_CHROME) {
    return (
      <>
        {content}
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel={t('threads.selectDone')} onPress={close} />
        </Stack.Toolbar>
      </>
    );
  }

  return (
    <ViewContainer grouped>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <ScreenHeader
          title={t('threads.filters.title')}
          right={
            <IconButton round size={40} accessibilityLabel={t('threads.selectDone')} onPress={close}>
              <Check size={20} color={colors.primary} />
            </IconButton>
          }
        />
        {content}
      </SafeAreaView>
    </ViewContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: 8, paddingBottom: 40, paddingHorizontal: 16, gap: 28 },
  badge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 3 },
  badgeText: { fontSize: 10, fontWeight: '600' },
});
