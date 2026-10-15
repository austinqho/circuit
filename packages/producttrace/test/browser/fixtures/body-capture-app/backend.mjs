// Tiny backend for the body-capture fixture. Deterministic payloads so the
// driver can compute every expected body independently of the runtime.
export const RENAME_RESPONSE = { _id: '65f0c0ffee0000000000abcd', projectId: 'p_42', name: 'Renamed', session: 'sess_resp_secret', sessionId: 'sess_42', updatedAt: '2026-09-24T00:00:00.000Z' };
export const REPORT_RESPONSE = {
  reportId: 'r_7', ownerId: 'u_7', title: 'Quarterly', accessToken: 'report-token-secret',
  rows: Array.from({ length: 300 }, (_, index) => ({ id: `row_${index}`, label: `Row number ${index}`, value: index * 3 })),
};
export const NOTES_TEXT = 'Note one\nNote two\n';
export const AVATAR_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2040, 0x2a)]);
export const STREAM_CHUNKS = ['{"line":1,"msg":"start"}\n', '{"line":2,"msg":"working"}\n', '{"line":3,"msg":"still working"}\n', '{"line":4,"msg":"almost"}\n', '{"line":5,"msg":"done"}\n'];
export const XHR_RESPONSE = { id: 'x_1', itemId: 'i_9', saved: true };
export const UPLOAD_RESPONSE = { uploadId: 'up_1' };
export const NOTE_RESPONSE = { noteId: 'n_3', ok: true };
export const TICKER_CHUNK = 'tick '.repeat(20); // 100 bytes every 50 ms, forever
export const LONG_TEXT_CHUNKS = Array.from({ length: 5 }, (_, index) => String(index).repeat(4096)); // 20,480 bytes, chunked
export const UNTYPED_RESPONSE = { untypedId: 'ut_1', token: 'untyped-secret' };

const json = (res, body) => { const text = JSON.stringify(body); res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) }); res.end(text); };

/** Returns true when the request was an API call it answered. `seen` collects request headers per path. */
export function handleApi(req, res, seen = []) {
  const url = new URL(req.url, 'http://fixture');
  const route = `${req.method} ${url.pathname}`;
  const chunks = [];
  const known = ['POST /api/projects/p_42/rename', 'GET /api/report', 'GET /api/notes', 'GET /api/avatar', 'GET /api/stream', 'POST /api/items/i_9', 'POST /api/upload', 'POST /api/notes',
    'POST /api/keys', 'GET /api/ticker', 'GET /api/longtext', 'DELETE /api/entries/e_1', 'GET /api/untyped', 'PUT /api/blob',
    'GET /api/pipe-text', 'GET /api/pipe-json', 'POST /api/slow', 'GET /api/quick'];
  if (!known.includes(route)) return false;
  const entry = { route, headers: req.headers, bytes: 0, written: 0, closed: false, start: Date.now() };
  seen.push(entry);
  res.on('close', () => { entry.closed = true; entry.written_at_close = entry.written; entry.open_ms = Date.now() - entry.start; });
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks); entry.bytes = body.length;
    if (route === 'POST /api/keys') return json(res, { echoed: true });
    if (route === 'GET /api/ticker') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      const next = () => { if (res.destroyed || res.writableEnded) return; res.write(TICKER_CHUNK); entry.written += Buffer.byteLength(TICKER_CHUNK); setTimeout(next, 50); };
      return next();
    }
    if (route === 'GET /api/longtext') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      let index = 0;
      const next = () => { if (index >= LONG_TEXT_CHUNKS.length) { res.end(); return; } res.write(LONG_TEXT_CHUNKS[index]); entry.written += LONG_TEXT_CHUNKS[index].length; index += 1; setTimeout(next, 30); };
      return next();
    }
    if (route === 'GET /api/pipe-text' || route === 'GET /api/pipe-json') {
      // Endless, no content-length: text/plain, or JSON of unknown length.
      const text = route === 'GET /api/pipe-text';
      res.writeHead(200, { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' });
      let index = 0;
      const next = () => {
        if (res.destroyed || res.writableEnded) return;
        const chunk = text ? TICKER_CHUNK : `${index === 0 ? '{"items":[' : ','}{"n":${index},"pad":"${'p'.repeat(80)}"}`;
        res.write(chunk); entry.written += Buffer.byteLength(chunk); index += 1; setTimeout(next, 50);
      };
      return next();
    }
    if (route === 'POST /api/slow') { setTimeout(() => { if (!res.destroyed) json(res, { slow: true }); }, 1000); return undefined; }
    if (route === 'GET /api/quick') return json(res, { quickId: 'q_1' });
    if (route === 'DELETE /api/entries/e_1') { res.writeHead(204); return res.end(); }
    // No content-type header at all (Node adds none by default).
    if (route === 'GET /api/untyped') { const text = JSON.stringify(UNTYPED_RESPONSE); res.writeHead(200, { 'content-length': Buffer.byteLength(text) }); return res.end(text); }
    if (route === 'PUT /api/blob') return json(res, { received: body.length });
    if (route === 'POST /api/projects/p_42/rename') return json(res, RENAME_RESPONSE);
    if (route === 'GET /api/report') return json(res, REPORT_RESPONSE);
    if (route === 'GET /api/notes') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(NOTES_TEXT); }
    if (route === 'GET /api/avatar') { res.writeHead(200, { 'content-type': 'image/png', 'content-length': AVATAR_BYTES.length }); return res.end(AVATAR_BYTES); }
    if (route === 'GET /api/stream') {
      // Chunked, no content-length, written over time.
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      let index = 0;
      const next = () => { if (index >= STREAM_CHUNKS.length) { res.end(); return; } res.write(STREAM_CHUNKS[index]); index += 1; setTimeout(next, 60); };
      return next();
    }
    if (route === 'POST /api/items/i_9') return json(res, XHR_RESPONSE);
    if (route === 'POST /api/upload') return json(res, UPLOAD_RESPONSE);
    if (route === 'POST /api/notes') return json(res, NOTE_RESPONSE);
    return undefined;
  });
  return true;
}
