import { flattenOutline, isMarkdownHeading, parseOutline } from './outline';

export interface HeadingSection {
  text: string;
  rawText: string;
  line: number;
  level: number;
  endLine: number;
  nodeLines: number[];
}

function parseMarkdownHeading(line: string): { text: string; level: number } | null {
  if (!isMarkdownHeading(line)) return null;

  const match = line.trim().match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;

  return {
    level: match[1].length,
    text: match[2].replace(/\s+#+$/, '').trim(),
  };
}

export function parseHeadingSections(markdown: string): HeadingSection[] {
  const lines = markdown.split(/\r?\n/);
  const outlineNodes = flattenOutline(parseOutline(markdown));
  const outlineLines = new Set(outlineNodes.map((node) => node.line));
  const sections: HeadingSection[] = [];
  const stack: HeadingSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = parseMarkdownHeading(lines[i]);

    if (heading) {
      while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
        stack.pop()!.endLine = i - 1;
      }

      const section: HeadingSection = {
        text: heading.text,
        rawText: lines[i].trim(),
        line: i,
        level: heading.level,
        endLine: lines.length - 1,
        nodeLines: [],
      };

      sections.push(section);
      stack.push(section);
      continue;
    }

    if (outlineLines.has(i)) {
      stack.forEach((section) => section.nodeLines.push(i));
    }
  }

  return sections;
}
