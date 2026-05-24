import { describe, expect, it } from 'vitest';
import { isOutlineCompatible, parseOutline } from '../src/utils/outline';
import { parseHeadingSections } from '../src/utils/heading-sections';

describe('outline parsing', () => {
  it('treats markdown headings as compatible section markers', () => {
    const markdown = [
      '# Projekt',
      '- Einstieg',
      '## Teilbereich',
      '- Detail',
    ].join('\n');

    expect(isOutlineCompatible(markdown)).toBe(true);
    expect(parseOutline(markdown).map((node) => node.text)).toEqual(['Einstieg', 'Detail']);
  });

  it('maps heading sections to the outline nodes below them', () => {
    const markdown = [
      '# Projekt',
      '- Einstieg',
      '\t- Kind',
      '## Teilbereich',
      '- Detail',
      '# Zweites Projekt',
      '- Abschluss',
    ].join('\n');

    expect(parseHeadingSections(markdown)).toEqual([
      {
        text: 'Projekt',
        rawText: '# Projekt',
        level: 1,
        line: 0,
        endLine: 4,
        nodeLines: [1, 2, 4],
      },
      {
        text: 'Teilbereich',
        rawText: '## Teilbereich',
        level: 2,
        line: 3,
        endLine: 4,
        nodeLines: [4],
      },
      {
        text: 'Zweites Projekt',
        rawText: '# Zweites Projekt',
        level: 1,
        line: 5,
        endLine: 6,
        nodeLines: [6],
      },
    ]);
  });
});
