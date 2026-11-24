import type { Attachment } from '@openmailbox/mail-core';

import { mailCore } from '@/core/mailCore';

export const VIEWABLE_ON_IOS: string[] = [];

export async function openAttachment(emailId: string, attachment: Attachment): Promise<void> {
  window.open(await mailCore().saveAttachment(emailId, attachment.index, ''), '_blank', 'noopener');
}
