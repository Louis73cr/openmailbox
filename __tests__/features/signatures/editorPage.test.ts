/**
 * @jest-environment jsdom
 */
import { editorDocument, FORMAT_HTML, HTML_CODE, LINKIFY, SANITIZE } from '@/features/signatures/editorScript';
import type { ThemeColors } from '@/theme';

const page = new Function(`${SANITIZE}; ${LINKIFY}; ${HTML_CODE}; ${FORMAT_HTML}; return { formatHtml, resizeFonts, parseCode };`)() as {
  formatHtml: (root: Node) => string;
  resizeFonts: (root: Node, px: number, bold: boolean) => void;
  parseCode: (text: string) => DocumentFragment;
};

function html(markup: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = markup;
  return holder;
}

function parsed(code: string): HTMLElement {
  const holder = document.createElement('div');
  holder.appendChild(page.parseCode(code));
  return holder;
}

const SIGNATURE = `<div style="font-family: Arial, sans-serif; color: #111111;">
  <table cellpadding="0" cellspacing="0"><tbody><tr>
    <td style="width: 175px; background-image: url('https://brand.example/logo.png');"></td>
    <td style="padding: 20px;">
      <h1 style="margin: 0; font-size: 18px;">Jane
        Doe</h1>
      <a href="mailto:jane@brand.example">jane@brand.example</a><br>+33 1 23 45 67 89
    </td>
  </tr></tbody></table>
</div>`;

describe('formatHtml', () => {
  it('puts each block on its own indented line and keeps inline content on one line', () => {
    expect(page.formatHtml(html('<table><tbody><tr><td><b>Jane</b> Doe</td></tr></tbody></table><p>Hi <a href="https://x.eu">x</a></p>'))).toBe(
      [
        '<table>',
        '  <tbody>',
        '    <tr>',
        '      <td><b>Jane</b> Doe</td>',
        '    </tr>',
        '  </tbody>',
        '</table>',
        '<p>Hi <a href="https://x.eu">x</a></p>',
      ].join('\n'),
    );
  });

  it('escapes quotes and ampersands in attributes and text', () => {
    expect(page.formatHtml(html('<p title=\'a "b" &amp; c\'>x &lt; y</p>'))).toBe('<p title="a &quot;b&quot; &amp; c">x &lt; y</p>');
  });

  it('gives the same code after switching to the rich view and back', () => {
    const once = page.formatHtml(parsed(SIGNATURE));
    expect(page.formatHtml(parsed(once))).toBe(once);
    expect(once).toContain('<h1 style="margin: 0px; font-size: 18px;">Jane Doe</h1>');
  });
});

describe('parseCode', () => {
  it('cleans code typed in the HTML view, plain text included', () => {
    expect(parsed('<style>p{}</style><script>alert(1)</script><b>Jane</b> https://jane.example').innerHTML).toBe(
      '<b>Jane</b> <a href="https://jane.example">https://jane.example</a>',
    );
    expect(parsed('Jane Doe').innerHTML).toBe('Jane Doe');
  });
});

describe('resizeFonts', () => {
  it('turns the browser size marker into a pixel size, keeping the formatting around it', () => {
    const root = html('<b><font size="7">big</font></b> <a href="https://x.eu"><font size="7">link</font></a>');
    page.resizeFonts(root, 18, false);
    expect(root.innerHTML).toBe(
      '<b><span style="font-size: 18px;">big</span></b> <a href="https://x.eu"><span style="font-size: 18px;">link</span></a>',
    );
  });

  it('makes the title size bold', () => {
    const root = html('<font size="7">Jane</font>');
    page.resizeFonts(root, 22, true);
    expect(root.innerHTML).toBe('<span style="font-size: 22px; font-weight: bold;">Jane</span>');
  });
});

describe('sizing at the cursor', () => {
  const caret = new Function(`${SANITIZE}; ${LINKIFY}; ${HTML_CODE}; ${FORMAT_HTML}; return { sizeAtCaret, stripMarkers };`)() as {
    sizeAtCaret: (range: Range, px: number, bold: boolean) => void;
    stripMarkers: (root: Node) => void;
  };

  it('opens a sized span at the cursor so the next words use the size', () => {
    const root = html('Jane ');
    document.body.appendChild(root);
    const range = document.createRange();
    range.setStart(root.firstChild!, 5);
    range.collapse(true);
    caret.sizeAtCaret(range, 18, false);
    expect(root.innerHTML).toBe('Jane <span style="font-size: 18px;">​</span>');
    expect(range.startContainer.parentElement?.tagName).toBe('SPAN');
    expect(range.startOffset).toBe(1);
    root.remove();
  });

  it('removes the cursor markers and the sized spans left empty', () => {
    const root = html('<span style="font-size: 18px;">​Big</span><span style="font-size: 22px;">​</span> end');
    caret.stripMarkers(root);
    expect(root.innerHTML).toBe('<span style="font-size: 18px;">Big</span> end');
  });
});

describe('choosing where a tool applies', () => {
  const pick = new Function(`${SANITIZE}; ${LINKIFY}; ${HTML_CODE}; ${FORMAT_HTML}; return pickRange;`)() as (
    live: Range | null,
    saved: Range | null,
    root: Node,
  ) => Range | null;

  it('prefers the live selection inside the editor over an older saved one', () => {
    const root = html('Jane Doe');
    const live = document.createRange();
    live.setStart(root.firstChild!, 8);
    const saved = document.createRange();
    saved.setStart(root.firstChild!, 1);
    expect(pick(live, saved, root)).toBe(live);
  });

  it('falls back to the saved selection when the live one left the editor', () => {
    const root = html('Jane Doe');
    const outside = document.createRange();
    outside.setStart(document.body, 0);
    const saved = document.createRange();
    saved.setStart(root.firstChild!, 8);
    expect(pick(outside, saved, root)).toBe(saved);
    expect(pick(null, saved, root)).toBe(saved);
  });
});

describe('editorDocument', () => {
  const light = { background: '#ffffff', text: '#1a1a1a', textTertiary: '#888888', surface: '#f5f5f5', border: '#eeeeee' } as ThemeColors;
  const darkColors = { background: '#000000', text: '#f1f1f1', textTertiary: '#666666', surface: '#1e1e1e', border: '#333333' } as ThemeColors;

  it('holds the rich view with its placeholder and the code view without wrapping', () => {
    const document = editorDocument('<b>Jane</b>', { dark: true, light, darkColors, placeholder: 'Write "here"', codePlaceholder: 'Type HTML' });
    expect(document).toContain('<html class="dark">');
    expect(document).toContain('data-placeholder="Write &quot;here&quot;"');
    expect(document).toContain('placeholder="Type HTML"');
    expect(document).toContain('wrap="off"');
    expect(document).toContain('<b>Jane</b>');
  });

  it('paints the page with the app theme and shows the placeholder before the script runs', () => {
    const document = editorDocument('', { dark: false, light, darkColors, placeholder: 'Write', codePlaceholder: 'Type HTML' });
    expect(document).toContain('--page: #ffffff; --text: #1a1a1a; --muted: #888888');
    expect(document).toContain('--page: #ffffff; --text: #0e0e0e');
    expect(document).toContain('<div id="rich" class="empty"');
  });
});
