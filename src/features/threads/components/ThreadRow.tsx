import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Flag, Paperclip, Reply } from 'lucide-react-native';
import type { ThreadSummary } from '@openmailbox/mail-core';

import { ContactAvatar } from '@/features/avatars/ContactAvatar';
import { Checkbox, Typography } from '@/ui/components';
import { displayName } from '@/utils/addresses';
import { formatListDate } from '@/utils/dates';
import { haptic, ImpactFeedbackStyle } from '@/utils/haptics';
import { useInPane, useSelectedThreadId } from '@/navigation/pane';

interface ThreadRowProps {
  thread: ThreadSummary;
  accountAccent?: string;
  onOpen: (thread: ThreadSummary) => void;
  onLongPress?: (thread: ThreadSummary) => void;
  selected?: boolean;
}

function ThreadRowImpl({ thread, accountAccent, onOpen, onLongPress, selected }: ThreadRowProps) {
  const open = useSelectedThreadId() === thread.threadId;
  /** Desktop split view: denser rows, mouse-sized. */
  const c = useInPane() ? compact : null;
  const { colors } = useTheme();
  const { t } = useTranslation();
  const sender = thread.latest.from[0];
  const senderName = displayName(sender) || t('threads.unknownSender');
  const unread = thread.unreadCount > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[unread ? t('threads.unread') : null, thread.latest.isAnswered ? t('threads.replied') : null, senderName, thread.latest.subject, formatListDate(thread.lastReceivedAt)].filter(Boolean).join(', ')}
      onPress={() => onOpen(thread)}
      onLongPress={
        onLongPress
          ? () => {
              haptic(ImpactFeedbackStyle.Medium);
              onLongPress(thread);
            }
          : undefined
      }
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        c?.row,
        { backgroundColor: pressed || open ? colors.pressed : colors.background },
      ]}
    >
      {selected !== undefined ? (
        <View style={styles.checkbox}>
          <Checkbox checked={selected} onPress={() => onOpen(thread)} accessibilityLabel={senderName} />
        </View>
      ) : null}
      <View style={[styles.indicator, c?.indicator]}>
        {unread ? (
          <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
        ) : thread.latest.isAnswered ? (
          <Reply size={15} strokeWidth={2.5} color={colors.primary} />
        ) : null}
      </View>
      <ContactAvatar email={sender?.email} name={senderName} size={c ? 30 : 40} />
      <View style={[styles.content, c?.content, { borderBottomColor: colors.border }]}>
        <View style={styles.line}>
          {accountAccent ? <View style={[styles.accountDot, { backgroundColor: accountAccent }]} /> : null}
          <View style={styles.senderLine}>
            <Typography numberOfLines={1} style={[styles.sender, c?.sender, { color: colors.text, fontWeight: unread ? '700' : '600' }]}>
              {senderName}
            </Typography>
            {thread.messageCount > 1 ? (
              <Typography style={[styles.count, { color: colors.textSecondary }]}>{thread.messageCount}</Typography>
            ) : null}
          </View>
          <Typography style={[styles.date, c?.small, { color: colors.textSecondary }]}>{formatListDate(thread.lastReceivedAt)}</Typography>
          {c ? null : <ChevronRight size={14} color={colors.textTertiary} />}
        </View>
        <View style={styles.line}>
          <Typography numberOfLines={1} style={[styles.subject, c?.subject, { color: colors.text, fontWeight: unread ? '600' : '400' }]}>
            {thread.latest.subject || t('reader.noSubject')}
          </Typography>
          {thread.hasAttachment ? <Paperclip size={13} color={colors.textTertiary} /> : null}
          {thread.isFlagged ? <Flag size={13} color={colors.warning} fill={colors.warning} /> : null}
        </View>
        <Typography numberOfLines={c ? 1 : 2} style={[styles.preview, c?.small, { color: colors.textSecondary }]}>
          {thread.latest.preview ?? ''}
        </Typography>
      </View>
    </Pressable>
  );
}

export const ThreadRow = memo(ThreadRowImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 12 },
  checkbox: { paddingLeft: 14, paddingTop: 20 },
  indicator: { width: 22, alignItems: 'center', paddingTop: 16 },
  unreadDot: { width: 9, height: 9, borderRadius: 4.5 },
  content: { flex: 1, marginLeft: 10, paddingRight: 16, paddingBottom: 12, gap: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountDot: { width: 7, height: 7, borderRadius: 3.5 },
  senderLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  sender: { flexShrink: 1, fontSize: 16, lineHeight: 21 },
  count: { fontSize: 14, fontWeight: '400' },
  date: { fontSize: 14, fontWeight: '400' },
  subject: { flex: 1, fontSize: 15, lineHeight: 20 },
  preview: { fontSize: 14, lineHeight: 19, fontWeight: '400' },
});

const compact = StyleSheet.create({
  row: { paddingTop: 7 },
  indicator: { width: 18, paddingTop: 11 },
  content: { marginLeft: 8, paddingRight: 12, paddingBottom: 7, gap: 0 },
  sender: { fontSize: 13.5, lineHeight: 18 },
  subject: { fontSize: 13, lineHeight: 17 },
  small: { fontSize: 12, lineHeight: 16 },
});
