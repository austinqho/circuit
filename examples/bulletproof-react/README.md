# producttrace on bulletproof-react

[bulletproof-react](https://github.com/alan2207/bulletproof-react) is an open-source React app (Vite, React Query, MSW mock API). This example runs it with producttrace and shows each session as sentences.

```sh
npm install                                  # at the repo root
npm run demo -w examples/bulletproof-react   # clone, install, build, serve
```

The first run clones the app at a pinned commit into `~/.cache/producttrace-examples/bulletproof-react` and installs it. The app then runs on the Vite dev server, ready in seconds. `-- --build` runs an instrumented build and serves it with `vite preview` instead (about 6–7 minutes; later runs reuse it, `-- --rebuild` forces one). Then:

- app: http://127.0.0.1:4173/
- story: http://127.0.0.1:8787/story (JSON), live at http://127.0.0.1:8787/story/stream (server-sent events)

Click around the app and reload `/story`. A session reads as goals, each with the steps under it (`segments` in the JSON, `event: segment` on the stream):

```
On the Register page, Maya Chen is signing up as maya+1792108092876@example.com for the team “Acme”, and lands on the App page.
    · Opens “Get started”; the app moves to /auth/login
    · Opens “Register”; the app moves to /auth/register
    · Enters “Maya” as the first name
    · Enters “Chen” as the last name
    · Enters maya+1792108092876@example.com as the email address
    · Sets a password
    · Enters “Acme” as the team name
    · Submits “Register”; the server returns user C2QefmDEePJBQNxLoUmdJ and team RqdkoGxxR223x3Nnn689K
    · The app moves to /app
In Discussions, Maya Chen is creating the first discussion, “Pricing page feedback”.
    · Opens “Discussions”; the discussion list loads empty, the app moves to /app/discussions
    · Clicks “Create Discussion”
    · Enters “Pricing page feedback” as the title
    · Writes a body (30 characters)
    · Submits “Submit”; the server creates discussion 32IBVKkidnmnItW7FQ5KB, 1 discussion loads
    · Clicks “Close”
In “Pricing page feedback”, Maya Chen is opening the discussion they just created and creating its first comment.
    · Opens “View”; the discussion “Pricing page feedback” loads, the comment list loads empty, the app moves to /app/discussions/32IBVKkidnmnItW7FQ5KB
    · Clicks “Create Comment”
    · Writes a body (19 characters)
    · Submits “Submit”; the server creates comment N3AYsbNVKyi3NSYIGaPNR, 1 comment loads
```

Steps join a goal only through something they share: the same form, an entity id, or the page a navigation reached. A redirect the app makes on its own straight after a write, away from the page the write was sent from, is where that goal lands. "First" is said only when the list of that type, read in the same goal, was empty. A hover that prefetched for a link is part of the click on it, a form typed in and left is its own goal ("…filling in “Title” and “Body” but leaves without sending it"), and an edit names only the fields that differ from what the server last returned. Values (“Acme”, the email, the name) come from the request and response bodies, never from keystrokes; passwords are never read, and long text shows only its length. Each step is also a line in `lines`, with the requests and IDs behind it.

With the demo running, `npm run drive -w examples/bulletproof-react` clicks through that session headless and fails if an expected line or goal is missing. It needs a Chromium: `CHROMIUM_PATH=/path/to/chrome`, Playwright's (`npx playwright install chromium`), or your installed Chrome.

## How it attaches

The app's files are not edited. `demo.mjs` writes a wrapper Vite config that imports the app's own config and adds one line, `...producttrace({ requestBridge: false, stamps: true, collector: 'http://127.0.0.1:8787' })`. Both the dev server and `--build` run in development mode, so the collector, request bodies and control labels stay on; a production build turns them off.

## Known limits

- The instrumented build (`--build`) is slow: about 6–7 minutes for this app. The dev server needs no build.
- On the dev server, a navigation that a React effect makes after a state change (the redirect to `/app` once registration logs the user in) is its own step ("The app moves to /app") after the Register step, not part of it as in a build.
- The backend is a mock service worker, so every request stops at the network: "200" is the status the browser saw, with no server or database stops.
