import { useEffect } from 'react';

import { useAccounts, useMailboxes } from '@/core/hooks';
import { registerBackgroundCheck } from '@/services/backgroundCheck';
import { askNotificationPermissionIfNeverAsked, inboxUnreadCount, updateBadge } from '@/services/notifications';
import { useSettingsStore } from '@/stores/settingsStore';

export function NotificationBridge() {
  const unread = inboxUnreadCount(useMailboxes());
  const hasAccount = useAccounts().length > 0;
  const notificationsEnabled = useSettingsStore((state) => state.notificationsEnabled);

  useEffect(() => {
    if (hasAccount && notificationsEnabled) askNotificationPermissionIfNeverAsked().catch(() => undefined);
  }, [hasAccount, notificationsEnabled]);

  useEffect(() => {
    updateBadge(unread).catch(() => undefined);
  }, [unread]);

  useEffect(() => {
    if (hasAccount) registerBackgroundCheck().catch(() => undefined);
  }, [hasAccount]);

  return null;
}
