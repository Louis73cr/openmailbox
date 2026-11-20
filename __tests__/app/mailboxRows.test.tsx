import { act, screen } from '@testing-library/react-native';
import type { ThreadSummary } from '@openmailbox/mail-core';

import MailboxScreen from '../../app/mailbox/[id]';
import { queryClient, queryKeys } from '@/core/queryClient';
import { useSettingsStore } from '@/stores/settingsStore';
import i18n from '@/utils/i18n';

import { core, makeAccount, makeMailbox, makeThread } from '../helpers/fixtures';
import { renderWithProviders } from '../helpers/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockRowRenders = 0;
jest.mock('@/features/threads/components/SwipeableThreadRow', () => ({
  SwipeableThreadRow: jest.requireActual('react').memo(({ thread }: { thread: ThreadSummary }) => {
    mockRowRenders += 1;
    return jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, thread.latest.subject);
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'unified' }),
}));

describe('thread list rows', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('does not draw the rows again when the screen redraws for something else', async () => {
    queryClient.clear();
    queryClient.setQueryData(queryKeys.accounts, [makeAccount()]);
    queryClient.setQueryData(queryKeys.mailboxes, [makeMailbox()]);
    core.listThreads.mockResolvedValue({ threads: [makeThread()] });
    renderWithProviders(<MailboxScreen />);
    await screen.findByText('Lancement du projet Atlas');
    const before = mockRowRenders;

    await act(async () => useSettingsStore.setState({ accountNames: { 'account-1': 'Work' } }));
    expect(mockRowRenders).toBe(before);
  });
});
