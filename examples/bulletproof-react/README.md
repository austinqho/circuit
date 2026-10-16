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
Registered as maya+1792109982822@example.com for the team “Acme” and landed on the Dashboard page.
    · Clicked the “Get started” button on the home page to open the “Log in to your account” page.
    · Clicked the “Register” link to open the “Register your account” page.
    · Typed “Maya” into the “First Name” field.
    · Typed “Chen” into the “Last Name” field.
    · Typed “maya+1792109982822@example.com” into the “Email Address” field.
    · Typed a password into the “Password” field.
    · Typed “Acme” into the “Team Name” field.
    · Clicked the “Register” button to create user _kycFDESw18U5ixcM-jtJ and team V89-8dIGHKH-w5GQiIfW5.  [Signed in as user _kycFDESw18U5ixcM-jtJ (Maya Chen)]
    · Landed on the Dashboard page.
Opened the Discussions page and created the first discussion titled “Pricing page feedback”.
    · Clicked the “Discussions” link on the Dashboard page to view the discussion list, which was empty.  [0 discussions]
    · Clicked the “Create Discussion” button.
    · Typed “Pricing page feedback” into the “Title” field.
    · Typed a 30-character body into the “Body” field.
    · Clicked the “Submit” button to create discussion RcGLwqSVvGQfsvG2tb-Vu.  [New discussion “Pricing page feedback” (RcGLwqSVvGQfsvG2tb-Vu); 1 discussion: “Pricing page feedback”]
    · Clicked the “Close” button.
Opened “Pricing page feedback”, the discussion they just created, and posted its first comment.
    · Clicked the “View” link on the Discussions page to open the discussion “Pricing page feedback”.  [Discussion “Pricing page feedback” (RcGLwqSVvGQfsvG2tb-Vu); 0 comments]
    · Clicked the “Create Comment” button.
    · Typed a 19-character body into the “Body” field.
    · Clicked the “Submit” button to create comment zJugDX8NLBgXfW-7fsGew.  [New comment (zJugDX8NLBgXfW-7fsGew); 1 comment]
```

Goals and steps are written the way NAPsack's annotators caption a screen: past tense, verb first, the app's own labels and the sent values quoted, and "to …" only when that line's own request or navigation shows the result. A page is named by its own document title when the app gives each page one, else by the link that led there. The brackets are each step's `facts`: what was there (who was signed in, what loaded or was made), not what was done. `narrative[].text` is the whole visit, its goals joined with ", then".

Steps join a goal only through something they share: the same form, an entity id, or the page a navigation reached. A redirect the app makes on its own straight after a write, away from the page the write was sent from, is where that goal lands. "First" is said only when the list of that type, read in the same goal, was empty. A hover that prefetched for a link is part of the click on it, a form typed in and left is its own goal ("Started a comment on “Pricing page feedback” but left without sending it."), and an edit names only the fields that differ from what the server last returned. Values (“Acme”, the email, the name) come from the request and response bodies, never from keystrokes; passwords are never read, and long text shows only its length. Each step is also a line in `lines`, with the requests and IDs behind it.

With the demo running, `npm run drive -w examples/bulletproof-react` clicks through that session headless and fails if an expected line or goal is missing. It needs a Chromium: `CHROMIUM_PATH=/path/to/chrome`, Playwright's (`npx playwright install chromium`), or your installed Chrome.

## How it attaches

The app's files are not edited. `demo.mjs` writes a wrapper Vite config that imports the app's own config and adds one line, `...producttrace({ requestBridge: false, stamps: true, collector: 'http://127.0.0.1:8787' })`. Both the dev server and `--build` run in development mode, so the collector, request bodies and control labels stay on; a production build turns them off.

## Known limits

- The instrumented build (`--build`) is slow: about 6–7 minutes for this app. The dev server needs no build.
- On the dev server, a navigation that a React effect makes after a state change (the redirect to `/app` once registration logs the user in) is its own step ("The app moves to /app") after the Register step, not part of it as in a build.
- The backend is a mock service worker, so every request stops at the network: "200" is the status the browser saw, with no server or database stops.
