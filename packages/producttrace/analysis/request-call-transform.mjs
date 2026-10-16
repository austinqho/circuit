import ts from 'typescript';

/** Carry occurrence identity in the Axios config across asynchronous interceptors. */
export function configureRequestCall(source, requests) {
  const parsed = ts.createSourceFile('request.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const call = parsed.statements[0]?.expression;
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return source;
  const method = call.expression.name.text.toUpperCase();
  if (!requests.every(request => request.method === method)) return source;
  const index = ['POST', 'PUT', 'PATCH'].includes(method) ? 2
    : ['GET', 'DELETE', 'HEAD', 'OPTIONS'].includes(method) ? 1 : -1;
  if (index < 0 || call.arguments.some(ts.isSpreadElement) || call.arguments.length > index + 1) return source;
  const config = call.arguments[index];
  const wrapper = value => `globalThis.__productTraceRequestBridge.configureRequest(${value})`;
  if (config) return source.slice(0, config.getStart(parsed)) + wrapper(config.getText(parsed)) + source.slice(config.end);
  if (call.arguments.length !== index) return source;
  const end = call.arguments.end;
  return source.slice(0, end) + ', ' + wrapper('undefined') + source.slice(end);
}
