/** Replaces every whitespace character (including the no-break spaces of `formatBRL`) with " ". */
export function normalizeSpaces(text: string): string {
  return text.replace(/\s/g, ' ');
}

/**
 * `getByText` matcher for text that may contain the no-break space of `formatBRL`:
 * `screen.getByText(spaced('R$ 1.600,00'))`.
 */
export function spaced(expected: string): (content: string) => boolean {
  return (content) => normalizeSpaces(content).trim() === expected;
}
