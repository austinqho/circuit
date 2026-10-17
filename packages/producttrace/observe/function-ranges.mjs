/**
 * Where a function starts and ends in a served script, so observe mode can
 * ask whether a stack frame is inside a declared handler. The debugger gives a
 * function's start ([[FunctionLocation]]) and a frame's current position, never
 * a function's end; the script's own syntax gives the end.
 */
import ts from 'typescript';

const offsetsOf = (text) => {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1)
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
};

/** Ranges for one script's source: `rangeAt(line, column)` (0-based) is the innermost function containing it. */
export function functionRanges(sourceText) {
  const source = ts.createSourceFile(
    'script.js',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const lineStarts = offsetsOf(sourceText);
  const functions = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body)
      functions.push({ start: node.getStart(source), end: node.getEnd() });
    ts.forEachChild(node, visit);
  };
  visit(source);
  const offset = (line, column) => (lineStarts[line] ?? sourceText.length) + (column || 0);
  return {
    offset,
    rangeAt(line, column) {
      const at = offset(line, column);
      let best = null;
      for (const range of functions)
        if (
          range.start <= at &&
          at < range.end &&
          (!best || range.end - range.start < best.end - best.start)
        )
          best = range;
      return best;
    },
  };
}
