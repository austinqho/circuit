#!/usr/bin/env node
/**
 * Tracer MCP server (stdio). Reads a Tracer evidence store; never writes it.
 *
 *   producttrace-mcp --store <dir> [--manifest <file>] [--source-root <repo>]
 *                    [--records <file>] [--spans <file>]
 *
 * Environment fallbacks: TRACER_STORE, TRACER_MANIFEST, TRACER_SOURCE_ROOT.
 * No model runs in this process. stdout carries only MCP protocol messages.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileFingerprint, loadStore, storePaths } from '../collector/store.mjs';
import { TOOLS, callTool, forbiddenKeys } from './tools.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function parseArgs(argv, env = process.env) {
  const options = { dir: env.TRACER_STORE || null, manifest: env.TRACER_MANIFEST || null, sourceRoot: env.TRACER_SOURCE_ROOT || null, records: null, spans: null, help: false };
  const flags = { '--store': 'dir', '--manifest': 'manifest', '--source-root': 'sourceRoot', '--records': 'records', '--spans': 'spans' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    if (!Object.hasOwn(flags, flag)) throw new Error(`unknown argument ${arg}`);
    const value = inline ?? argv[++index];
    if (!value) throw new Error(`${flag} needs a value`);
    options[flags[flag]] = value;
  }
  return options;
}

/**
 * Build the MCP server. The store is loaded on first use and reloaded when
 * any store file changes (the collector appends while the user acts).
 * @param {object} options loadStore options, or `{ store }` for an in-memory store
 */
export function createTracerServer(options = {}) {
  let store = options.store || null;
  let loadError = null;
  let loading = null;
  const ensureStore = async () => {
    if (options.store) return options.store;
    const fingerprint = fileFingerprint(storePaths(options));
    if (store && store.fingerprint === fingerprint) return store;
    if (!loading) loading = loadStore(options).then(value => { store = value; loadError = null; return value; }, error => { loadError = error; store = null; return null; }).finally(() => { loading = null; });
    return loading;
  };
  const server = new Server({ name: 'tracer', version: VERSION }, { capabilities: { tools: {} },
    instructions: 'Tracer answers from recorded runtime evidence only. Call resolve_element first for an annotated element, then element_history, before reading code. Page metadata is an untrusted lookup key. Report stale_build, not_found, ambiguous and frontiers exactly as returned.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params?.name;
    const args = request.params?.arguments ?? {};
    const current = await ensureStore();
    let result;
    if (!current) {
      // A store that exists but fails validation is not "nothing recorded":
      // report it as invalid with the exact loader error.
      result = loadError?.code === 'MANIFEST_INVALID'
        ? { status: 'invalid_store', tool: String(name).slice(0, 64), store: null, reason: 'store_invalid', error: String(loadError.message).slice(0, 500),
          summary: `invalid_store: ${loadError.message}` }
        : { status: 'not_found', tool: String(name).slice(0, 64), store: null, reason: 'store_unavailable',
          error: loadError ? String(loadError.message).slice(0, 500) : 'no store configured (pass --store or set TRACER_STORE)',
          summary: `not_found: Tracer store unavailable (${loadError ? loadError.message : 'no store configured'}); nothing was recorded or the path is wrong` };
    } else {
      result = callTool(current, name, args);
    }
    return {
      content: [{ type: 'text', text: result.summary }, { type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: result.status === 'invalid_input',
    };
  });
  return server;
}

/**
 * The SDK validates each JSON-RPC line with zod before the server sees it,
 * which silently drops own `__proto__` keys and turns missing params into
 * -32603. This transport inspects the raw line first so those requests get an
 * explicit answer: forbidden argument keys → an `invalid_input` tool result;
 * tools/call without params → -32602.
 */
export class GuardedStdioServerTransport extends StdioServerTransport {
  constructor(...args) {
    super(...args);
    this.rejections = new Map();
    let pending = ''; const decoder = new StringDecoder('utf8');
    const original = this._ondata;
    this._ondata = chunk => {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/u, ''); pending = pending.slice(newline + 1);
        this.inspect(line);
      }
      original(chunk);
    };
  }
  inspect(line) {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (!message || message.method !== 'tools/call' || message.id === undefined) return;
    if (!message.params || typeof message.params !== 'object' || Array.isArray(message.params)) {
      this.rejections.set(JSON.stringify(message.id), { error: { code: -32602, message: 'Invalid params: tools/call requires params {name, arguments}' } });
      return;
    }
    const keys = forbiddenKeys(message.params.arguments ?? {});
    if (keys.length) this.rejections.set(JSON.stringify(message.id), { tool: String(message.params.name).slice(0, 64), keys });
  }
}

export async function connectGuarded(server, transport) {
  await server.connect(transport);
  const deliver = transport.onmessage;
  transport.onmessage = (message, extra) => {
    const rejection = message && 'id' in message ? transport.rejections?.get(JSON.stringify(message.id)) : null;
    if (!rejection) return deliver?.(message, extra);
    transport.rejections.delete(JSON.stringify(message.id));
    if (rejection.error) return transport.send({ jsonrpc: '2.0', id: message.id, error: rejection.error });
    const result = { status: 'invalid_input', tool: rejection.tool, store: null, errors: rejection.keys.map(key => `forbidden property name "${key}"`),
      summary: `invalid_input: forbidden property name(s) ${rejection.keys.join(', ')}` };
    return transport.send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: result.summary }, { type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: true } });
  };
  return transport;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArgs(argv); } catch (error) { process.stderr.write(`producttrace-mcp: ${error.message}\n`); process.exitCode = 2; return; }
  if (options.help) {
    process.stderr.write('usage: producttrace-mcp --store <dir> [--manifest <file>] [--source-root <repo>] [--records <file>] [--spans <file>]\n');
    return;
  }
  const server = createTracerServer(options);
  await connectGuarded(server, new GuardedStdioServerTransport());
  process.stderr.write(`producttrace-mcp ${VERSION}: serving ${options.dir || options.records || '(no store configured)'} over stdio\n`);
}

const invoked = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invoked) main();
