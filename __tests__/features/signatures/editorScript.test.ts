/**
 * @jest-environment jsdom
 */
import { LINKIFY, SANITIZE } from '@/features/signatures/editorScript';

const sanitize = new Function(`${SANITIZE}; return sanitize;`)() as (root: HTMLElement) => void;
const linkifyText = new Function(`${LINKIFY}; return linkifyText;`)() as (root: HTMLElement) => void;

function clean(html: string): HTMLElement {
  document.body.innerHTML = html;
  sanitize(document.body);
  return document.body;
}

describe('sanitize', () => {
  it('drops scripts and event handlers', () => {
    expect(clean('<p onclick="x()">Hi<script>alert(1)</script></p>').innerHTML).toBe('<p>Hi</p>');
  });

  it('keeps https images only', () => {
    expect(clean('<img src="http://a/logo.png"><img src="https://a/logo.png" width="80">').innerHTML).toBe(
      '<img src="https://a/logo.png" width="80">',
    );
  });

  it('keeps only web, mail and phone links', () => {
    expect(clean('<a href="javascript:alert(1)">x</a><a href="mailto:a@b.c">m</a><a href="tel:+33">t</a>').innerHTML).toBe(
      '<a>x</a><a href="mailto:a@b.c">m</a><a href="tel:+33">t</a>',
    );
  });

  it('unwraps unknown elements and removes comments and style sheets', () => {
    expect(clean('<o:p>Kept</o:p><!-- note --><style>p{}</style><custom-tag><b>Bold</b></custom-tag>').innerHTML).toBe('Kept<b>Bold</b>');
  });

  it("drops Open Mailbox's forced dark-mode colours and sizes, keeping brand colours", () => {
    const body = clean(
      '<span style="color: rgb(241, 241, 241) !important; font-size: 18px !important; font-weight: bold">A</span><span style="color: #0a66c2">B</span>',
    );
    const [forced, brand] = Array.from(body.querySelectorAll('span'));
    expect(forced.style.getPropertyValue('color')).toBe('');
    expect(forced.style.getPropertyValue('font-size')).toBe('');
    expect(forced.style.getPropertyValue('font-weight')).toBe('bold');
    expect(brand.style.getPropertyValue('color')).toBe('rgb(10, 102, 194)');
  });
});

describe("sanitize, pasting from Open Mailbox's reader", () => {
  it("drops the reader page's own text colour, link colour and font, keeping other colours", () => {
    const body = clean(
      '<p style="color: rgb(241, 241, 241); font-family: -apple-system, Roboto, &quot;Helvetica Neue&quot;, sans-serif;">Hello</p>' +
        '<a href="https://a.eu" style="color: rgb(78, 165, 255);">a</a>' +
        '<p style="color: rgb(26, 26, 26);">Light</p>' +
        '<span style="color: rgb(10, 102, 194); font-family: Georgia;">B</span>',
    );
    expect(body.innerHTML).toBe(
      '<p>Hello</p><a href="https://a.eu">a</a><p>Light</p><span style="color: rgb(10, 102, 194); font-family: Georgia;">B</span>',
    );
  });
});

describe('linkifyText', () => {
  it('turns URLs in text into links', () => {
    document.body.innerHTML = 'Web https://soluce.eu.';
    linkifyText(document.body);
    expect(document.body.innerHTML).toBe('Web <a href="https://soluce.eu">https://soluce.eu</a>.');
  });

  it('leaves existing links and image sources alone', () => {
    const html = '<a href="https://x.eu">https://x.eu</a><img src="https://x.eu/a.png">';
    document.body.innerHTML = html;
    linkifyText(document.body);
    expect(document.body.innerHTML).toBe(html);
  });
});
