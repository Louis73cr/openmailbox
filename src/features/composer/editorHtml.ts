const SAFE_LINK = /^\s*(https?:|mailto:|tel:)/i;
const SAFE_IMAGE = /^\s*https:/i;

export function editorHtml(raw: string): string {
  const html = raw
    .replace(/^\s*<html>/i, '')
    .replace(/<\/html>\s*$/i, '')
    .replace(/<[^>]+>/g, (tag) => tag.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''))
    .replace(/<img\b[^>]*>/gi, (image) => (SAFE_IMAGE.test(image.match(/\ssrc="([^"]*)"/i)?.[1] ?? '') ? image : ''))
    .replace(/\shref="([^"]*)"/gi, (attribute, url: string) => (SAFE_LINK.test(url) ? attribute : ''))
    .replace(/<p( style="([^"]*)")?>/gi, (_tag, _attribute, style?: string) => `<p style="margin: 0${style ? `; ${style}` : ''}">`)
    .replace(/<(ul|ol)>/gi, '<$1 style="margin-top: 0; margin-bottom: 0">')
    .trim();
  const empty = !html.replace(/<[^>]*>/g, '').trim() && !/<img\b/i.test(html);
  return empty ? '' : html;
}
