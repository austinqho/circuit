# circuit-web: the producttrace test bench

A local website plus tools for Claude that answer one question fast: **does producttrace work on a real React app it has never seen?**

Give it an open-source repo. It clones it, installs its dependencies, attaches producttrace's one plugin line in a wrapper config (the repo's source is never edited), runs it on the Vite dev server, and starts a collector. Then:

- **you** click around the app inside the page and watch the package's sentences appear next to it, live;
- **Claude** drives the same app with a headless browser through MCP tools, reads back what the package said about each step, and gets a scorecard to hillclimb on.

## Start it

From the repo root:

```sh
npm install
npm start      # http://127.0.0.1:4500
```

On first start the bench puts bulletproof-react on itself (set `CIRCUIT_DEFAULT_REPO` to another repo, or to an empty string for none). The first start takes as long as cloning and installing; after that the app is up in seconds. The page shows the progress. Playwright's Chromium is downloaded on first use if the machine has none, and yarn or pnpm are fetched through npx when they are not installed. Add more repos from the **Bench** button. After that, **Rebuild with current package** reuses the clone and install and restarts the dev server, so testing a package change takes seconds.

To score the app as users get it, add it with `mode: "build"` (or `circuit_rebuild` with `mode: "build"`). That makes a production build and serves the files; for bulletproof-react the build takes about 4 minutes.

## Give Claude the tools

```sh
claude mcp add circuit -- node apps/web/src/mcp.mjs
```

The MCP server talks to the website's server and starts it if it is not running, so whatever Claude does shows up on the page you have open.

| Tool                                      | What it does                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `circuit_add_app`                         | Add a repo (`owner/repo`, a GitHub URL, a `/tree/<ref>/<dir>` URL, or a local path). Returns at once; the build runs in the background.                                                                             |
| `circuit_app_status`                      | Status and build log tail. `wait_seconds` blocks while it builds.                                                                                                                                                   |
| `circuit_act`                             | One user action in a headless browser: `goto`, `click`, `fill`, `type`, `press`, `select`, `check`, `hover`, `wait`, `back`. Returns what the package wrote since the step began and the page's accessibility tree. |
| `circuit_snapshot` / `circuit_screenshot` | The current page as an accessibility tree or a PNG.                                                                                                                                                                 |
| `circuit_report`                          | Each step next to the package's sentences and the requests the browser really sent, plus a scorecard.                                                                                                               |
| `circuit_score_narration`                 | Your 0–2 rubric scores for each part title in `report.narration`; recorded as `reads_like_a_person_pct`.                                                                                                            |
| `circuit_story`                           | The package's own session story for the current build.                                                                                                                                                              |
| `circuit_tracer`                          | Any of the package's own MCP tools (`action_chain`, `recent_actions`, ...) against this app's store.                                                                                                                |
| `circuit_rebuild`                         | Restart with the package as it is on disk now; `mode` switches between `dev` and `build`. Each build gets a fresh store.                                                                                            |
| `circuit_reset`                           | End the browser's page session and clear the steps.                                                                                                                                                                 |
| `circuit_verify`                          | Check the package does not change how the app behaves: the steps run twice without the package and once with it, and every difference, the overhead and the package's footprint come back. Takes minutes; poll it.  |

Targets for `circuit_act` are visible text (`"Get started"`), `{ role, name }`, `{ label }`, `{ placeholder }`, `{ text }`, `{ testid }`, or any Playwright selector.

### The hillclimb loop

1. `circuit_add_app`, then `circuit_app_status` with `wait_seconds: 900`.
2. Click through a real flow with `circuit_act`.
3. `circuit_report`: read where the package said nothing, named no element, missed a request or got an ID wrong.
4. Change the package, `circuit_rebuild`, rerun the same steps, compare scorecards.
5. To hillclimb the wording too, read `report.narration` (each part's title with its evidence lines and a rubric in the annotation voice: past tense, verb first, quoted labels and values, a "to …" purpose only when the evidence shows it) and send your 0–2 scores per criterion with `circuit_score_narration`. They become `reads_like_a_person_pct` in that build's scorecard and history.

`node apps/web/scripts/example-run.mjs` does steps 1 to 3 on bulletproof-react over MCP, the same way Claude does.

### The scorecard

| Field                          | Meaning                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `steps_with_a_line_pct`        | Steps (other than goto/wait) during which the package wrote at least one sentence                                  |
| `lines_naming_the_element_pct` | Sentences that name the element (`element.label`)                                                                  |
| `lines_naming_a_handler_pct`   | Sentences that name the code that handled the action                                                               |
| `lines_with_entity_ids_pct`    | Sentences carrying real entity IDs                                                                                 |
| `request_recall_pct`           | Requests the package attached to sentences, against fetch/XHR requests the browser actually sent in the same steps |

Lines are paired with steps by each step's time window. That pairing is the bench's own bookkeeping for judging, never something the package claims.

### Checking the install is read-only

```sh
node apps/web/scripts/verify.mjs                       # bulletproof-react, flows/bulletproof-react.jsonl
node apps/web/scripts/verify.mjs --repo excalidraw/excalidraw --app-dir excalidraw-app --flow apps/web/flows/excalidraw.jsonl
```

The flow runs three times in fresh browsers on the dev server: twice without the package (the control) and once with it. Whatever both plain runs agree on and the traced run does not is reported as a divergence:

| Kind             | What differed                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| `step_failed`    | A step that worked without the package failed with it (or the reverse)            |
| `url`            | The URL after a step                                                              |
| `page`           | The accessibility tree after a step, once the page stopped changing               |
| `requests`       | fetch/XHR requests sent: method, path and a hash of the body                      |
| `console_errors` | `console.error` messages and uncaught errors                                      |
| `storage`        | localStorage, sessionStorage, cookie names and IndexedDB record counts at the end |

Run tokens (`{{run}}` in a step value), UUIDs, timestamps, clock times and generated ids are normalized, and anything the two plain runs already disagree on is the app's own noise. A slower traced page gets up to 10 s to reach the same state before it counts as different. The result also reports the overhead (Chrome's script time with and without the package, and the worst step) and the footprint the package adds on purpose: DOM attributes, request headers and browser APIs it replaces. The script exits 1 when the app behaved differently, and the full runs are saved next to the app's work folder.

## HTTP API

Everything the tools do is plain HTTP on the same server; see the header of `src/server.mjs`.

## Limits

- Vite + React apps only. In a monorepo the React app with a Vite config is picked automatically; pass `app_dir` to choose another.
- Frontend only. Apps that need their own backend work when they mock it (bulletproof-react uses MSW); running a repo's backend with `producttrace/backend/register` is not wired up yet.
- Dependencies install with lifecycle scripts off. The only file changed in the throwaway clone is the lockfile's registry host (mirrors such as npmmirror are pointed at registry.npmjs.org).
- The headless browser only loads the app's own origin and localhost. External fonts and analytics are blocked, because they hang in sandboxes.
- When the package build has no `/story` endpoint, the Activity panel shows one line saying sentences are unavailable for that build; rebuild with a package that has it.

## Layout

`src/bench.mjs` is the module everything goes through (`add`, `status`, `act`, `report`, `rebuild`, ...). Behind it: `target.mjs` (clone, detect, install, wrapper config, build, serve), `browser.mjs` (Playwright session and step log), `verify.mjs` (the read-only check), `tracer.mjs` (reads the package's `/story` and MCP tools, and builds the report), and `package.mjs` (finds the package under test). `server.mjs` is the website and HTTP API, `mcp.mjs` the MCP server, `public/index.html` the page. Set `PRODUCTTRACE_DIR` to test a package checkout other than the workspace one.
