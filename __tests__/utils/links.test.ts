import { splitLinks } from '@/utils/links';

describe('splitLinks', () => {
  it('leaves trailing punctuation out of the link', () => {
    expect(splitLinks('See https://openmailbox.eu.')).toEqual([
      { text: 'See ' },
      { text: 'https://openmailbox.eu', url: 'https://openmailbox.eu' },
      { text: '.' },
    ]);
  });

  it('leaves a closing parenthesis out unless the link opened one', () => {
    expect(splitLinks('(https://openmailbox.eu)')).toEqual([
      { text: '(' },
      { text: 'https://openmailbox.eu', url: 'https://openmailbox.eu' },
      { text: ')' },
    ]);
    expect(splitLinks('https://en.wikipedia.org/wiki/Mail_(app)')).toEqual([
      { text: 'https://en.wikipedia.org/wiki/Mail_(app)', url: 'https://en.wikipedia.org/wiki/Mail_(app)' },
    ]);
  });

  it('keeps text without links whole', () => {
    expect(splitLinks('no link')).toEqual([{ text: 'no link' }]);
  });
});
