export function escapeHtml(input: unknown): string {
  return String(input).replace(
    /[&<>"'\x00-\x1F\x7F\u2028\u2029]/g,
    (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return `&#x${char.codePointAt(0)!.toString(16)};`;
      }
    },
  );
}

export function safeUrl(url: string): string | null {
  const allowed = ['http:', 'https:', 'mailto:'];
  try {
    const parsed = new URL(url);
    return allowed.includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}
