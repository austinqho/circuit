# producttrace on bulletproof-react

[bulletproof-react](https://github.com/alan2207/bulletproof-react) is an open-source React app (Vite, React Query, MSW mock API). This example runs it with producttrace and shows each session as sentences.

```sh
npm install                                  # at the repo root
npm run demo -w examples/bulletproof-react   # clone, install, build, serve
```

The first run clones the app at a pinned commit into `~/.cache/producttrace-examples/bulletproof-react`, installs it and builds it (about 6–7 minutes; later runs reuse the build, `-- --rebuild` forces one). Then:

- app: http://127.0.0.1:4173/
- story: http://127.0.0.1:8787/story (JSON), live at http://127.0.0.1:8787/story/stream (server-sent events)

Click around the app and reload `/story`. A real session reads like this:

```
Clicked the “Get started” button → handleStart
Went to /auth/login
Clicked the “Register” link
Typed in the “First Name” field
Typed a password in the “Password” field
Submitted the form with the “Register” button → <Form onSubmit> → POST /auth/register (200)
Clicked the “Discussions” link → lazy → GET /discussions?page=1 (200)
Submitted the form with the “Submit” button → <Form onSubmit> → POST /discussions (200, created discussion o-i5XxHxrRNCRQmoqgFSB), GET /discussions?page=1 (200)
Hovered the “View” link → <Link onMouseEnter> → GET /discussions/o-i5XxHxrRNCRQmoqgFSB (200), GET /comments?discussionId=o-i5XxHxrRNCRQmoqgFSB&page=1 (200)
Went to /app/discussions/o-i5XxHxrRNCRQmoqgFSB (discussion o-i5XxHxrRNCRQmoqgFSB)
Submitted the form with the “Submit” button → <Form onSubmit> → POST /comments (200, created comment zug8YRxVXbjXv9KhUTalV), GET /comments?discussionId=o-i5XxHxrRNCRQmoqgFSB&page=1 (200)
```

With the demo running, `npm run drive -w examples/bulletproof-react` clicks through that session headless and fails if an expected sentence is missing. It needs a Chromium: `CHROMIUM_PATH=/path/to/chrome`, Playwright's (`npx playwright install chromium`), or your installed Chrome.

## How it attaches

The app's files are not edited. `demo.mjs` writes a wrapper Vite config that imports the app's own config and adds one line, `...producttrace({ requestBridge: false, stamps: true, collector: 'http://127.0.0.1:8787' })`. The build runs in development mode so the collector, request bodies and control labels stay on; a production build turns them off.

## Known limits

- `vite dev` is not supported yet: functions are instrumented when the bundle is generated, so the app is built and served with `vite preview`.
- The instrumented build is slow: about 6–7 minutes for this app.
- The backend is a mock service worker, so every request stops at the network: "200" is the status the browser saw, with no server or database stops.
