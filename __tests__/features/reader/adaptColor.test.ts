import { ADAPT_COLOR } from '@/features/reader/components/HtmlBody';

const adaptColor = new Function(`${ADAPT_COLOR}; return adaptColor;`)() as (color: string, background: boolean) => string | null;

describe('adaptColor', () => {
  it('darkens light backgrounds and lightens dark text', () => {
    expect(adaptColor('rgb(255, 255, 255)', true)).toBe('hsla(0, 0%, 11%, 1)');
    expect(adaptColor('rgb(0, 0, 0)', false)).toBe('hsla(0, 0%, 95%, 1)');
  });

  it('keeps colors already fit for the dark page', () => {
    expect(adaptColor('rgb(255, 255, 255)', false)).toBeNull();
    expect(adaptColor('rgb(0, 0, 0)', true)).toBeNull();
    expect(adaptColor('rgba(0, 0, 0, 0)', true)).toBeNull();
  });

  it('keeps the alpha of translucent colors', () => {
    expect(adaptColor('rgba(255, 255, 255, 0.5)', true)).toBe('hsla(0, 0%, 11%, 0.5)');
  });
});
