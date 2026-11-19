function fold(character: string): string {
  return character.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const WRITTEN_WITHOUT_SPACES =
  /[฀-໿က-႟ក-៿぀-ヿㇰ-ㇿ㐀-䶿一-鿿가-힯豈-﫿ｦ-ﾟ\u{20000}-\u{3134F}]/u;

function kind(character: string | undefined): 'none' | 'spaced' | 'unspaced' {
  if (character === undefined) return 'none';
  if (WRITTEN_WITHOUT_SPACES.test(character)) return 'unspaced';
  return WORD_CHARACTER.test(character) ? 'spaced' : 'none';
}

function terms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((term) => [...term].map(fold).join(''))
    .filter(Boolean);
}

function indexOfSequence(characters: string[], sequence: string[]): number {
  for (let start = 0; start + sequence.length <= characters.length; start += 1) {
    if (sequence.every((character, offset) => characters[start + offset] === character)) return start;
  }
  return -1;
}

export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const wanted = terms(query);
  if (wanted.length === 0 || !text) return text ? [{ text, match: false }] : [];
  const characters = [...text];
  const parts: { text: string; match: boolean }[] = [];
  let plain = '';
  let index = 0;
  let resumeAt = -1;
  const pushMatch = (match: string) => {
    if (plain) parts.push({ text: plain, match: false });
    plain = '';
    parts.push({ text: match, match: true });
  };
  while (index < characters.length) {
    const current = kind(characters[index]);
    const startsWord = current !== 'none' && (index === resumeAt || kind(characters[index - 1]) !== current);
    if (startsWord) {
      let end = index;
      while (end < characters.length && kind(characters[end]) === current) end += 1;
      const word = characters.slice(index, end);
      const folded = word.map(fold);
      if (current === 'unspaced') {
        const found = wanted
          .map((term) => ({ term: [...term], at: indexOfSequence(folded, [...term]) }))
          .find(({ at }) => at >= 0);
        if (found) {
          plain += word.slice(0, found.at).join('');
          pushMatch(word.slice(found.at, found.at + found.term.length).join(''));
          index += found.at + found.term.length;
          resumeAt = index;
          continue;
        }
      } else if (wanted.some((term) => folded.join('').startsWith(term))) {
        pushMatch(word.join(''));
        index = end;
        continue;
      }
    }
    plain += characters[index];
    index += 1;
  }
  if (plain) parts.push({ text: plain, match: false });
  return parts;
}

export function snippetAround(text: string, query: string, lead = 40): string {
  const parts = highlightParts(text, query);
  let offset = 0;
  for (const part of parts) {
    if (part.match) break;
    offset += part.text.length;
  }
  if (offset <= lead || offset >= text.length) return text;
  const start = text.lastIndexOf(' ', offset - lead);
  return `…${text.slice(start === -1 ? offset - lead : start + 1)}`;
}
