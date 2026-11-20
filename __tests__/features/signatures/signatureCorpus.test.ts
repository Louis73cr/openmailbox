/**
 * @jest-environment jsdom
 */
import { HTML_CODE, LINKIFY, SANITIZE } from '@/features/signatures/editorScript';

const sanitize = new Function(`${SANITIZE}; return sanitize;`)() as (root: Node) => void;
const codeFragment = new Function(`${SANITIZE}; ${LINKIFY}; ${HTML_CODE}; return codeFragment;`)() as (text: string) => DocumentFragment | null;
const cleanText = new Function(`${HTML_CODE}; return cleanText;`)() as (text: string) => string;

function clean(html: string): HTMLElement {
  document.body.innerHTML = html;
  sanitize(document.body);
  return document.body;
}

const CODE_SIGNATURE = `<div style="font-family: Arial, sans-serif; max-width: 550px; color: #111111;">
  <table cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>
    <td style="width: 175px; background-color: #111111; background-image: url('https://brand.example/logo.png'); background-size: cover;"></td>
    <td style="vertical-align: top; padding: 20px;">
      <h1 style="margin: 0; font-size: 18px; color: #000000;">Jane Doe</h1>
      <h2 style="margin: 5px 0 10px 0; font-size: 15px; color: #000000;">CEO | Brand</h2>
      <table cellpadding="0" cellspacing="0"><tbody>
        <tr><td><a href="mailto:jane@brand.example" style="text-decoration: none; color: #000000;">jane@brand.example</a></td></tr>
        <tr><td><a href="tel:+33 1 23 45 67 89" style="color: #000000;">+33 1 23 45 67 89</a></td></tr>
        <tr><td><a href="https://www.brand.example">www.brand.example</a></td></tr>
      </tbody></table>
    </td>
  </tr></tbody></table>
</div>`;

describe('signatures people paste', () => {
  it('keeps a hand-written HTML signature: tables, headings, background logo, mail, phone and web links', () => {
    const body = clean(CODE_SIGNATURE);
    const [logo] = Array.from(body.querySelectorAll('td'));
    expect(logo.style.getPropertyValue('background-image')).toContain('https://brand.example/logo.png');
    expect(logo.style.getPropertyValue('background-color')).toBe('rgb(17, 17, 17)');
    expect(body.querySelector('h1')?.textContent).toBe('Jane Doe');
    expect(body.querySelector('h2')?.style.getPropertyValue('font-size')).toBe('15px');
    expect(Array.from(body.querySelectorAll('a')).map((link) => link.getAttribute('href'))).toEqual([
      'mailto:jane@brand.example',
      'tel:+33 1 23 45 67 89',
      'https://www.brand.example',
    ]);
  });

  it('keeps a Gmail signature without its classes and data attributes', () => {
    const body = clean(
      '<div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature"><b>Jane Doe</b><div><img src="https://lh3.googleusercontent.com/logo" width="96" height="30"></div></div>',
    );
    expect(body.innerHTML).toBe('<div><b>Jane Doe</b><div><img src="https://lh3.googleusercontent.com/logo" width="96" height="30"></div></div>');
  });

  it('strips Outlook and Word markup: classes, mso styles, conditional comments, VML and embedded images', () => {
    const body = clean(
      '<p class="MsoNormal"><span style="font-size: 10pt; mso-fareast-language: FR">Jane Doe<o:p></o:p></span></p>' +
        '<!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit"/></xml><![endif]-->' +
        '<v:shape id="logo"><v:imagedata src="file:///C:/logo.png"></v:imagedata></v:shape><img src="cid:image001.png@01DA">',
    );
    expect(body.innerHTML).toBe('<p><span style="font-size: 10pt;">Jane Doe</span></p>');
  });

  it('keeps an Apple Mail signature without its interchange markers', () => {
    const body = clean('<div style="color: rgb(0, 0, 0);">Jane Doe<br class="Apple-interchange-newline"></div>');
    expect(body.innerHTML).toBe('<div style="color: rgb(0, 0, 0);">Jane Doe<br></div>');
  });

  it('keeps struck-through text from the format bar', () => {
    expect(clean('<strike>old</strike> new').innerHTML).toBe('<strike>old</strike> new');
  });

  it('keeps a generated signature with linked social icons', () => {
    const html =
      '<table><tbody><tr><td><a href="https://www.linkedin.com/in/jane"><img src="https://cdn.generator.example/linkedin.png" width="20" alt="LinkedIn"></a></td></tr></tbody></table>';
    expect(clean(html).innerHTML).toBe(html);
  });

  it('removes everything that could run code, track or load local files', () => {
    const body = clean(
      '<img src="https://x.example/a.png" onerror="alert(1)">' +
        '<a href=" javascript:alert(1)">x</a><a href="data:text/html,x">d</a>' +
        '<svg onload="alert(1)"><circle></circle></svg><iframe src="https://x.example"></iframe>' +
        '<div style="background-image: url(javascript:alert(1)); color: red;">y</div>' +
        '<img src="data:image/png;base64,AAAA"><img src="file:///etc/passwd">',
    );
    expect(body.innerHTML).toBe('<img src="https://x.example/a.png"><a>x</a><a>d</a><div style="color: red;">y</div>');
  });
});

describe('unsafe style URLs', () => {
  const unsafeUrl = new Function(`${SANITIZE}; return UNSAFE_URL;`)() as RegExp;

  it('accepts https images however the browser quotes them', () => {
    expect(['url(https://x.example/a.png)', "url('https://x.example/a.png')", 'url("https://x.example/a.png")'].some((value) => unsafeUrl.test(value))).toBe(
      false,
    );
  });

  it('rejects other schemes, quoted or not', () => {
    expect(['url(javascript:alert(1))', 'url("http://x.example/a.png")', "url( 'data:image/png;base64,AA')"].every((value) => unsafeUrl.test(value))).toBe(
      true,
    );
  });
});

describe('pasting HTML code', () => {
  it('turns pasted HTML code into the cleaned signature', () => {
    const fragment = codeFragment('  <table><tr><td><b>Jane</b> https://jane.example</td></tr></table><script>alert(1)</script>\n');
    const holder = document.createElement('div');
    holder.appendChild(fragment!);
    expect(holder.innerHTML).toBe('<table><tbody><tr><td><b>Jane</b> <a href="https://jane.example">https://jane.example</a></td></tr></tbody></table>');
  });

  it('leaves ordinary text alone, even with a stray tag inside', () => {
    expect(codeFragment('Jane Doe, CEO')).toBeNull();
    expect(codeFragment('Use <b> for bold')).toBeNull();
    expect(codeFragment('<3 Jane')).toBeNull();
  });
});

describe('trimEdges', () => {
  const trimEdges = new Function(`${SANITIZE}; ${LINKIFY}; ${HTML_CODE}; return trimEdges;`)() as (root: Node) => void;

  it('drops empty blocks and blank lines left around the signature, keeping logo-only cells', () => {
    document.body.innerHTML = '<p></p>\n <div><br></div><div style="background-image: url(https://x.example/a.png)"></div><b>Jane</b><p> </p>\n';
    trimEdges(document.body);
    expect(document.body.innerHTML).toBe('<div style="background-image: url(https://x.example/a.png)"></div><b>Jane</b>');
  });
});

describe('cleanText', () => {
  it('turns table cells into tidy lines for the plain-text part', () => {
    expect(cleanText('\tJane Doe\u00a0\nCEO | Brand\n\n\n\n jane@brand.example\t+33 1 23 45 67 89\n')).toBe(
      'Jane Doe\nCEO | Brand\n\njane@brand.example +33 1 23 45 67 89',
    );
  });
});
