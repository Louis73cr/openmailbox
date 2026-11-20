import { editorHtml } from '@/features/composer/editorHtml';

describe('editorHtml', () => {
  it('drops the html wrapper', () => {
    expect(editorHtml('<html>\n<b>Hi</b> you\n</html>')).toBe('<b>Hi</b> you');
  });

  it('keeps lines and lists as tight as in the editor', () => {
    expect(editorHtml('<html>\n<p>one</p>\n<br>\n<p style="text-align: center;">two</p>\n<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>\n</html>')).toBe(
      '<p style="margin: 0">one</p>\n<br>\n<p style="margin: 0; text-align: center;">two</p>\n<ul style="margin-top: 0; margin-bottom: 0">\n<li>a</li>\n</ul>\n<ol style="margin-top: 0; margin-bottom: 0">\n<li>b</li>\n</ol>',
    );
  });

  it('returns nothing for an empty editor', () => {
    expect(editorHtml('<html>\n<p></p>\n</html>')).toBe('');
    expect(editorHtml('<html></html>')).toBe('');
    expect(editorHtml('')).toBe('');
  });

  it('keeps web, mail and phone links', () => {
    const html = '<a href="https://a.eu">a</a> <a href="mailto:b@c.eu">b</a> <a href="tel:+33">c</a> <a href="http://d.eu">d</a>';
    expect(editorHtml(`<html>${html}</html>`)).toBe(html);
  });

  it('removes script links but keeps their text', () => {
    expect(editorHtml('<html><a href="javascript:alert(1)">x</a></html>')).toBe('<a>x</a>');
    expect(editorHtml('<html><a href=" JavaScript:alert(1)">x</a></html>')).toBe('<a>x</a>');
  });

  it('drops event handlers smuggled in through a quote in a pasted url', () => {
    expect(editorHtml('<html><a href="https://x.eu" onmouseover="alert(1)">x</a><img src="https://x.eu/i.png" onerror=alert(1) /></html>')).toBe(
      '<a href="https://x.eu">x</a><img src="https://x.eu/i.png" />',
    );
  });

  it('leaves text that reads like an attribute alone', () => {
    expect(editorHtml('<html>status online=yes</html>')).toBe('status online=yes');
  });

  it('keeps https images and drops the others', () => {
    expect(editorHtml('<html><img src="https://a.eu/l.png" width="40" height="40"/><img src="data:image/png;base64,AA"/></html>')).toBe(
      '<img src="https://a.eu/l.png" width="40" height="40"/>',
    );
  });

  it('keeps an image-only message', () => {
    expect(editorHtml('<html><img src="https://a.eu/l.png"/></html>')).toBe('<img src="https://a.eu/l.png"/>');
  });
});
