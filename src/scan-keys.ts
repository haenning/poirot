const M_FUNC_RE = /\bm\.([a-z][a-z0-9_]*)\(/g;
const LINE_COMMENT_RE = /^\s*\/\//;

function blockCommentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("/*", i);
    if (open === -1) break;
    const close = text.indexOf("*/", open + 2);
    if (close === -1) {
      ranges.push([open, text.length]);
      break;
    }
    ranges.push([open, close + 2]);
    i = close + 2;
  }
  return ranges;
}

function isInBlockComment(offset: number, ranges: Array<[number, number]>): boolean {
  for (const [s, e] of ranges) {
    if (offset >= s && offset < e) return true;
  }
  return false;
}

function lineAtOffset(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = text.indexOf("\n", offset);
  return text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
}

export interface KeyMatch {
  key: string;
  index: number;
  length: number;
}

export function scanKeyMatchesFromText(text: string): KeyMatch[] {
  const matches: KeyMatch[] = [];
  const blockRanges = blockCommentRanges(text);
  M_FUNC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = M_FUNC_RE.exec(text)) !== null) {
    const offset = match.index;
    if (isInBlockComment(offset, blockRanges)) continue;
    if (LINE_COMMENT_RE.test(lineAtOffset(text, offset))) continue;
    matches.push({ key: match[1], index: offset, length: match[0].length });
  }
  return matches;
}

/** Scan source text for m.key() calls, skipping line and block comments. */
export function scanKeysFromText(text: string): string[] {
  return [...new Set(scanKeyMatchesFromText(text).map((m) => m.key))];
}
