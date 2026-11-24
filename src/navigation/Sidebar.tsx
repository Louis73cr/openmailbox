import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Inbox, Settings, SquarePen, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { MailboxRole, type Account, type Mailbox } from '@openmailbox/mail-core';

import { useAccounts, useMailboxes } from '@/core/hooks';
import { UNIFIED_SCOPE } from '@/core/queryClient';
import { accountName } from '@/features/accounts/accountName';
import { mailboxBadge, mailboxIcon, mailboxName, visibleFolders } from '@/features/mailboxes/mailboxPresentation';
import { useSyncLabel } from '@/features/sync/useSyncLabel';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { accountColor } from '@/theme';

/** react-native-web adds `hovered` to the Pressable state. */
type Hover = { pressed: boolean; hovered?: boolean };

interface RowProps {
  icon: LucideIcon;
  title: string;
  badge?: number;
  depth?: number;
  selected?: boolean;
  disabled?: boolean;
  iconColor?: string;
  expanded?: boolean;
  onToggle?: () => void;
  onPress?: () => void;
}

function Row({ icon: Icon, title, badge, depth = 0, selected, disabled, iconColor, expanded, onToggle, onPress }: RowProps) {
  const { colors } = useTheme();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed }: Hover) => [
        styles.row,
        { paddingLeft: 8 + Math.min(depth, 4) * 14 },
        selected ? { backgroundColor: `${colors.primary}26` } : hovered || pressed ? { backgroundColor: colors.pressed } : null,
      ]}
    >
      <View style={styles.toggle}>
        {onToggle ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={6} onPress={onToggle}>
            <Chevron size={13} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <Icon size={16} color={disabled ? colors.textTertiary : (iconColor ?? colors.primary)} />
      <Text numberOfLines={1} style={[styles.title, { color: disabled ? colors.textTertiary : colors.text }, selected && styles.bold]}>
        {title}
      </Text>
      {badge ? <Text style={[styles.badge, { color: colors.textSecondary }, selected && styles.bold]}>{badge}</Text> : null}
    </Pressable>
  );
}

function AccountSection({ account, name, mailboxes, current }: { account: Account; name: string; mailboxes: Mailbox[]; current: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const collapsedIds = useSettingsStore((state) => state.collapsedIds);
  const toggleCollapsed = useSettingsStore((state) => state.toggleCollapsed);
  const folders = useMemo(() => visibleFolders(mailboxes, collapsedIds), [mailboxes, collapsedIds]);
  const authRequired = useSyncStore((state) => state.authRequired[account.id] === true);
  const collapsed = collapsedIds.includes(account.id);
  const Chevron = collapsed ? ChevronRight : ChevronDown;

  return (
    <View style={styles.section}>
      <Pressable accessibilityRole="button" onPress={() => toggleCollapsed(account.id)} style={styles.sectionHeader}>
        <View style={[styles.dot, { backgroundColor: accountColor(account.color) }]} />
        <Text numberOfLines={1} style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          {name}
        </Text>
        <Chevron size={13} color={colors.textSecondary} />
      </Pressable>
      {authRequired ? (
        <Row
          icon={TriangleAlert}
          iconColor={colors.warning}
          title={t('accounts.reconnectRequired')}
          onPress={() => router.push(`/settings/account/${account.id}`)}
        />
      ) : null}
      {collapsed
        ? null
        : folders.map(({ mailbox, parent }) => (
            <Row
              key={mailbox.id}
              icon={mailboxIcon(mailbox)}
              title={mailboxName(mailbox, t)}
              badge={mailbox.selectable ? mailboxBadge(mailbox) : undefined}
              depth={mailbox.depth}
              disabled={!mailbox.selectable}
              selected={mailbox.id === current}
              expanded={parent ? !collapsedIds.includes(mailbox.id) : undefined}
              onToggle={parent ? () => toggleCollapsed(mailbox.id) : undefined}
              onPress={() => router.push(`/mailbox/${mailbox.id}`)}
            />
          ))}
    </View>
  );
}

/** Compact desktop sidebar of the split layout; the phone keeps the full mailboxes screen. */
export function Sidebar({ current }: { current: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const accounts = useAccounts();
  const mailboxes = useMailboxes();
  const accountNames = useSettingsStore((state) => state.accountNames);
  const syncLabel = useSyncLabel(accounts.map((account) => account.id));
  const unifiedUnread = mailboxes
    .filter((mailbox) => mailbox.role === MailboxRole.Inbox)
    .reduce((total, inbox) => total + inbox.unreadCount, 0);

  if (accounts.length === 0) return <Redirect href="/onboarding" />;

  return (
    <View style={[styles.root, { backgroundColor: colors.groupedBackground }]}>
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/compose')}
          style={({ hovered }: Hover) => [styles.compose, { backgroundColor: colors.primary, opacity: hovered ? 0.9 : 1 }]}
        >
          <SquarePen size={16} color={colors.primaryText} />
          <Text style={[styles.composeText, { color: colors.primaryText }]}>{t('compose.newMessage')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          onPress={() => router.push('/settings')}
          style={({ hovered }: Hover) => [styles.settings, hovered && { backgroundColor: colors.pressed }]}
        >
          <Settings size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Row
          icon={Inbox}
          title={t('mailboxes.allInboxes')}
          badge={unifiedUnread}
          selected={current === UNIFIED_SCOPE}
          onPress={() => router.push(`/mailbox/${UNIFIED_SCOPE}`)}
        />
        {accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            name={accountName(account, accountNames)}
            mailboxes={mailboxes.filter((mailbox) => mailbox.accountId === account.id)}
            current={current}
          />
        ))}
      </ScrollView>
      {syncLabel ? <Text style={[styles.sync, { color: colors.textTertiary }]}>{syncLabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12 },
  compose: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 34, borderRadius: 8 },
  composeText: { fontSize: 14, fontWeight: '600' },
  settings: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 8, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingRight: 10, borderRadius: 6 },
  toggle: { width: 13, marginRight: -4 },
  title: { flex: 1, fontSize: 13.5 },
  bold: { fontWeight: '600' },
  badge: { fontSize: 12, fontVariant: ['tabular-nums'] },
  section: { marginTop: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  sectionTitle: { flex: 1, fontSize: 11.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  sync: { fontSize: 11, paddingHorizontal: 16, paddingVertical: 8 },
});
