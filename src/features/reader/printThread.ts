import { Alert } from 'react-native';
import * as Print from 'expo-print';
import type { EmailSummary, RenderedBody, ThreadSummary } from '@openmailbox/mail-core';

import { mailCore } from '@/core/mailCore';
import { queryClient, queryKeys } from '@/core/queryClient';
import { escapeHtml } from '@/features/composer/prefill';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatAddressList } from '@/utils/addresses';
import { formatFullDate } from '@/utils/dates';
import i18n from '@/utils/i18n';

import { documentFor, PAGE } from './readerPage';

function header(label: string, value: string): string {
  return value ? `<div><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</div>` : '';
}

export function threadPrintHtml(emails: EmailSummary[], bodies: RenderedBody[], allowRemote: boolean): string {
  const messages = emails.map((email, index) => {
    const body = bodies[index];
    const content = body?.html ?? `<pre>${escapeHtml(body?.text ?? '')}</pre>`;
    return `<section style="break-inside: avoid-page; margin-bottom: 24px">
<h2 style="font-size: 18px; margin: 0 0 8px">${escapeHtml(email.subject ?? '')}</h2>
<div style="font-size: 13px; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid ${PAGE.light.rule}">
${header(i18n.t('compose.headerFrom'), formatAddressList(email.from))}
${header(i18n.t('compose.headerTo'), formatAddressList(email.to))}
${header(i18n.t('compose.cc'), formatAddressList(email.cc))}
${header('', formatFullDate(email.receivedAt))}
</div>
${content}
</section>`;
  });
  return documentFor(messages.join('\n'), allowRemote, PAGE.light);
}

export async function printThread(thread: ThreadSummary): Promise<void> {
  let html: string;
  try {
    const emails = await mailCore().threadEmails(thread.threadId, thread.mailboxId);
    const bodies = await Promise.all(
      emails.map((email) =>
        queryClient.fetchQuery({ queryKey: queryKeys.body(email.id), queryFn: () => mailCore().body(email.id), staleTime: Infinity }),
      ),
    );
    html = threadPrintHtml(emails, bodies, useSettingsStore.getState().loadRemoteImages);
  } catch {
    Alert.alert(i18n.t('reader.printFailed'));
    return;
  }
  await Print.printAsync({ html }).catch(() => undefined);
}
