import { EMPTY_THREAD_FILTER } from '@/core/hooks';
import { coreFilter, DEFAULT_FILTER_CRITERIA, filterSummary, type FilterCriteria } from '@/features/threads/threadFilter';
import i18n from '@/utils/i18n';

const NONE: FilterCriteria = { ...DEFAULT_FILTER_CRITERIA, unread: false };
const AFTERNOON = new Date(2026, 10, 18, 14, 0);

describe('thread filter', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('starts with unread mail only', () => {
    expect(DEFAULT_FILTER_CRITERIA).toEqual({
      unread: true,
      flagged: false,
      toMe: false,
      ccMe: false,
      withAttachment: false,
      today: false,
      excludedAccountIds: [],
    });
  });

  it('turns the criteria into the core filter', () => {
    expect(coreFilter({ ...NONE, flagged: true, toMe: true, ccMe: true, withAttachment: true }, [], false, AFTERNOON)).toEqual({
      ...EMPTY_THREAD_FILTER,
      flagged: true,
      toMe: true,
      ccMe: true,
      withAttachment: true,
    });
  });

  it('keeps mail from local midnight on for today', () => {
    expect(coreFilter({ ...NONE, today: true }, [], false, AFTERNOON).since).toBe(new Date(2026, 10, 18).getTime());
  });

  it('lists the included accounts in All Inboxes only', () => {
    const criteria = { ...NONE, excludedAccountIds: ['b', 'gone'] };
    expect(coreFilter(criteria, ['a', 'b'], true, AFTERNOON).accountIds).toEqual(['a']);
    expect(coreFilter(criteria, ['a', 'b'], false, AFTERNOON).accountIds).toEqual([]);
    expect(coreFilter({ ...NONE, excludedAccountIds: ['a'] }, ['a'], true, AFTERNOON).accountIds).toEqual([]);
  });

  it('sums up the criteria in sheet order', () => {
    expect(filterSummary({ ...DEFAULT_FILTER_CRITERIA, flagged: true }, i18n.t)).toBe('Unread, Flagged');
    expect(filterSummary({ ...NONE, today: true, ccMe: true }, i18n.t)).toBe('Cc: Me, Today');
    expect(filterSummary(NONE, i18n.t)).toBe('All Mail');
  });
});
