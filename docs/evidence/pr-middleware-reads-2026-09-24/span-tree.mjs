// Print the span tree of the fixture backend for nine requests, under the
// backend register of the tree given as argv[2] (main or this branch).
//   node docs/evidence/pr-middleware-reads-2026-09-24/span-tree.mjs <repo root>
import http from 'node:http'; import { spawn } from 'node:child_process';
import { MongoClient } from 'mongodb';
const root = process.argv[2];
const spans = [];
const sink = http.createServer((req, res) => { let b=''; req.on('data', c => b+=c); req.on('end', () => { spans.push(JSON.parse(b)); res.end(); }); });
await new Promise(r => sink.listen(0, '127.0.0.1', r));
const mc = new MongoClient('mongodb://127.0.0.1:27017'); await mc.connect(); await mc.db('producttrace_test_middleware').dropDatabase();
const child = spawn(process.execPath, ['--import', 'producttrace/backend/register', new URL('../../../test/browser/fixtures/middleware-reads-app/server.cjs', import.meta.url).pathname], { cwd: root, env: { ...process.env, PRODUCTTRACE_BACKEND_SPAN_ENDPOINT: `http://127.0.0.1:${sink.address().port}/spans` }, stdio: ['ignore','pipe','inherit'] });
const port = await new Promise(r => { let o=''; child.stdout.on('data', c => { o+=c; const m=/listening (\d+)/.exec(o); if (m) r(m[1]); }); });
const call = async (method, path, token, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(token ? {'x-user-token': token} : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.status; };
const T='token-u1';
console.log(await call('GET','/api/public/task-count'), await call('GET','/api/projects/p1/tasks'), await call('GET','/api/projects/p1/tasks',T), await call('PATCH','/api/projects/p1/tasks/t1',T,{title:'x'}), await call('POST','/api/projects/p1/summary',T), await call('POST','/api/projects/p1/ping',T), await call('POST','/api/projects/p1/archive',T), await call('POST','/api/projects/p1/explode',T), await call('GET','/api/projects/zz/tasks',T));
await new Promise(r => setTimeout(r, 600));
child.kill('SIGTERM'); sink.close(); await mc.db('producttrace_test_middleware').dropDatabase(); await mc.close();
const byTrace = new Map(); for (const s of spans) { (byTrace.get(s.trace_id) || byTrace.set(s.trace_id, []).get(s.trace_id)).push(s); }
for (const [t, list] of byTrace) {
  const server = list.find(s => s.kind === 'server'); if (!server) { console.log('no-server trace', list.map(s=>s.name).join(', ')); continue; }
  const kids = id => list.filter(s => s.parent_span_id === id);
  const print = (s, d) => { console.log(`${'  '.repeat(d)}${s.name} [${s.instrumentation?.name?.replace('@opentelemetry/instrumentation-','')}] ${s.attributes['producttrace.response.status_code'] ? 'WROTE '+s.attributes['producttrace.response.status_code'] : ''} ${s.attributes['producttrace.express.handler.kind']||''}`); for (const k of kids(s.span_id)) print(k, d+1); };
  print(server, 0);
  const orphans = list.filter(s => s !== server && !list.some(p => p.span_id === s.parent_span_id)); if (orphans.length) console.log('  ORPHANS', orphans.map(s => s.name));
}
