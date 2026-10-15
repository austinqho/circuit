# circuit-web: the producttrace test bench

A local website plus tools for Claude that answer one question fast: **does producttrace work on a real React app it has never seen?**

Give it an open-source repo. It clones it, installs its dependencies, builds it with producttrace's one plugin line (the repo's source is never edited), serves it, and starts a collector. Then:

- **you** click around the app inside the page and watch the package's sentences appear next to it, live;
- **Claude** drives the same app with a headless browser through MCP tools, reads back what the package said about each step, and gets a scorecard to hillclimb on.

## Start it

From the repo root:

```sh
npm install
npm start      # http://127.0.0.1:4500
```

On first start the bench puts bulletproof-react on itself (set `CIRCUIT_DEFAULT_REPO` to another repo, or to an empty string for none). The first build takes several minutes (cloning, installing, then a producttrace build, which is the slow part); the page shows its progress. Playwright's Chromium is downloaded on first use if the machine has none, and yarn or pnpm are fetched through npx when they are not installed. Add more repos from the **Bench** button. After that, **Rebuild with current package** reuses the clone and install, so testing a package change costs one build.

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
| `circuit_story`                           | The package's own session story for the current build.                                                                                                                                                              |
| `circuit_tracer`                          | Any of the package's own MCP tools (`action_chain`, `recent_actions`, ...) against this app's store.                                                                                                                |
| `circuit_rebuild`                         | Rebuild with the package as it is on disk now. Each build gets a fresh store.                                                                                                                                       |
| `circuit_reset`                           | End the browser's page session and clear the steps.                                                                                                                                                                 |

Targets for `circuit_act` are visible text (`"Get started"`), `{ role, name }`, `{ label }`, `{ placeholder }`, `{ text }`, `{ testid }`, or any Playwright selector.

### The hillclimb loop

1. `circuit_add_app`, then `circuit_app_status` with `wait_seconds: 900`.
2. Click through a real flow with `circuit_act`.
3. `circuit_report`: read where the package said nothing, named no element, missed a request or got an ID wrong.
4. Change the package, `circuit_rebuild`, rerun the same steps, compare scorecards.

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

## HTTP API

Everything the tools do is plain HTTP on the same server; see the header of `src/server.mjs`.

## Limits

- Vite + React apps only. In a monorepo the React app with a Vite config is picked automatically; pass `app_dir` to choose another.
- Frontend only. Apps that need their own backend work when they mock it (bulletproof-react uses MSW); running a repo's backend with `producttrace/backend/register` is not wired up yet.
- Dependencies install with lifecycle scripts off. The only file changed in the throwaway clone is the lockfile's registry host (mirrors such as npmmirror are pointed at registry.npmjs.org).
- The headless browser only loads the app's own origin and localhost. External fonts and analytics are blocked, because they hang in sandboxes.
- When the package build has no `/story` endpoint, the Activity panel shows one line saying sentences are unavailable for that build; rebuild with a package that has it.

## Layout

`src/bench.mjs` is the module everything goes through (`add`, `status`, `act`, `report`, `rebuild`, ...). Behind it: `target.mjs` (clone, detect, install, wrapper config, build, serve), `browser.mjs` (Playwright session and step log), `tracer.mjs` (reads the package's `/story` and MCP tools, and builds the report), and `package.mjs` (finds the package under test). `server.mjs` is the website and HTTP API, `mcp.mjs` the MCP server, `public/index.html` the page. Set `PRODUCTTRACE_DIR` to test a package checkout other than the workspace one.
