const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

const count = (text: string, character: string) => text.split(character).length - 1;

function trimmed(url: string): string {
  let result = url;
  while (/[.,;:!?')]$/.test(result)) {
    if (result.endsWith(')') && count(result, '(') >= count(result, ')')) break;
    result = result.slice(0, -1);
  }
  return result;
}

export function splitLinks(text: string): { text: string; url?: string }[] {
  const segments: { text: string; url?: string }[] = [];
  let index = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimmed(match[0]);
    if (!url.includes('://') || url.endsWith('://')) continue;
    if (match.index > index) segments.push({ text: text.slice(index, match.index) });
    segments.push({ text: url, url });
    index = match.index + url.length;
  }
  if (index < text.length) segments.push({ text: text.slice(index) });
  return segments;
}
