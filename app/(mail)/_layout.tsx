import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, Slot, Stack, useGlobalSearchParams, usePathname, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react-native';

import { UNIFIED_SCOPE } from '@/core/queryClient';
import { getPaneThreads, PaneContext, runThreadCommand, SplitHiddenContext, useSplitLayout, type PaneThread, type ThreadCommand } from '@/navigation/pane';
import { EmptyState } from '@/ui/components';
import { setSplitBack } from '@/utils/navigation';
import { Sidebar } from '@/navigation/Sidebar';

import { MailboxScreen } from './mailbox/[id]';
import { ThreadScreen } from './thread/[threadId]';

const threadHref = ({ threadId, mailboxId }: PaneThread) => ({ pathname: '/thread/[threadId]' as const, params: { threadId, mailboxId } });

const COMMAND_KEYS: Record<string, ThreadCommand> = {
  Delete: 'delete',
  Backspace: 'delete',
  e: 'archive',
  r: 'reply',
  a: 'replyAll',
  f: 'forward',
  s: 'flag',
  u: 'markUnread',
  m: 'move',
};

function typing(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].includes(element.tagName));
}

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
  const openThread = useRef(threadId);
  openThread.current = threadId;
  const openIndex = useRef(-1);
  if (threadId) {
    const index = getPaneThreads().findIndex((thread) => thread.threadId === threadId);
    if (index >= 0) openIndex.current = index;
  }

  useEffect(() => {
    // Leaving a thread (delete, archive, move…) opens the next one, like a desktop mail client.
    setSplitBack(() => {
      if (!openThread.current) return false;
      const threads = getPaneThreads();
      const index = openIndex.current;
      const next = [threads[index], threads[index + 1], threads[index - 1]].find(
        (thread) => thread && thread.threadId !== openThread.current,
      );
      if (next) router.replace(threadHref(next));
      else router.replace(`/mailbox/${encodeURIComponent(lastMailbox.current)}`);
      return true;
    });
    return () => setSplitBack(null);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const path = window.location.pathname;
      if (!(path === '/' || path.startsWith('/mailbox/') || path.startsWith('/thread/'))) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const threads = getPaneThreads();
      const index = openThread.current ? threads.findIndex((thread) => thread.threadId === openThread.current) : -1;
      const step = key === 'ArrowDown' || key === 'j' ? 1 : key === 'ArrowUp' || key === 'k' ? -1 : 0;
      if (step) {
        const target = threads[index < 0 ? 0 : Math.min(Math.max(index + step, 0), threads.length - 1)];
        if (target && target.threadId !== openThread.current) router.replace(threadHref(target));
      } else if (key === 'Escape' && openThread.current) {
        router.replace(`/mailbox/${encodeURIComponent(lastMailbox.current)}`);
      } else if (key === 'c' || key === 'n') {
        router.push('/compose');
      } else if (key === '/') {
        router.push('/search');
      } else if (COMMAND_KEYS[key] && openThread.current) {
        runThreadCommand(COMMAND_KEYS[key]);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
