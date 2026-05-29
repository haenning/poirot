import { extractPlaceholders } from "./placeholders";

function placeholderArgName(index: number): string {
  if (index < 26) {
    return String.fromCharCode(97 + index);
  }
  return `p${index + 1}`;
}

/** Paste-ready m.key() reference; param slots use a, b, c when the message has {placeholders}. */
export function formatKeyCall(key: string, value?: string): string {
  const params = value ? extractPlaceholders(value) : [];
  if (params.length === 0) {
    return `m.${key}()`;
  }
  const args = params.map((p, i) => `${p}: ${placeholderArgName(i)}`).join(", ");
  return `m.${key}({ ${args} })`;
}
