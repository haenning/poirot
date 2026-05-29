const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function extractPlaceholders(value: string): string[] {
  const found = new Set<string>();
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
    found.add(match[1]);
  }
  return [...found].sort();
}

export interface PlaceholderIssue {
  key: string;
  locale: string;
  expected: string[];
  actual: string[];
}

function placeholdersEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p === b[i]);
}

export function validateKeyPlaceholders(
  key: string,
  values: Record<string, string>,
  locales: string[],
  baseLocale: string
): PlaceholderIssue[] {
  const baseValue = values[baseLocale];
  if (!baseValue?.trim()) return [];

  const expected = extractPlaceholders(baseValue);
  const issues: PlaceholderIssue[] = [];

  for (const locale of locales) {
    if (locale === baseLocale) continue;
    const value = values[locale];
    if (!value?.trim()) continue;

    const actual = extractPlaceholders(value);
    if (!placeholdersEqual(expected, actual)) {
      issues.push({ key, locale, expected, actual });
    }
  }

  return issues;
}

export function formatPlaceholderIssues(issues: PlaceholderIssue[]): string {
  if (issues.length === 0) {
    return "All checked keys have matching placeholders across locales.";
  }

  return issues
    .map(({ key, locale, expected, actual }) => {
      const exp = expected.length > 0 ? `{${expected.join(", ")}}` : "(none)";
      const act = actual.length > 0 ? `{${actual.join(", ")}}` : "(none)";
      return `m.${key}() [${locale}]: expected ${exp}, got ${act}`;
    })
    .join("\n");
}
