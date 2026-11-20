import { isBlankSignature, type Signature } from '@/stores/settingsStore';

import { escapeHtml } from './prefill';

export const MAIL_FONT = '-apple-system, Roboto, Helvetica, Arial, sans-serif';

const APP_NAME = 'Open Mailbox';
const APP_URL = 'https://openmailbox.eu';

export function signatureText(signature: Signature, footer: string): string {
  const parts = [signature.text, footer.trim() ? `${footer} (${APP_URL})` : ''].filter((part) => part.trim());
  return parts.length > 0 ? `\n\n-- \n${parts.join('\n\n')}` : '';
}

export function signatureHtml(signature: Signature, footer: string): string {
  const own = isBlankSignature(signature) ? '' : `<div>${signature.html}</div>`;
  const footerStyle = own ? ' style="margin-top: 16px"' : '';
  const linkedFooter = escapeHtml(footer).replace(APP_NAME, `<a href="${APP_URL}">${APP_NAME}</a>`);
  return own + (footer.trim() ? `<div${footerStyle}>${linkedFooter}</div>` : '');
}

export function mailHtml(inner: string): string {
  return `<div style="font-family: ${MAIL_FONT}; font-size: 15px">${inner}</div>`;
}
