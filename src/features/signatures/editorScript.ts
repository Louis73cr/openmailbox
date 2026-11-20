import { MAIL_FONT } from '@/features/composer/signature';
import { PAGE, READER_FONT } from '@/features/reader/readerPage';
import type { ThemeColors } from '@/theme';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(', ')})`;
const plainFont = (font: string) => font.replace(/["']/g, '').replace(/\s*,\s*/g, ',').trim().toLowerCase();
const READER_COLORS = Object.values(PAGE).flatMap(({ text, quote, link }) => [text, quote, link].map(rgb));

export const SANITIZE = `
var ALLOWED_TAGS = { A: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, FONT: 1, IMG: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, UL: 1, OL: 1, LI: 1, HR: 1, SMALL: 1, SUB: 1, SUP: 1, H1: 1, H2: 1, H3: 1, H4: 1, BLOCKQUOTE: 1, CENTER: 1 };
var DROPPED_TAGS = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, LINK: 1, META: 1, TITLE: 1, HEAD: 1, SVG: 1, MATH: 1, NOSCRIPT: 1, TEMPLATE: 1 };
var ALLOWED_ATTRIBUTES = { href: 1, src: 1, alt: 1, title: 1, width: 1, height: 1, style: 1, align: 1, valign: 1, color: 1, face: 1, size: 1, border: 1, cellpadding: 1, cellspacing: 1, colspan: 1, rowspan: 1, bgcolor: 1 };
var FORCED_PROPERTY = /^(color|background.*|border.*-color|font-size|line-height)$/;
var READER_COLORS = ${JSON.stringify(READER_COLORS)};
var READER_FONT = ${JSON.stringify(plainFont(READER_FONT))};
function plainFont(font) {
  return font.replace(/["']/g, '').replace(/\\s*,\\s*/g, ',').trim().toLowerCase();
}
function fromReader(name, value) {
  return (name === 'color' && READER_COLORS.indexOf(value) !== -1) || (name === 'font-family' && plainFont(value) === READER_FONT);
}
var UNSAFE_URL = /url\\((?!\\s*['"]?\\s*https:)/i;
function cleanStyle(element) {
  var style = element.style;
  for (var index = style.length - 1; index >= 0; index--) {
    var name = style[index];
    var value = style.getPropertyValue(name);
    var forced = style.getPropertyPriority(name) === 'important' && FORCED_PROPERTY.test(name);
    if (forced || fromReader(name, value) || UNSAFE_URL.test(value)) style.removeProperty(name);
  }
  if (style.cssText) element.setAttribute('style', style.cssText);
  else element.removeAttribute('style');
}
function sanitize(root) {
  Array.prototype.slice.call(root.childNodes).forEach(function (node) {
    if (node.nodeType === 8) return node.remove();
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toUpperCase();
    if (DROPPED_TAGS[tag]) return node.remove();
    sanitize(node);
    if (!ALLOWED_TAGS[tag]) return node.replaceWith.apply(node, Array.prototype.slice.call(node.childNodes));
    Array.prototype.slice.call(node.attributes).forEach(function (attribute) {
      if (!ALLOWED_ATTRIBUTES[attribute.name.toLowerCase()]) node.removeAttribute(attribute.name);
    });
    if (tag === 'IMG') {
      if (!/^https:/i.test((node.getAttribute('src') || '').trim())) return node.remove();
    } else node.removeAttribute('src');
    if (node.hasAttribute('href') && !/^(https?:|mailto:|tel:)/i.test(node.getAttribute('href').trim())) node.removeAttribute('href');
    if (node.hasAttribute('style')) cleanStyle(node);
  });
}
`;

export const LINKIFY = `
var URL_PATTERN = /https?:\\/\\/[^\\s<>"]+/g;
function countOf(text, character) {
  return text.split(character).length - 1;
}
function trimUrl(url) {
  while (/[.,;:!?')]$/.test(url)) {
    if (url.charAt(url.length - 1) === ')' && countOf(url, '(') >= countOf(url, ')')) break;
    url = url.slice(0, -1);
  }
  return url;
}
function linkifyText(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function (node) {
    if (node.parentElement && node.parentElement.closest('a')) return;
    var text = node.nodeValue;
    var fragment = document.createDocumentFragment();
    var index = 0;
    text.replace(URL_PATTERN, function (match, offset) {
      var url = trimUrl(match);
      if (/:\\/\\/$/.test(url)) return match;
      if (offset > index) fragment.appendChild(document.createTextNode(text.slice(index, offset)));
      var link = document.createElement('a');
      link.setAttribute('href', url);
      link.textContent = url;
      fragment.appendChild(link);
      index = offset + url.length;
      return match;
    });
    if (index === 0) return;
    if (index < text.length) fragment.appendChild(document.createTextNode(text.slice(index)));
    node.replaceWith(fragment);
  });
}
`;

export const HTML_CODE = `
function looksLikeHtml(text) {
  var code = text.trim();
  return /^<[a-z!][\\s\\S]*>$/i.test(code) && /<\\/[a-z][\\w:-]*\\s*>|<(br|img|hr)\\b/i.test(code);
}
function parseCode(text) {
  var template = document.createElement('template');
  template.innerHTML = text.trim();
  sanitize(template.content);
  linkifyText(template.content);
  return template.content;
}
function codeFragment(text) {
  return looksLikeHtml(text) ? parseCode(text) : null;
}
function blank(node) {
  if (node.nodeType === 3) return !node.nodeValue.trim();
  if (node.nodeType !== 1) return true;
  return !node.textContent.trim() && !node.querySelector('img, [style*="url("]') && !/url\\(/i.test(node.getAttribute('style') || '');
}
function trimEdges(root) {
  while (root.firstChild && blank(root.firstChild)) root.removeChild(root.firstChild);
  while (root.lastChild && blank(root.lastChild)) root.removeChild(root.lastChild);
}
function cleanText(text) {
  return text
    .replace(/[\\t\\u00a0]+/g, ' ')
    .split('\\n')
    .map(function (line) { return line.trim(); })
    .join('\\n')
    .replace(/\\n{3,}/g, '\\n\\n')
    .trim();
}
`;

export const FORMAT_HTML = `
var BLOCK_TAGS = { DIV: 1, P: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1, TH: 1, H1: 1, H2: 1, H3: 1, H4: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, CENTER: 1, HR: 1 };
function escapeText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function openTag(element) {
  return '<' + element.tagName.toLowerCase() + Array.prototype.map.call(element.attributes, function (attribute) {
    return ' ' + attribute.name + '="' + attribute.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"';
  }).join('') + '>';
}
function isBlock(node) {
  return node.nodeType === 1 && BLOCK_TAGS[node.tagName.toUpperCase()] === 1;
}
function inlineMarkup(node) {
  return node.nodeType === 3 ? escapeText(node.nodeValue) : node.nodeType === 1 ? node.outerHTML : '';
}
function formatChildren(parent, depth, lines) {
  var indent = new Array(depth + 1).join('  ');
  var run = '';
  function flush() {
    var line = run.replace(/\\s+/g, ' ').trim();
    if (line) lines.push(indent + line);
    run = '';
  }
  Array.prototype.forEach.call(parent.childNodes, function (node) {
    if (!isBlock(node)) {
      run += inlineMarkup(node);
      return;
    }
    flush();
    var tag = node.tagName.toLowerCase();
    if (tag === 'hr') {
      lines.push(indent + openTag(node));
    } else if (Array.prototype.some.call(node.childNodes, isBlock)) {
      lines.push(indent + openTag(node));
      formatChildren(node, depth + 1, lines);
      lines.push(indent + '</' + tag + '>');
    } else {
      lines.push(indent + openTag(node) + Array.prototype.map.call(node.childNodes, inlineMarkup).join('').replace(/\\s+/g, ' ').trim() + '</' + tag + '>');
    }
  });
  flush();
}
function formatHtml(root) {
  var lines = [];
  formatChildren(root, 0, lines);
  return lines.join('\\n');
}
function pickRange(live, saved, root) {
  return live && root.contains(live.startContainer) ? live : saved;
}
function sizedSpan(px, bold) {
  var span = document.createElement('span');
  span.style.fontSize = px + 'px';
  if (bold) span.style.fontWeight = 'bold';
  return span;
}
function sizeAtCaret(range, px, bold) {
  var span = sizedSpan(px, bold);
  var marker = document.createTextNode('\\u200b');
  span.appendChild(marker);
  range.insertNode(span);
  range.setStart(marker, 1);
  range.collapse(true);
}
function stripMarkers(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  var nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(function (node) {
    if (node.nodeValue.indexOf('\\u200b') !== -1) node.nodeValue = node.nodeValue.replace(/\\u200b/g, '');
  });
  Array.prototype.forEach.call(root.querySelectorAll('span'), function (span) {
    if (!span.textContent && !span.querySelector('img, br')) span.remove();
  });
}
function resizeFonts(root, px, bold) {
  Array.prototype.forEach.call(root.querySelectorAll('font[size="7"]'), function (font) {
    var span = sizedSpan(px, bold);
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  });
}
`;

export const EDITOR_SCRIPT = `
(function () {
  ${SANITIZE}
  ${LINKIFY}
  ${HTML_CODE}
  ${FORMAT_HTML}
  var rich = document.getElementById('rich');
  var code = document.getElementById('code');
  var source = document.getElementById('source');
  var lines = document.getElementById('lines');
  var mode = 'rich';
  var range = null;
  var cleanTimer = null;
  var stateTimer = null;
  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }
  function isEmpty() {
    return !rich.textContent.trim() && !rich.querySelector('img, [style*="url("]');
  }
  function command(name) {
    try { return document.queryCommandState(name); } catch (error) { return false; }
  }
  function postState() {
    stateTimer = null;
    rich.classList.toggle('empty', isEmpty());
    var selection = window.getSelection();
    var node = selection.rangeCount ? selection.anchorNode : null;
    var element = node && (node.nodeType === 1 ? node : node.parentElement);
    var link = element && rich.contains(element) ? element.closest('a') : null;
    post({ type: 'state', bold: command('bold'), italic: command('italic'), underline: command('underline'), strike: command('strikeThrough'), link: link ? link.getAttribute('href') : null });
  }
  function scheduleState() {
    if (!stateTimer) stateTimer = setTimeout(postState, 100);
  }
  function numberLines() {
    var count = source.value.split('\\n').length;
    var numbers = [];
    for (var index = 1; index <= count; index++) numbers.push(index);
    lines.textContent = numbers.join('\\n');
  }
  function linkAtSelection() {
    var selection = window.getSelection();
    var node = selection.rangeCount ? selection.anchorNode : null;
    var element = node && (node.nodeType === 1 ? node : node.parentElement);
    return element && rich.contains(element) ? element.closest('a') : null;
  }
  function rememberSelection() {
    var selection = window.getSelection();
    if (selection.rangeCount && rich.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0).cloneRange();
      scheduleState();
    }
  }
  document.addEventListener('selectionchange', rememberSelection);
  rich.addEventListener('focus', function () { post({ type: 'focus', focused: true }); });
  rich.addEventListener('blur', function () { post({ type: 'focus', focused: false }); });
  rich.addEventListener('keyup', rememberSelection);
  rich.addEventListener('compositionend', rememberSelection);
  rich.addEventListener('paste', function (event) {
    var fragment = event.clipboardData ? codeFragment(event.clipboardData.getData('text/plain') || '') : null;
    var selection = window.getSelection();
    if (fragment && selection.rangeCount) {
      event.preventDefault();
      var target = selection.getRangeAt(0);
      var last = fragment.lastChild;
      target.deleteContents();
      target.insertNode(fragment);
      if (last) {
        target.setStartAfter(last);
        target.collapse(true);
        selection.removeAllRanges();
        selection.addRange(target);
      }
      scheduleState();
      return;
    }
    setTimeout(function () {
      sanitize(rich);
      linkifyText(rich);
      scheduleState();
    }, 0);
  });
  rich.addEventListener('input', function () {
    rememberSelection();
    clearTimeout(cleanTimer);
    cleanTimer = setTimeout(function () { sanitize(rich); }, 300);
    scheduleState();
  });
  source.addEventListener('input', numberLines);
  source.addEventListener('scroll', function () { lines.scrollTop = source.scrollTop; });
  function restoreSelection() {
    var selection = window.getSelection();
    var live = selection.rangeCount ? selection.getRangeAt(0) : null;
    var chosen = pickRange(live, range, rich);
    rich.focus();
    if (!chosen) return;
    selection.removeAllRanges();
    selection.addRange(chosen);
  }
  function applyCode() {
    rich.innerHTML = '';
    rich.appendChild(parseCode(source.value));
  }
  window.editor = {
    run: function (name, value) {
      restoreSelection();
      var selection = window.getSelection();
      var link = linkAtSelection();
      if (name === 'createLink' && link) {
        link.setAttribute('href', value);
      } else if (name === 'createLink' && selection.rangeCount && selection.getRangeAt(0).collapsed) {
        var created = document.createElement('a');
        created.setAttribute('href', value);
        created.textContent = value;
        selection.getRangeAt(0).insertNode(created);
      } else if (name === 'unlink' && link) {
        var whole = document.createRange();
        whole.selectNodeContents(link);
        selection.removeAllRanges();
        selection.addRange(whole);
        document.execCommand('unlink');
      } else if (name === 'size' && selection.rangeCount && selection.getRangeAt(0).collapsed) {
        var caret = selection.getRangeAt(0);
        sizeAtCaret(caret, value, value >= 22);
        selection.removeAllRanges();
        selection.addRange(caret);
      } else if (name === 'size') {
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('fontSize', false, '7');
        resizeFonts(rich, value, value >= 22);
      } else if (name === 'foreColor' || name === 'hiliteColor') {
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(name, false, value);
        document.execCommand('styleWithCSS', false, false);
      } else {
        document.execCommand(name, false, value);
      }
      sanitize(rich);
      scheduleState();
    },
    setMode: function (next) {
      if (next === mode) return;
      if (next === 'code') {
        stripMarkers(rich);
        sanitize(rich);
        source.value = formatHtml(rich);
        numberLines();
        rich.hidden = true;
        code.hidden = false;
      } else {
        applyCode();
        code.hidden = true;
        rich.hidden = false;
        scheduleState();
      }
      mode = next;
    },
    finish: function () {
      clearTimeout(cleanTimer);
      if (mode === 'code') applyCode();
      stripMarkers(rich);
      sanitize(rich);
      linkifyText(rich);
      trimEdges(rich);
      var text = cleanText(rich.innerText);
      var empty = !text && !rich.querySelector('img, [style*="url("]');
      post({ type: 'done', html: empty ? '' : rich.innerHTML, text: empty ? '' : text });
    },
  };
  postState();
})();
true;
`;

const inverted = (hex: string) => `#${(0xffffff ^ parseInt(hex.slice(1), 16)).toString(16).padStart(6, '0')}`;
const DARK_FILTER = 'filter: invert(1) hue-rotate(180deg);';

const palette = ({ background, text, textTertiary, surface, border }: ThemeColors) => ({ page: background, text, muted: textTertiary, gutter: surface, rule: border });
const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const variables = (colors: ReturnType<typeof palette>) =>
  `--page: ${colors.page}; --text: ${colors.text}; --muted: ${colors.muted}; --gutter: ${colors.gutter}; --rule: ${colors.rule};`;
const invertedColors = (colors: ReturnType<typeof palette>) =>
  Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, inverted(value)])) as ReturnType<typeof palette>;

export function editorDocument(
  html: string,
  options: { dark: boolean; light: ThemeColors; darkColors: ThemeColors; placeholder: string; codePlaceholder: string },
): string {
  const LIGHT = palette(options.light);
  const DARK = palette(options.darkColors);
  return `<!doctype html><html class="${options.dark ? 'dark' : ''}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'">
<style>
:root { ${variables(LIGHT)} }
html.dark { ${variables(invertedColors(DARK))} background: ${DARK.page}; }
html, body { margin: 0; }
body { min-height: 100vh; box-sizing: border-box; background: var(--page); color: var(--text); font-family: ${MAIL_FONT}; font-size: 15px; -webkit-text-size-adjust: 100%; }
html.dark body { ${DARK_FILTER} }
#rich { position: relative; min-height: 100vh; box-sizing: border-box; padding: 16px; outline: none; overflow-wrap: break-word; }
#rich.empty::before { content: attr(data-placeholder); position: absolute; color: var(--muted); pointer-events: none; }
#code { display: flex; min-height: 100vh; font: 13px/20px ui-monospace, Menlo, 'Roboto Mono', monospace; }
#code[hidden], #rich[hidden] { display: none; }
#lines { margin: 0; padding: 12px 8px; min-width: 24px; text-align: right; color: var(--muted); background: var(--gutter); border-right: 1px solid var(--rule); overflow: hidden; user-select: none; font: inherit; }
#source { flex: 1; margin: 0; padding: 12px; border: 0; outline: none; resize: none; background: transparent; color: var(--text); font: inherit; white-space: pre; overflow: auto; }
#source::placeholder { color: var(--muted); }
img { max-width: 100%; height: auto; }
a { color: #0b6bcb; }
html.dark img, html.dark [style*="url("] { ${DARK_FILTER} }
</style></head><body><div id="rich" class="${html.trim() ? '' : 'empty'}" contenteditable="true" data-placeholder="${attribute(options.placeholder)}">${html}</div><div id="code" hidden><pre id="lines">1</pre><textarea id="source" wrap="off" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off" placeholder="${attribute(options.codePlaceholder)}"></textarea></div></body></html>`;
}
