// Web: the browser Notification API; the "badge" is the unread count in the tab title.
import { MailboxRole, type Mailbox, type NewMessage } from '@openmailbox/mail-core';
import { router, type Href } from 'expo-router';

import { UNIFIED_SCOPE } from '@/core/queryClient';
import { displayName } from '@/utils/addresses';
import i18n from '@/utils/i18n';

const SUMMARY_THRESHOLD = 3;
const TITLE = 'Open Mailbox';

type NotificationData = { threadId?: string; mailboxId?: string };

export function inboxUnreadCount(mailboxes: Mailbox[]): number {
  return mailboxes
    .filter((mailbox) => mailbox.role === MailboxRole.Inbox)
    .reduce((total, mailbox) => total + mailbox.unreadCount, 0);
}

export async function updateBadge(unread: number): Promise<boolean> {
  document.title = unread > 0 ? `(${unread}) ${TITLE}` : TITLE;
  return true;
}

const supported = () => typeof Notification !== 'undefined';

export async function requestNotificationPermission(): Promise<boolean> {
  if (!supported()) return false;
  return Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted';
}

export async function askNotificationPermissionIfNeverAsked(): Promise<void> {
  if (supported() && Notification.permission === 'default') await requestNotificationPermission();
}

function show(title: string, body: string, data: NotificationData) {
  const notification = new Notification(title, { body, icon: '/favicon.ico', tag: data.threadId });
  notification.onclick = () => {
    window.focus();
    router.push(notificationRoute(data));
    notification.close();
  };
}

export async function notifyNewMessages(messages: NewMessage[], { silencedAccountIds }: { silencedAccountIds: string[] }) {
  if (!supported() || Notification.permission !== 'granted') return;
  const shown = messages.filter(({ email }) => !email.isSeen && !silencedAccountIds.includes(email.accountId));
  if (shown.length > SUMMARY_THRESHOLD) {
    const senders = [...new Set(shown.map(({ email }) => displayName(email.from[0])))].join(', ');
    show(i18n.t('notifications.newMessages', { count: shown.length }), senders, {});
    return;
  }
  for (const { mailboxId, email } of shown) {
    const subject = email.subject || i18n.t('reader.noSubject');
    show(displayName(email.from[0]) || i18n.t('threads.unknownSender'), `${subject}\n${email.preview ?? ''}`, {
      threadId: email.threadId,
      mailboxId,
    });
  }
}

export function notificationRoute(data: NotificationData): Href {
  return data.threadId && data.mailboxId
    ? { pathname: '/thread/[threadId]', params: { threadId: data.threadId, mailboxId: data.mailboxId } }
    : `/mailbox/${UNIFIED_SCOPE}`;
}
