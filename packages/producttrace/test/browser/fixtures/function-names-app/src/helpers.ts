// Helpers exported under other names, an anonymous default export, and a
// helper that takes a callback. Nothing here knows about Tracer.
function formatTitle(text: string): string {
  return text.trim().replace(/^\w/u, first => first.toUpperCase());
}

function withRetry<T>(task: () => T, attempts = 2): T {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try { return task(); } catch (error) { last = error; }
  }
  throw last;
}

export { formatTitle as titleCase, withRetry };

export default function (items: readonly string[]): number {
  return items.filter(Boolean).length;
}
