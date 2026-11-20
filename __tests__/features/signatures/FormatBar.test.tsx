import { fireEvent, screen } from '@testing-library/react-native';

import { FormatBar, INITIAL_EDITOR_STATE } from '@/features/signatures/FormatBar';
import i18n from '@/utils/i18n';

import { renderWithProviders } from '../../helpers/render';

const noop = () => undefined;

describe('FormatBar', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('shows list tools only in the keyboard bar', () => {
    const { rerender } = renderWithProviders(<FormatBar state={INITIAL_EDITOR_STATE} onCommand={noop} onLink={noop} onSize={noop} onColor={noop} />);
    expect(screen.queryByRole('button', { name: 'Bulleted List' })).toBeNull();
    rerender(<FormatBar compact state={INITIAL_EDITOR_STATE} onCommand={noop} onLink={noop} onSize={noop} onColor={noop} />);
    expect(screen.getByRole('button', { name: 'Bulleted List' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Numbered List' })).toBeOnTheScreen();
  });

  it('lights the list under the cursor', () => {
    renderWithProviders(<FormatBar compact state={{ ...INITIAL_EDITOR_STATE, ul: true }} onCommand={noop} onLink={noop} onSize={noop} onColor={noop} />);
    expect(screen.getByRole('button', { name: 'Bulleted List' })).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByRole('button', { name: 'Numbered List' })).toHaveProp('accessibilityState', { selected: false });
  });

  it('sends list commands', () => {
    const onCommand = jest.fn();
    renderWithProviders(<FormatBar compact state={INITIAL_EDITOR_STATE} onCommand={onCommand} onLink={noop} onSize={noop} onColor={noop} />);
    fireEvent.press(screen.getByRole('button', { name: 'Numbered List' }));
    expect(onCommand).toHaveBeenCalledWith('insertOrderedList');
  });
});
