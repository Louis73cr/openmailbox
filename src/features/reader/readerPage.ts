export const READER_FONT = "-apple-system, Roboto, 'Helvetica Neue', sans-serif";

export const PAGE = {
  light: { background: '#ffffff', text: '#1a1a1a', quote: '#555555', rule: '#d0d0d0', link: '#0b6bcb' },
  dark: { background: '#1c1c1e', text: '#f1f1f1', quote: '#aaaaaa', rule: '#48484a', link: '#4ea5ff' },
};

export function documentFor(html: string, allowRemoteContent: boolean, page: (typeof PAGE)['light']): string {
  const images = allowRemoteContent ? 'data: https: http:' : 'data:';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${images}; font-src data:; media-src 'none'; frame-src 'none'; form-action 'none';">
<style>
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html, body { margin: 0; padding: 0; background: ${page.background}; color: ${page.text}; }
a { color: ${page.link}; }
body { padding: 4px 2px; font: 15px/1.45 ${READER_FONT}; overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
blockquote { margin: 0 0 0 8px; padding-left: 10px; border-left: 3px solid ${page.rule}; color: ${page.quote}; }
</style></head><body>${html}</body></html>`;
}

export const ADAPT_COLOR = `
function adaptColor(color, background) {
  if (color.indexOf('rgb') !== 0) return null;
  var channels = color.match(/[\\d.]+/g);
  var alpha = channels.length > 3 ? Number(channels[3]) : 1;
  if (alpha === 0) return null;
  var r = channels[0] / 255, g = channels[1] / 255, b = channels[2] / 255;
  var luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (background !== (luma > 0.5)) return null;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, sum = max + min;
  var hue = 0, saturation = 0;
  if (delta) {
    saturation = delta / (sum > 1 ? 2 - sum : sum);
    hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  }
  var lightness = background ? 0.11 + (1 - luma) * 0.48 : 0.95 - luma * 0.7;
  return 'hsla(' + Math.round(hue * 60) + ', ' + Math.round(saturation * 100) + '%, ' + Math.round(lightness * 100) + '%, ' + alpha + ')';
}
`;
