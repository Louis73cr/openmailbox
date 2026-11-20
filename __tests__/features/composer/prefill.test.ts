import type { EmailSummary } from '@openmailbox/mail-core';

import { linkedHtml, prefill, quoteHtml } from '@/features/composer/prefill';

const labels = {
  wrote: (date: string, author: string) => `On ${date}, ${author} wrote:`,
  forwardedHeader: '-- Forwarded --',
  from: 'From:',
  date: 'Date:',
  subject: 'Subject:',
  to: 'To:',
};

const email = {
  id: '1',
  accountId: 'account',
  threadId: '1',
  subject: 'Re: Planning',
  from: [{ name: 'Bob', email: 'bob@example.com' }],
  to: [{ name: undefined, email: 'me@example.com' }, { name: 'Carol', email: 'carol@example.com' }],
  cc: [{ name: undefined, email: 'dave@example.com' }],
  preview: undefined,
  receivedAt: 0,
  isSeen: true,
  isFlagged: false,
  isAnswered: false,
  hasAttachment: false,
} as EmailSummary;

describe('prefill', () => {
  it('replies to all without including the user and keeps the subject prefix once', () => {
    const result = prefill('replyAll', email, 'Hello\n> earlier', ['me@example.com'], 'today', labels);
    expect(result.to.map((address) => address.email)).toEqual(['bob@example.com', 'carol@example.com']);
    expect(result.cc.map((address) => address.email)).toEqual(['dave@example.com']);
    expect(result.subject).toBe('Re: Planning');
    expect(result.body).toBe('\n\nOn today, Bob wrote:\n> Hello\n>> earlier');
  });

  it('replies to the original recipients when the message was sent by the user', () => {
    const sent = { ...email, from: [{ name: 'Me', email: 'ME@example.com' }], to: [{ name: 'Bob', email: 'bob@example.com' }] };
    expect(prefill('reply', sent, 'Hi', ['me@example.com'], 'today', labels).to).toEqual([{ name: 'Bob', email: 'bob@example.com' }]);
    expect(prefill('replyAll', sent, 'Hi', ['me@example.com'], 'today', labels).to.map((address) => address.email)).toEqual(['bob@example.com']);
    const noteToSelf = { ...sent, to: [{ name: undefined, email: 'me@example.com' }] };
    expect(prefill('reply', noteToSelf, 'Hi', ['me@example.com'], 'today', labels).to.map((address) => address.email)).toEqual(['ME@example.com']);
  });

  it('quotes the HTML original under the attribution, escaped', () => {
    const { body } = prefill('reply', { ...email, from: [{ name: 'Bob <&>', email: 'bob@example.com' }] }, 'Hi', [], 'today', labels);
    const html = quoteHtml('reply', body, '<b>Hi</b>');
    expect(html).toContain('<div>On today, Bob &lt;&amp;&gt; wrote:</div><blockquote type="cite"');
    expect(html).toContain('<b>Hi</b></blockquote>');
  });

  it('puts the forwarded header above the HTML original', () => {
    const { body } = prefill('forward', email, 'Hi', [], 'today', labels);
    expect(quoteHtml('forward', body, '<b>Hi</b>')).toBe(
      '<br><br><div>-- Forwarded --<br>From: Bob<br>Date: today<br>Subject: Re: Planning<br>To: me@example.com, Carol</div><br><b>Hi</b>',
    );
  });

  it('forwards with an empty recipient list and a header block', () => {
    const result = prefill('forward', email, 'Hello', ['me@example.com'], 'today', labels);
    expect(result.to).toEqual([]);
    expect(result.subject).toBe('Fwd: Re: Planning');
    expect(result.body).toContain('-- Forwarded --\nFrom: Bob');
  });
});

describe('linkedHtml', () => {
  it('escapes the text, links URLs and keeps line breaks', () => {
    expect(linkedHtml('Go https://x.eu/?a=1&b=2!\nNext')).toBe(
      'Go <a href="https://x.eu/?a=1&amp;b=2">https://x.eu/?a=1&amp;b=2</a>!<br>Next',
    );
  });

  it('keeps angle brackets and quotes around a URL out of the link', () => {
    expect(linkedHtml('See <https://openmailbox.eu/help>.')).toBe(
      'See &lt;<a href="https://openmailbox.eu/help">https://openmailbox.eu/help</a>&gt;.',
    );
    expect(linkedHtml('"https://x.eu/a"')).toBe('&quot;<a href="https://x.eu/a">https://x.eu/a</a>&quot;');
  });
});
