import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Slot, Stack, useGlobalSearchParams, usePathname, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react-native';

import { UNIFIED_SCOPE } from '@/core/queryClient';
import { PaneContext, SplitHiddenContext, useSplitLayout } from '@/navigation/pane';
import { EmptyState } from '@/ui/components';
import { setSplitBack } from '@/utils/navigation';
import { Sidebar } from '@/navigation/Sidebar';

import { MailboxScreen } from './mailbox/[id]';
import { ThreadScreen } from './thread/[threadId]';

const segment = (pathname: string, prefix: string) =>
  pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length).split('/')[0]) : undefined;

/** Desktop web: mailboxes | threads | open thread, driven by the same URLs as the phone stack. */
function MailSplit() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const pathname = usePathname();
  const { mailboxId } = useGlobalSearchParams<{ mailboxId?: string }>();
  const lastMailbox = useRef(UNIFIED_SCOPE);
  const routedMailbox = segment(pathname, '/mailbox/');
  if (routedMailbox) lastMailbox.current = routedMailbox;
  const threadId = segment(pathname, '/thread/');
  const mailbox = lastMailbox.current;

  useEffect(() => {
    setSplitBack(() => router.replace(`/mailbox/${encodeURIComponent(lastMailbox.current)}`));
    return () => setSplitBack(null);
  }, []);

  const border = { borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.border };
  return (
    <View style={styles.row}>
      <View style={[styles.sidebar, border]}>
        <Sidebar current={mailbox} />
      </View>
      <View style={[styles.list, border]}>
        <PaneContext.Provider value={{ params: { id: mailbox }, selectedThreadId: threadId }}>
          <MailboxScreen key={mailbox} />
        </PaneContext.Provider>
      </View>
      <View style={styles.reader}>
        {threadId ? (
          <PaneContext.Provider value={{ params: { threadId, mailboxId } }}>
            <ThreadScreen key={threadId} />
          </PaneContext.Provider>
        ) : (
          <EmptyState icon={<Mail size={40} color={colors.textSecondary} />} title={t('threads.noSelection')} />
        )}
      </View>
    </View>
  );
}

export default function MailLayout() {
  const { colors } = useTheme();
  if (!useSplitLayout()) {
    return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
  }
  return (
    <>
      <MailSplit />
      <SplitHiddenContext.Provider value>
        <Slot />
      </SplitHiddenContext.Provider>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 240 },
  list: { width: 420 },
  reader: { flex: 1 },
});
