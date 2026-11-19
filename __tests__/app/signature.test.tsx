import { Alert } from 'react-native';
import { fireEvent, screen } from '@testing-library/react-native';

import SignatureScreen from '../../app/signature';
import { useSignatureEditor } from '@/features/signatures/signatureEditorStore';
import i18n from '@/utils/i18n';

import { renderWithProviders } from '../helpers/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => mockRouter,
  router: { back: () => mockRouter.back(), replace: (href: string) => mockRouter.replace(href), canGoBack: () => true },
}));

const { injectJavaScript } = jest.requireMock('react-native-webview') as { injectJavaScript: jest.Mock };
const injected = () => injectJavaScript.mock.calls.map(([code]) => code).join('\n');
const state = (patch: Record<string, unknown>) =>
  fireEvent(screen.getByTestId('web-view'), 'message', {
    nativeEvent: { data: JSON.stringify({ type: 'state', bold: false, italic: false, underline: false, strike: false, link: null, empty: false, ...patch }) },
  });

const finish = (html: string, text: string) =>
  fireEvent(screen.getByTestId('web-view'), 'message', { nativeEvent: { data: JSON.stringify({ type: 'done', html, text }) } });

describe('signature editor', () => {
  const onDone = jest.fn();

  beforeAll(() => i18n.changeLanguage('en'));

  beforeEach(() => {
    jest.clearAllMocks();
    useSignatureEditor.getState().open({ html: '<b>Charles</b>', text: 'Charles' }, onDone);
  });

  it('hands the edited signature back and closes', () => {
    renderWithProviders(<SignatureScreen />);
    expect(screen.getByTestId('web-view').props.source.html).toContain('<b>Charles</b>');
    finish('<b>C</b>', 'C');
    expect(onDone).toHaveBeenCalledWith({ html: '<b>C</b>', text: 'C' });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('refuses a signature over 32 KB', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderWithProviders(<SignatureScreen />);
    finish(`<p>${'a'.repeat(33 * 1024)}</p>`, 'a');
    expect(alert).toHaveBeenCalledWith(i18n.t('signature.tooLarge'));
    expect(onDone).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('closes without saving on cancel', () => {
    renderWithProviders(<SignatureScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDone).not.toHaveBeenCalled();
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('switches to the HTML code view and back, hiding the format bar while editing code', () => {
    renderWithProviders(<SignatureScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'HTML' }));
    expect(injected()).toContain('window.editor.setMode("code")');
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'HTML' }));
    expect(injected()).toContain('window.editor.setMode("rich")');
    expect(screen.getByRole('button', { name: 'Bold' })).toBeOnTheScreen();
  });

  it('lights up the tools for the text under the cursor', () => {
    renderWithProviders(<SignatureScreen />);
    expect(screen.getByRole('button', { name: 'Bold' })).not.toBeSelected();
    state({ bold: true, strike: true });
    expect(screen.getByRole('button', { name: 'Bold' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Strikethrough' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Italic' })).not.toBeSelected();
  });

  it('edits or removes the link under the cursor', () => {
    renderWithProviders(<SignatureScreen />);
    state({ link: 'https://a.eu' });
    fireEvent.press(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByDisplayValue('https://a.eu')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Remove Link' }));
    expect(injected()).toContain('window.editor.run("unlink", null)');
  });

  it('sets the text size from a sheet, the title in bold', () => {
    renderWithProviders(<SignatureScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Text Size' }));
    fireEvent.press(screen.getByText('Large'));
    expect(injected()).toContain('window.editor.run("size", 18)');
    fireEvent.press(screen.getByRole('button', { name: 'Text Size' }));
    fireEvent.press(screen.getByText('Title'));
    expect(injected()).toContain('window.editor.run("size", 22)');
  });

  it('colours and highlights text from the palette', () => {
    renderWithProviders(<SignatureScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Text Color' }));
    fireEvent.press(screen.getByRole('button', { name: 'Black' }));
    expect(injected()).toContain('window.editor.run("foreColor", "#1a1a1a")');
    fireEvent.press(screen.getByRole('button', { name: 'Highlight' }));
    fireEvent.press(screen.getByRole('button', { name: 'Yellow' }));
    expect(injected()).toContain('window.editor.run("hiliteColor", "#fef08a")');
  });

  it('saves from the code view too', () => {
    renderWithProviders(<SignatureScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'HTML' }));
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(injected()).toContain('window.editor.finish()');
  });
});
