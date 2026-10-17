import http from 'node:http';
import { defineConfig } from 'vite';

// A second origin for the cross-origin case: it allows any origin but no extra
// request headers, like many public APIs. The page asks the dev server for its URL.
const crossOrigin = () => ({
  name: 'probe-cross-origin',
  configureServer(server) {
    const cross = http
      .createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
        res.end('cross-data');
      })
      .listen(0, '127.0.0.1');
    server.httpServer?.on('close', () => cross.close());
    server.middlewares.use('/probe/cross-origin', (req, res) =>
      res.end(`http://127.0.0.1:${cross.address().port}`),
    );
    server.middlewares.use('/probe/items', (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(['first', 'second']));
    });
  },
});

export default defineConfig({
  plugins: [crossOrigin()],
  esbuild: { jsx: 'automatic' },
});
