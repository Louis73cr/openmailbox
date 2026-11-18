import { fireEvent, screen } from '@testing-library/react-native';

import FiltersScreen from '../../app/filters';
import { queryClient, queryKeys } from '@/core/queryClient';
import { DEFAULT_FILTER_CRITERIA } from '@/features/threads/threadFilter';
import { useSettingsStore } from '@/stores/settingsStore';
import i18n from '@/utils/i18n';

import { makeAccount } from '../helpers/fixtures';
import { renderWithProviders } from '../helpers/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: { unified?: string } = { unified: '1' };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => mockRouter,
  router: { back: () => mockRouter.back(), replace: (href: string) => mockRouter.replace(href), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));

const criteria = () => useSettingsStore.getState().filterCriteria;

describe('filters sheet', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { unified: '1' };
    useSettingsStore.setState({ filterCriteria: DEFAULT_FILTER_CRITERIA, accountNames: {} });
    queryClient.setQueryData(queryKeys.accounts, [
      makeAccount(),
      makeAccount({ id: 'account-2', email: 'bob@example.com', displayName: 'Bob' }),
    ]);
  });

  it('includes every account and lets one be left out', () => {
    renderWithProviders(<FiltersScreen />);
    expect(screen.getByText('INCLUDE MAIL FROM')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'bob@example.com', selected: true })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(criteria().excludedAccountIds).toEqual(['account-2']);
    expect(screen.getByRole('button', { name: 'bob@example.com', selected: false })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'alice@example.com' }));
    expect(criteria().excludedAccountIds).toEqual(['account-2']);

    fireEvent.press(screen.getByRole('button', { name: 'bob@example.com' }));
    expect(criteria().excludedAccountIds).toEqual([]);
  });

  it('shows no accounts outside All Inboxes', () => {
    mockParams = {};
    renderWithProviders(<FiltersScreen />);
    expect(screen.queryByText('INCLUDE MAIL FROM')).toBeNull();
  });

  it('checks criteria and switches the toggles', () => {
    renderWithProviders(<FiltersScreen />);
    expect(screen.getByRole('button', { name: 'Unread', selected: true })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Flagged' }));
    fireEvent.press(screen.getByRole('button', { name: 'Cc: Me' }));
    fireEvent(screen.getByLabelText('Only Mail Sent Today'), 'valueChange', true);
    expect(criteria()).toMatchObject({ unread: true, flagged: true, ccMe: true, toMe: false, today: true });
  });

  it('closes with the done button', () => {
    renderWithProviders(<FiltersScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
