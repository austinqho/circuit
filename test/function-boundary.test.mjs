import test from 'node:test';
import assert from 'node:assert/strict';
import { exactOriginalFunctionBoundary } from '../integrations/runtime-attribution.mjs';

// Regression for eight small callbacks (LibreChat 45cc53c: RouteErrorBoundary,
// MessageNav, schemas, Favorites, useUpdateTagsInConvo, mutations, Assistants,
// SubagentCall) that were resolved to their enclosing function: the map puts
// the callback's first token on the call it is passed to and its last token
// just before its end. The innermost exact function wins.
const source = `export const parse = (stack) => {
  return stack
    .split('\\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => ({
      number: i + 1,
      content: line,
    }));
};
`;
const inner = source.indexOf('(line, i) =>');
const innerEnd = source.indexOf('}))', inner) + 2;
const outer = source.indexOf('(stack) =>');

test('a callback mapped from its call site resolves to the callback, not the enclosing function', () => {
  const mappedStart = source.lastIndexOf('.map(', inner) + 1; // "map(" token
  const mappedEnd = innerEnd - 1; // last generated token lands just before the end
  const boundary = exactOriginalFunctionBoundary('a.ts', source, mappedStart, mappedEnd);
  assert.deepEqual([boundary.start, boundary.end], [inner, innerEnd]);
  assert.notEqual(boundary.start, outer);
});

test('a callback whose type cast was erased resolves to the whole callback', () => {
  // `() => dataService.getFavorites() as Promise<State>`: the emitted arrow ends
  // before the erased `as` clause, so the mapped end falls inside the callback.
  const cast = `export const useFavorites = (config) => {
  return useQuery(
    ['favorites'],
    () => dataService.getFavorites() as Promise<FavoritesState>,
    { ...config },
  );
};
`;
  const arrow = cast.indexOf('() => dataService');
  const arrowEnd = cast.indexOf('>,', arrow) + 1;
  const mappedEnd = cast.indexOf('getFavorites()', arrow) + 'getFavorites()'.length;
  const boundary = exactOriginalFunctionBoundary('b.ts', cast, arrow - 6, mappedEnd);
  assert.deepEqual([boundary.start, boundary.end], [arrow, arrowEnd]);
});

test('the enclosing function still resolves when its own span is mapped', () => {
  const end = source.lastIndexOf('};') + 1;
  const boundary = exactOriginalFunctionBoundary('a.ts', source, outer, end);
  assert.deepEqual([boundary.start, boundary.end], [outer, end]);
});

test('a callback mapped from the property or JSX attribute it is the value of resolves to the callback', () => {
  // Minified maps put the first token of `retryDelay: () => 5_000` on the key
  // and of `onClick={() => …}` on the attribute name (LibreChat SSE/queries.ts,
  // AskUserQuestion.tsx); the gap is more than 8 characters.
  const q = `export const useStatus = (id) => useQuery(['s', id], fetcher, {
      retryDelay: () => 5_000,
    });
`;
  const key = q.indexOf('retryDelay');
  const fn = q.indexOf('() => 5_000');
  const fnEnd = fn + '() => 5_000'.length;
  const boundary = exactOriginalFunctionBoundary('q.ts', q, key, fnEnd - 4);
  assert.deepEqual([boundary.start, boundary.end], [fn, fnEnd]);

  const jsx = `export default function Ask({ multiSelect, toggle, submit, index }) {
  return <button className="x" onClick={() => (multiSelect ? toggle(index) : submit(index))}>ok</button>;
}
`;
  const attr = jsx.indexOf('onClick');
  const arrow = jsx.indexOf('() => (multi');
  const arrowEnd = jsx.indexOf('))}', arrow) + 2;
  const jsxBoundary = exactOriginalFunctionBoundary('Ask.tsx', jsx, attr, arrowEnd - 1);
  assert.deepEqual([jsxBoundary.start, jsxBoundary.end], [arrow, arrowEnd]);
});

test('a render-prop child mapped from the end of its opening tag resolves to the render prop', () => {
  // LibreChat Conversations.tsx / ProjectChatList.tsx: the map puts the first
  // token on `index}>` and the last just before the callback's end.
  const src = `const Row = memo(({ parent, index, style }) => (
    <CellMeasurer parent={parent} rowIndex={index}>
      {({ registerChild }) => (
        <div ref={registerChild} style={style}>x</div>
      )}
    </CellMeasurer>
  ));
`;
  const fn = src.indexOf('({ registerChild })');
  const fnEnd = src.indexOf('      )}', fn) + 7;
  const mapped = src.indexOf('index}>');
  const boundary = exactOriginalFunctionBoundary('Row.tsx', src, mapped, fnEnd - 8);
  assert.deepEqual([boundary.start, boundary.end], [fn, fnEnd]);
});

test('a state-updater callback mapped from the setter call resolves to the updater, not the enclosing handler', () => {
  // LibreChat MemoryArtifacts.tsx and 37 others: `onClick={() => setShowInfo((prev) => !prev)}`.
  // The map puts the updater's first token on `setShowInfo(`, six characters
  // after the enclosing arrow's start, and its last token inside the updater.
  const src = `export default function Tg() {
  const [showInfo, setShowInfo] = useState(false);
  return <button onClick={() => setShowInfo((prev) => !prev)}>x</button>;
}
`;
  const outer = src.indexOf('() => setShowInfo');
  const outerEnd = src.indexOf(')}', outer) + 1;
  const updater = src.indexOf('(prev) => !prev');
  const updaterEnd = updater + '(prev) => !prev'.length;
  const inner = exactOriginalFunctionBoundary('Tg.tsx', src, src.indexOf('setShowInfo((prev)'), updaterEnd - 3);
  assert.deepEqual([inner.start, inner.end], [updater, updaterEnd]);
  const enclosing = exactOriginalFunctionBoundary('Tg.tsx', src, src.indexOf('onClick={'), outerEnd);
  assert.deepEqual([enclosing.start, enclosing.end], [outer, outerEnd]);
});

// Round five: a .ts source is parsed as TypeScript, not TSX. In TSX a generic
// arrow (`<TSchema>(schemas) => …`) or a `<T>value` assertion opens a JSX
// element, so every function after it vanished from the boundary list
// (LibreChat parsers.ts kept 1 of 18 functions, artifacts.ts 13 of 23).
test('.ts sources with a generic arrow keep every later function', () => {
  const ts = `export const pick = <TSchema>(schemas: Record<string, TSchema>, key: string): TSchema => schemas[key];
const cast = <string>(globalThis as any).name;
export function getFirstDefinedValue(values: string[]) {
  return values.find(Boolean);
}
export const extractVersion = (model: string): string => {
  return model.slice(1);
};
`;
  const fn = ts.indexOf('export function getFirstDefinedValue');
  const fnEnd = ts.indexOf('}\n', fn) + 1;
  const boundary = exactOriginalFunctionBoundary('parsers.ts', ts, fn, fnEnd);
  assert.deepEqual([boundary?.start, boundary?.end], [fn, fnEnd]);
  const arrow = ts.indexOf('(model: string)');
  const arrowEnd = ts.indexOf('};', arrow) + 1;
  const mapped = exactOriginalFunctionBoundary('parsers.ts', ts, arrow + 1, arrowEnd);
  assert.deepEqual([mapped?.start, mapped?.end], [arrow, arrowEnd]);
});

// A variable-initializer generic arrow whose map starts on the binding name
// (LibreChat artifacts.ts:310 `const lookupOwn = <T>(record, key) => …`; the
// generated `var qW=(e,t)=>…` maps its start to `lookupOwn` and its end to the
// `undefined` token, before the arrow's end).
test('a variable-initializer arrow mapped from its binding name resolves to the arrow', () => {
  const source = `export function isToolArtifactType(type: unknown) {
  return typeof type === 'string';
}

const lookupOwn = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
`;
  const arrow = source.indexOf('<T>(record');
  const arrowEnd = source.indexOf('undefined;', arrow) + 'undefined'.length;
  const mappedStart = source.indexOf('lookupOwn');
  const mappedEnd = source.indexOf('undefined;', arrow) + 1;
  const boundary = exactOriginalFunctionBoundary('artifacts.ts', source, mappedStart, mappedEnd);
  assert.deepEqual([boundary?.start, boundary?.end], [arrow, arrowEnd]);
});
