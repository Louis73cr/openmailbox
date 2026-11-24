// Web: no background tasks; while a tab is open, poll the server for mail not notified yet.
import { mailCore } from '@/core/mailCore';
import { useSettingsStore } from '@/stores/settingsStore';

import { notifyNewMessages } from './notifications';

const CHECK_BUDGET_MS = 10_000;
const INTERVAL_MS = 60_000;

export async function runBackgroundCheck(): Promise<'newData' | 'noData' | 'failed'> {
  try {
    const messages = await mailCore().checkNewMail(CHECK_BUDGET_MS);
    const { notificationsEnabled, silencedAccountIds } = useSettingsStore.getState();
    if (notificationsEnabled && document.hidden) await notifyNewMessages(messages, { silencedAccountIds });
    return messages.length > 0 ? 'newData' : 'noData';
  } catch {
    return 'failed';
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function registerBackgroundCheck(): Promise<void> {
  timer ??= setInterval(() => void runBackgroundCheck(), INTERVAL_MS);
}
