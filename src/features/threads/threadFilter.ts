import type { TFunction } from 'i18next';
import type { ThreadFilter } from '@openmailbox/mail-core';

export interface FilterCriteria {
  unread: boolean;
  flagged: boolean;
  toMe: boolean;
  ccMe: boolean;
  withAttachment: boolean;
  today: boolean;
  excludedAccountIds: string[];
}

export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  unread: true,
  flagged: false,
  toMe: false,
  ccMe: false,
  withAttachment: false,
  today: false,
  excludedAccountIds: [],
};

const SUMMARY_LABELS = [
  ['unread', 'threads.filters.unread'],
  ['flagged', 'threads.filters.flagged'],
  ['toMe', 'threads.filters.toMe'],
  ['ccMe', 'threads.filters.ccMe'],
  ['withAttachment', 'threads.filters.attachmentsShort'],
  ['today', 'threads.filters.todayShort'],
] as const;

function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function coreFilter(criteria: FilterCriteria, accountIds: string[], unified: boolean, now: Date): ThreadFilter {
  const included = unified ? accountIds.filter((id) => !criteria.excludedAccountIds.includes(id)) : [];
  return {
    unread: criteria.unread,
    flagged: criteria.flagged,
    toMe: criteria.toMe,
    ccMe: criteria.ccMe,
    withAttachment: criteria.withAttachment,
    since: criteria.today ? startOfDay(now) : undefined,
    accountIds: included,
    keepThreadIds: [],
  };
}

export function filterSummary(criteria: FilterCriteria, t: TFunction): string {
  const labels = SUMMARY_LABELS.filter(([key]) => criteria[key]).map(([, label]) => t(label));
  return labels.length > 0 ? labels.join(', ') : t('threads.filters.allMail');
}
