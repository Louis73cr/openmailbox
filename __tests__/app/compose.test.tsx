import { Alert, TextInput } from 'react-native';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import ComposeScreen from '../../app/compose';
import { queryClient, queryKeys } from '@/core/queryClient';
import { forwardedAttachments, pickAttachments } from '@/features/composer/attachments';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUndoStore } from '@/stores/undoStore';
import i18n from '@/utils/i18n';

import { core, makeAccount, makeEmail } from '../helpers/fixtures';
import { renderWithProviders } from '../helpers/render';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => mockRouter,
  router: { back: () => mockRouter.back(), replace: (href: string) => mockRouter.replace(href), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/features/composer/attachments', () => ({
  ...jest.requireActual('@/features/composer/attachments'),
  pickAttachments: jest.fn(),
  forwardedAttachments: jest.fn(async () => []),
}));

const sig = (text: string) => ({ html: text, text });
const DEVIS = { path: '/cache/Devis.pdf', filename: 'Devis.pdf', mimeType: 'application/pdf', size: 52_224 };

async function pickFiles(picked: typeof DEVIS[]) {
  (pickAttachments as jest.Mock).mockResolvedValueOnce(picked);
  fireEvent.press(screen.getByRole('button', { name: i18n.t('compose.attach') }));
  await act(async () => fireEvent.press(await screen.findByText(i18n.t('compose.attachFiles'))));
}

async function sendTo(address: string) {
  fireEvent.changeText(screen.getByLabelText('To'), address);
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
  await waitFor(() => expect(core.send).toHaveBeenCalled());
  return core.send.mock.calls[0][0];
}

describe('composer', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    queryClient.clear();
    useSettingsStore.setState({ defaultAccountId: null, signatures: {}, sentFromFooter: false });
    queryClient.setQueryData(queryKeys.accounts, [makeAccount()]);
  });

  describe('attachments', () => {
    it('attaches picked files and lets them go again', async () => {
      renderWithProviders(<ComposeScreen />);
      await pickFiles([DEVIS]);
      expect(screen.getByText('Devis.pdf')).toBeOnTheScreen();
      expect(screen.getByText('51 KB')).toBeOnTheScreen();

      fireEvent.press(screen.getByRole('button', { name: i18n.t('compose.removeAttachment', { name: 'Devis.pdf' }) }));
      expect(screen.queryByText('Devis.pdf')).toBeNull();
    });

    it('refuses files that would go past 25 MB', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      renderWithProviders(<ComposeScreen />);
      await pickFiles([DEVIS]);
      await pickFiles([{ ...DEVIS, filename: 'Scan.pdf', size: 26_200_000 }]);
      expect(alert).toHaveBeenCalledWith(i18n.t('compose.attachmentsTooLarge'));
      expect(screen.queryByText('Scan.pdf')).toBeNull();
      expect(screen.getByText('Devis.pdf')).toBeOnTheScreen();
    });

    it("keeps the original's attachments when forwarding", async () => {
      mockParams = { mode: 'forward', emailId: 'email-1', threadId: 'thread-1', mailboxId: 'mailbox-inbox' };
      core.threadEmails.mockResolvedValue([makeEmail({ hasAttachment: true })]);
      const original = [{ index: 0, filename: 'Plan.pdf', mimeType: 'application/pdf', size: 1_000 }];
      core.body.mockResolvedValue({ text: 'Voici le plan.', hasRemoteContent: false, attachments: original });
      (forwardedAttachments as jest.Mock).mockResolvedValue([{ ...DEVIS, filename: 'Plan.pdf', size: 1_000 }]);
      renderWithProviders(<ComposeScreen />);

      expect(await screen.findByText('Plan.pdf')).toBeOnTheScreen();
      expect(forwardedAttachments).toHaveBeenCalledWith('email-1', original);
    });

    it("waits for the original's attachments before a forward can be sent, keeping files picked meanwhile", async () => {
      mockParams = { mode: 'forward', emailId: 'email-1', threadId: 'thread-1', mailboxId: 'mailbox-inbox' };
      core.threadEmails.mockResolvedValue([makeEmail({ hasAttachment: true })]);
      const original = [{ index: 0, filename: 'Plan.pdf', mimeType: 'application/pdf', size: 1_000 }];
      core.body.mockResolvedValue({ text: 'Voici le plan.', hasRemoteContent: false, attachments: original });
      let finish: (attachments: (typeof DEVIS)[]) => void = () => undefined;
      (forwardedAttachments as jest.Mock).mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithProviders(<ComposeScreen />);
      await waitFor(() => expect(forwardedAttachments).toHaveBeenCalled());
      fireEvent.changeText(screen.getByLabelText('To'), 'bob@example.org');

      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      await pickFiles([DEVIS]);
      await act(async () => finish([{ ...DEVIS, path: '/cache/Plan.pdf', filename: 'Plan.pdf', size: 1_000 }]));

      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
      expect(screen.getByText('Plan.pdf')).toBeOnTheScreen();
      expect(screen.getByText('Devis.pdf')).toBeOnTheScreen();
    });

    it("says when the original's attachments could not be downloaded", async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      mockParams = { mode: 'forward', emailId: 'email-1', threadId: 'thread-1', mailboxId: 'mailbox-inbox' };
      core.threadEmails.mockResolvedValue([makeEmail({ hasAttachment: true })]);
      const original = [{ index: 0, filename: 'Plan.pdf', mimeType: 'application/pdf', size: 1_000 }];
      core.body.mockResolvedValue({ text: 'Voici le plan.', hasRemoteContent: false, attachments: original });
      (forwardedAttachments as jest.Mock).mockRejectedValue(new Error('offline'));
      renderWithProviders(<ComposeScreen />);

      await waitFor(() => expect(alert).toHaveBeenCalledWith(i18n.t('compose.forwardedAttachmentsFailed')));
      fireEvent.changeText(screen.getByLabelText('To'), 'bob@example.org');
      expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    it('sends the attached files', async () => {
      renderWithProviders(<ComposeScreen />);
      fireEvent.changeText(screen.getByLabelText('To'), 'bob@example.org');
      await pickFiles([DEVIS]);
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
      await waitFor(() => expect(core.send).toHaveBeenCalled());
      expect(core.send.mock.calls[0][0].attachments).toEqual([
        { path: '/cache/Devis.pdf', filename: 'Devis.pdf', mimeType: 'application/pdf' },
      ]);
    });
  });

  describe('recipients', () => {
    it('blocks sending while an address is invalid', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      renderWithProviders(<ComposeScreen />);
      fireEvent.changeText(screen.getByLabelText('To'), 'bob@');
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
      expect(alert).toHaveBeenCalledWith(i18n.t('compose.invalidAddresses'), 'bob@');
      expect(core.send).not.toHaveBeenCalled();
    });

    it('sends to the chips and to what is still typed', async () => {
      renderWithProviders(<ComposeScreen />);
      fireEvent.changeText(screen.getByLabelText('To'), 'claire@atlas.example,');
      fireEvent.changeText(screen.getByLabelText('To'), 'nadia@x.org');
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
      await waitFor(() => expect(core.send).toHaveBeenCalled());
      expect(core.send.mock.calls[0][0].to.map((address: { email: string }) => address.email)).toEqual([
        'claire@atlas.example',
        'nadia@x.org',
      ]);
      expect(useUndoStore.getState().entry).toEqual({ label: 'Message sent', moves: [] });
    });
  });

  describe('signatures', () => {
    const CHARLES = { html: '<b>Charles</b>', text: 'Charles' };
    const FOOTER = 'Sent from Open Mailbox (https://openmailbox.eu)';
    const FOOTER_LINK = 'Sent from <a href="https://openmailbox.eu">Open Mailbox</a>';

    it('keeps the body for the message and sends the signature and the linked footer below it', async () => {
      useSettingsStore.setState({ signatures: { 'account-1': CHARLES }, sentFromFooter: true });
      renderWithProviders(<ComposeScreen />);
      expect(screen.getByPlaceholderText('Message').props.value).toBe('');
      fireEvent.changeText(screen.getByPlaceholderText('Message'), 'Hi https://soluce.eu');
      const draft = await sendTo('bob@example.org');
      expect(draft.bodyText).toBe(`Hi https://soluce.eu\n\n-- \nCharles\n\n${FOOTER}`);
      expect(draft.bodyHtml).toMatch(/^<div style="font-family: /);
      expect(draft.bodyHtml).toContain('Hi <a href="https://soluce.eu">https://soluce.eu</a>');
      expect(draft.bodyHtml).toContain('<b>Charles</b>');
      expect(draft.bodyHtml).toContain(FOOTER_LINK);
    });

    it('leaves the signature and the footer out once removed from the message', async () => {
      useSettingsStore.setState({ signatures: { 'account-1': CHARLES }, sentFromFooter: true });
      renderWithProviders(<ComposeScreen />);
      fireEvent.changeText(screen.getByPlaceholderText('Message'), 'Hi');
      fireEvent.press(await screen.findByRole('button', { name: 'Remove Signature' }));
      const draft = await sendTo('bob@example.org');
      expect(draft.bodyText).toBe('Hi');
      expect(draft.bodyHtml).not.toContain('Charles');
      expect(draft.bodyHtml).not.toContain('openmailbox.eu');
    });

    it("sends the new sender's signature after the sender changes", async () => {
      queryClient.setQueryData(queryKeys.accounts, [makeAccount(), makeAccount({ id: 'account-2', email: 'charles@soluce.example' })]);
      useSettingsStore.setState({ signatures: { 'account-1': sig('Alice'), 'account-2': sig('Charles, Soluce') } });
      renderWithProviders(<ComposeScreen />);
      fireEvent.press(screen.getByText(/Cc\/Bcc/));
      fireEvent.press(screen.getByRole('button', { name: 'From' }));
      fireEvent.press(await screen.findByText('charles@soluce.example'));
      expect((await sendTo('bob@example.org')).bodyText).toBe('\n\n-- \nCharles, Soluce');
    });

    it('puts the quote of a plain-text reply in the HTML part too', async () => {
      mockParams = { mode: 'reply', emailId: 'email-1', threadId: 'thread-1', mailboxId: 'mailbox-inbox' };
      core.threadEmails.mockResolvedValue([makeEmail()]);
      core.body.mockResolvedValue({ text: 'Bonjour', hasRemoteContent: false, attachments: [] });
      Object.assign(TextInput.prototype, { setSelection: jest.fn() });
      renderWithProviders(<ComposeScreen />);
      await screen.findByText(/> Bonjour/);
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
      await waitFor(() => expect(core.send).toHaveBeenCalled());
      expect(core.send.mock.calls[0][0].bodyHtml).toContain('&gt; Bonjour');
    });
  });

  describe('identities', () => {
    const support = { id: 'identity-1', name: 'Support', email: 'info@example.com', signature: sig('Support team') };

    beforeEach(() => {
      useSettingsStore.setState({ signatures: { 'account-1': sig('Alice') }, identities: { 'account-1': [support] } });
    });

    it('sends from the picked identity with its signature', async () => {
      renderWithProviders(<ComposeScreen />);
      fireEvent.press(screen.getByText(/Cc\/Bcc/));
      fireEvent.press(screen.getByRole('button', { name: 'From' }));
      fireEvent.press(await screen.findByText('info@example.com'));
      const draft = await sendTo('bob@example.org');
      expect(draft.from).toEqual({ name: 'Support', email: 'info@example.com' });
      expect(draft.bodyText).toBe('\n\n-- \nSupport team');
    });

    it("sends from the account's own address without a sender", async () => {
      renderWithProviders(<ComposeScreen />);
      expect((await sendTo('bob@example.org')).from).toBeUndefined();
    });

    it('replies from the identity the original was sent to, leaving it out of the recipients', async () => {
      mockParams = { mode: 'replyAll', emailId: 'email-1', threadId: 'thread-1', mailboxId: 'mailbox-inbox' };
      core.threadEmails.mockResolvedValue([
        makeEmail({ to: [{ name: undefined, email: 'INFO@example.com' }, { name: 'Carol', email: 'carol@example.org' }] }),
      ]);
      core.body.mockResolvedValue({ text: 'Bonjour', hasRemoteContent: false, attachments: [] });
      Object.assign(TextInput.prototype, { setSelection: jest.fn() });
      renderWithProviders(<ComposeScreen />);

      expect(await screen.findByText('Cc/Bcc, From: info@example.com')).toBeOnTheScreen();
      await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Send' })));
      await waitFor(() => expect(core.send).toHaveBeenCalled());
      const draft = core.send.mock.calls[0][0];
      expect(draft.from).toEqual({ name: 'Support', email: 'info@example.com' });
      expect(draft.bodyText).toContain('-- \nSupport team');
      expect(draft.to.map((address: { email: string }) => address.email)).toEqual(['claire@atlas.example', 'carol@example.org']);
    });
  });
});
