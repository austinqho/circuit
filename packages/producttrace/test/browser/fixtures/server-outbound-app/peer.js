// The second Express process of the server-outbound fixture (no database).
// Telemetry only through `node --import producttrace/backend/register peer.js`.
//   POST /peer/relay       calls back the URL the caller sent (global fetch)
//   GET  /peer/stats/:id   answers directly
const express = require('express');

const app = express();
app.use(express.json());
app.post('/peer/relay', async function relay(request, response) {
  const reply = await fetch(request.body.callback);
  response.json({ relayed: request.body.project, callback_status: reply.status, callback: await reply.json() });
});
app.get('/peer/stats/:id', function peerStats(request, response) {
  response.json({ id: request.params.id, replicas: 2 });
});
const server = app.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`listening ${server.address().port}`));
process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
