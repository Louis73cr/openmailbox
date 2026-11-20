import { MAIL_FONT, mailHtml, signatureHtml, signatureText } from '@/features/composer/signature';

const CHARLES = { html: '<b>Charles</b>', text: 'Charles' };
const BLANK = { html: '', text: '' };
const FOOTER = 'Sent from Open Mailbox';
const FOOTER_TEXT = 'Sent from Open Mailbox (https://openmailbox.eu)';

describe('signatureText', () => {
  it('puts the signature and the footer after the standard separator', () => {
    expect(signatureText(CHARLES, FOOTER)).toBe(`\n\n-- \nCharles\n\n${FOOTER_TEXT}`);
  });

  it('skips blank parts, and the separator when both are blank', () => {
    expect(signatureText(BLANK, FOOTER)).toBe(`\n\n-- \n${FOOTER_TEXT}`);
    expect(signatureText(CHARLES, '')).toBe('\n\n-- \nCharles');
    expect(signatureText(BLANK, '')).toBe('');
  });
});

describe('signatureHtml', () => {
  it('keeps the signature markup and links Open Mailbox in the footer', () => {
    expect(signatureHtml(CHARLES, FOOTER)).toBe(
      '<div><b>Charles</b></div><div style="margin-top: 16px">Sent from <a href="https://openmailbox.eu">Open Mailbox</a></div>',
    );
  });

  it('keeps a logo-only signature and skips blank parts', () => {
    expect(signatureHtml({ html: '<img src="https://soluce.eu/logo.png">', text: '' }, '')).toBe('<div><img src="https://soluce.eu/logo.png"></div>');
    expect(signatureHtml(BLANK, '')).toBe('');
  });
});

describe('mailHtml', () => {
  it('sets the mail font', () => {
    expect(mailHtml('Hi')).toBe(`<div style="font-family: ${MAIL_FONT}; font-size: 15px">Hi</div>`);
  });
});

describe('footer in other languages', () => {
  it('links the app name wherever the translation puts it', () => {
    expect(signatureHtml(BLANK, 'Отправлено из Open Mailbox')).toBe('<div>Отправлено из <a href="https://openmailbox.eu">Open Mailbox</a></div>');
    expect(signatureText(BLANK, 'Envoyé depuis Open Mailbox')).toBe('\n\n-- \nEnvoyé depuis Open Mailbox (https://openmailbox.eu)');
  });
});
