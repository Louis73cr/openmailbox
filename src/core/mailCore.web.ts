import { MailCore, type MailCoreLike } from '@openmailbox/mail-core';

let instance: MailCoreLike | null = null;

export function mailCore(): MailCoreLike {
  instance ??= MailCore.open('');
  return instance;
}

export function attachmentsDirectory(): string {
  return '';
}
