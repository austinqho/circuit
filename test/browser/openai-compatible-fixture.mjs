import http from 'node:http';

const port = Number(process.env.PRODUCTTRACE_OPENAI_FIXTURE_PORT || 8999);
const model = 'gpt-3.5-turbo';

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === 'GET' && url.pathname === '/v1/models') {
    return json(response, 200, { object: 'list', data: [{ id: model, object: 'model', owned_by: 'producttrace-fixture' }] });
  }
  if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return json(response, 404, { error: { message: 'fixture route not found' } });
  let body = '';
  request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    let payload = {}; try { payload = JSON.parse(body); } catch {}
    const prompt = String(payload.messages?.at(-1)?.content || '');
    const content = /flat white/i.test(prompt)
      ? 'A flat white is espresso with a thin layer of velvety steamed milk.'
      : /tea shop/i.test(prompt)
        ? 'Tea Lantern, Steep Street, and The Quiet Kettle.'
        : 'Caffeine Connection, Bean There, and Daily Grind.';
    if (payload.stream !== true) return json(response, 200, { id: 'chatcmpl-producttrace', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const base = { id: 'chatcmpl-producttrace', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model };
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
});

await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(`OpenAI-compatible fixture listening on http://127.0.0.1:${port}/v1`);
