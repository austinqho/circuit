import fs from 'node:fs';
import { loadStore, createStore } from '/Users/austinho/dev/tracer-n4-body-capture/collector/store.mjs';
import { callTool } from '/Users/austinho/dev/tracer-n4-body-capture/mcp/tools.mjs';
const dir = process.argv[2];
const l = await loadStore({ dir, sourceRoot: '/Users/austinho/dev/fixtures/anything-llm' });
const s = createStore({ ...l, records: l.records, spans: l.spans, manifest: l.manifest, manifestsByBuild: l.manifestsByBuild, runs: l.runs, sourceRoot: '/Users/austinho/dev/fixtures/anything-llm', now: () => Date.now() + 1e6 });
const rows = s.records;
const pages = rows.filter(r => r.kind === 'capture.page').map(r => ({ page: r.capture_page_id, bodies: r.bodies }));
const bodies = rows.filter(r => r.kind === 'network.body');
const reqs = rows.filter(r => r.kind === 'network.request' && !r.internal);
const reqKeys = new Set(reqs.map(r => `${r.capture_page_id}|${r.request_occurrence_id}`));
const out = { pages, coverage: pages.map(p => { const c = s.coverageFor(p.page); return { page: p.page, complete: c.complete, reasons: c.reasons, bodies: c.bodies, body_rows: c.body_rows }; }),
  requests: reqs.length, body_rows: bodies.length, by: {}, linked: bodies.every(b => reqKeys.has(`${b.capture_page_id}|${b.request_occurrence_id}`)),
  truncated: bodies.filter(b => b.truncated).length, not_captured: bodies.filter(b => b.captured === false).map(b => b.reason), redactions: bodies.reduce((a, b) => a + (b.redactions || 0), 0),
  body_bytes: bodies.reduce((a, b) => a + Buffer.byteLength(JSON.stringify(b)), 0), all_bytes: rows.reduce((a, b) => a + Buffer.byteLength(JSON.stringify(b)), 0) };
for (const b of bodies) { const k = `${b.direction}:${String(b.content_type).split(';')[0]}:${b.format || b.reason}`; out.by[k] = (out.by[k] || 0) + 1; }
out.bytes_per_request = Math.round(out.body_bytes / out.requests);
const raw = fs.readFileSync(dir + '/records.jsonl', 'utf8');
out.raw_has_authorization_or_cookie_key = /"authorization"|"cookie"/i.test(raw);
out.raw_redacted_values = (raw.match(/\[redacted\]/g) || []).length;
// Requests with a request body: list method path and MCP ids.
const samples = [];
for (const r of reqs.filter(r => r.action_id && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.method))) {
  const chain = callTool(s, 'action_chain', { action_id: r.action_id });
  const seg = chain.segments.find(x => x.request_occurrence_id === r.request_occurrence_id);
  samples.push({ method: r.method, path: seg?.path, bodies: chain.bodies, request_ids: seg?.body?.ids, request_fields: seg?.body?.fields, response_ids: seg?.response_body?.ids, response_truncated: seg?.response_body?.truncated, line: seg?.summary });
}
out.samples = samples;
console.log(JSON.stringify(out, null, 2));
