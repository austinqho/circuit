// Plain JavaScript (no types): a declaration, an object of handlers, a class.
export function renderBadge(count) {
  return <span className="badge">{count}</span>;
}

export const handlers = {
  onPing: () => fetch('/api/ping').then(response => response.json()),
  describe() {
    return 'handlers';
  },
};

export class Tally {
  constructor() {
    this.total = 0;
  }
  bump() {
    this.total += 1;
    return this.total;
  }
}
