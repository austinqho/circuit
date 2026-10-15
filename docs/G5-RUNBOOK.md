# G5 runbook: the demo in Codex's in-app browser (Part B)

For Austin. This is the human half of `docs/gates/G5-demo.md`: the same scenario the headless rehearsal ran (`docs/evidence/g5-anything-llm-2026-09-23/`), but in the Codex desktop app's in-app browser (IAB), with Codex's model choosing the calls. Nothing here was run from the agent branch: every step that touches Codex or `~/.codex` is yours to take.

Time: about 10 minutes, of which about 3 are the instrumented build.

## What to know before you start

- **`data-*` attributes never reach the model.** Codex's manual annotation sends the page URL, `Target` (aria-label or the first 80 characters of text), `Target selector` (≤ 4 levels of tag / `#id` / two classes / `:nth-of-type`), `Target path` and `Nearby text` (research note §1). The Tracer key (`data-tracer-el`) is not in any of them. So Codex must read the key from the live page with its browser tool (skill step 2): query the selector, keep the match whose text agrees, `closest('[data-tracer-el]')`. If Codex cannot run JavaScript in the IAB in your setup, it falls back to `resolve_element` without a key, which answers `ambiguous` with candidates (never a pick). Developer mode (CDP access in the IAB) is what gives Codex that browser step, as far as we know; not verified.
- **OAI declarative attributes are dormant.** `oai-annotatable` / `oai-annotation-metadata` are read by Codex only when OpenAI's site-annotation API gate is on. It is off for everyone we can observe. Tracer feature-detects (`document.oai.annotation`) and writes nothing when it is absent. `producttrace({ oaiAttributes: 'always' })` forces the attributes for testing with a stub; it is dev-only and changes nothing while the gate is off. Do not flip OpenAI flags or edit the app's cache (handoff §4.7).
- **The failure is seeded.** anything-llm has no genuine 4xx that fits the scenario without an LLM key (gate §3.1), so the G6 seed makes the workspace update handler answer 422 for names containing whitespace. It lives on a throwaway branch of the fixture and is removed at the end.

## 1. Seed the fixture (throwaway branch)

```sh
cd /Users/austinho/dev/fixtures/anything-llm
git status --porcelain            # must print nothing
git checkout -b g5-scenario
git -c user.name=g5 -c user.email=g5@local am \
  /Users/austinho/dev/tracer-g5/docs/evidence/g5-anything-llm-2026-09-23/fixture-seed.patch
git log --oneline -1              # "G6 seed: update handler rejects names containing whitespace with 422 (seeded bug)"
ls .tracer 2>/dev/null            # must not exist: start from an empty store
```

## 2. Start the app, the backend and the collector (hold mode)

From the Tracer checkout (this branch or main after merge). Ports 4100 (app), 4101 (fixture server), 4102 (collector) must be free.

```sh
cd /Users/austinho/dev/tracer-g5
node test/browser/build-fresh-repo.mjs \
  --repo /Users/austinho/dev/fixtures/anything-llm \
  --session test/browser/sessions/anything-llm-g5.mjs \
  --out docs/evidence/g5-codex-iab-$(date +%Y-%m-%d) \
  --port 4100 \
  --store /Users/austinho/dev/fixtures/anything-llm/.tracer --label g5-codex-iab --collector \
  --plugin-options '{"stamps":true,"requestBridge":false}' \
  --work /Users/austinho/dev/fixtures/.g2-work/g5-iab \
  --hold
```

What it does: packs Tracer, installs the tarball outside the fixture, builds the fixture's frontend twice through a wrapper config that adds the one line `...producttrace({"stamps":true,"requestBridge":false,"collector":{"url":"http://127.0.0.1:4102","force":true}})` (`force` because the harness builds in Vite production mode, where the sink is otherwise off; the collector URL must be loopback unless `allowRemote: true`) (the fixture's source is not written), runs the marker, parity and smoke gates, starts the fixture server with backend telemetry (`node --import <tarball>/backend/register.js index.js`, i.e. `producttrace/backend/register`; no hand-added loader flag; needs Node >= 20.6 or 18.19 for `module.register`, older Node needs `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` before `--import`), starts `producttrace-collector --store <fixture>/.tracer` from the tarball, and serves the instrumented build. When it prints a `holding` JSON block (also written to `<out>/hold.json`) it is ready. Leave it running.

`hold.json` holds the URL (`http://127.0.0.1:4100/`) and the exact MCP command. With the `--work` path above the MCP server is at
`/Users/austinho/dev/fixtures/.g2-work/g5-iab/install/node_modules/producttrace/mcp/server.mjs`.

## 3. Give Codex the Tracer MCP server

### Recommended: `~/.codex/config.toml`

Settled 2026-09-23 (Part B run): this entry registers the server (`codex mcp list` shows `tracer` enabled) but the desktop-app thread did not expose `resolve_element` and the other tools natively; Codex found the command from the config and drove the server over stdio from a shell, following the skill. Keep the entry; the skill's fallback depends on it.

```toml
[mcp_servers.tracer]
command = "node"
args = [
  "/Users/austinho/dev/fixtures/.g2-work/g5-iab/install/node_modules/producttrace/mcp/server.mjs",
  "--store", "/Users/austinho/dev/fixtures/anything-llm/.tracer",
  "--source-root", "/Users/austinho/dev/fixtures/anything-llm",
]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

This differs from `plugin/README.md`'s `npx --no-install producttrace-mcp …` form only because the fixture does not have `producttrace` in its own `node_modules` (installing it there would edit the fixture); the server is the same file from the same tarball. Restart the Codex app so it reads the config, and check with `codex mcp list` that `tracer` is listed. (Unverified: `codex mcp list` is taken from the CLI's help text and was not run for this runbook. If it does not exist in your Codex version, ask Codex in a new thread to list its MCP tools instead; `resolve_element`, `element_history`, `action_chain`, `recent_actions` and `compare_chains` should appear.) The server reloads the store whenever the collector appends, so it can start before any row exists; until the first action it answers `not_found` / `store_unavailable`.

### The skill

The `config.toml` entry gives Codex the tools, not the instructions. Give it the skill one of these ways (pick one):
- install the repo-local plugin (below), which carries `skills/tracer-annotations/SKILL.md`;
- copy `plugin/AGENTS-snippet.md` to `AGENTS.md` at the fixture root and hide it from git with `echo AGENTS.md >> .git/info/exclude` (the tracked tree and `git status --porcelain` stay clean; delete both afterwards);
- or start the Codex prompt with "Use the tracer MCP (tracer-annotations skill) before reading code." (weakest: it changes the demo question).

### Secondary: the repo-local plugin (unverified)

```sh
codex plugin marketplace add /Users/austinho/dev/tracer-g5     # holds .agents/plugins/marketplace.json
codex plugin add tracer@tracer-local
```
Its launcher (`plugin/bin/tracer-mcp.mjs`) finds the server in the nearest `node_modules/producttrace` at or above `TRACER_PROJECT_ROOT`, so point it at the tarball install and pass the store explicitly; these must be in the environment Codex starts plugin servers with (not verified how the desktop app passes `env_vars`):
```sh
export TRACER_PROJECT_ROOT=/Users/austinho/dev/fixtures/.g2-work/g5-iab/install
export TRACER_STORE=/Users/austinho/dev/fixtures/anything-llm/.tracer
export TRACER_SOURCE_ROOT=/Users/austinho/dev/fixtures/anything-llm
```
If `tracer` tools do not appear, use the `config.toml` entry instead.

## 3b. First check: does the model read `data-tracer-el` at all?

Unknown until you try: whether Codex's model can inspect the IAB page (run JavaScript or read attributes) depends on its browser tools in your setup (developer mode is what the research says gives it page access). Check this before the demo, on the running app:

1. Open `http://127.0.0.1:4100/` in the IAB, annotate the sidebar **+** (New Workspace) button, and ask: "Read the data-tracer-el attribute of the annotated element (or its nearest ancestor that has one) with your browser tool. Reply with the value only."
2. **It answers a value like `p_…:…-…#n1`**: the key path works. Do the demo as written (section 5 onwards); expect the exact answer.
3. **It says it cannot inspect the page, or answers without a `p_` key**: the fallback path is the demo. Everything in sections 4 and 5 stays the same; the expected answer changes to the one under "Fallback answer" in section 5. That is still a correct Tracer answer; it just cannot say which element for sure.
4. **It can read attributes but cannot run JavaScript in the IAB** (for example it can only query an element or take a snapshot): ask it to read `data-tracer-el` on the element matching the `Target selector` or on its nearest ancestor that has one. That is the key path. The packaged `lookupSnippet` is only for tools that evaluate JS, and it is generated in Node, e.g. `node -e "import('producttrace/mcp/annotation-lookup').then(m => console.log(m.lookupSnippet({ selector: '<Target selector>', target: '<Target>', nearby_text: '<Nearby text>' })))"` from a directory where `producttrace` is installed (here: the harness's install dir). Codex needs a shell for that; if it cannot run one, it reads the attribute directly as above. If it can do neither, the demo is the fallback path (step 3).

## 4. Open the app in the IAB and perform the actions

Open a Codex task on the fixture (`/Users/austinho/dev/fixtures/anything-llm`) and open `http://127.0.0.1:4100/` in its in-app browser. Then, as a user (real clicks and typing):

1. Sidebar **+** (New Workspace) → name `Tracer G5` → **Save**.
2. The workspace's gear icon (General appearance settings) → **General Settings**.
3. Replace the name with `tracer-g5-first` → **Update Workspace**. Toast: "Workspace updated!".
4. Replace the name with `Tracer G5 second` (with spaces) → **Update Workspace**. Toast: "Error: Invalid workspace name." (the seeded 422).
5. Replace the name with `tracer-g5-third` → **Update Workspace**. Toast: "Workspace updated!".
6. Type one more character at the end of the name. **Update Workspace** appears again (the form only shows it while there are unsaved changes). Do not click it.

## 5. Annotate and ask

Enter annotation mode, click the **Update Workspace** button, and write the comment:

> why did this fail?

Submit. Do not add anything else: the question has to require history, and the button itself did not fail the last time.

### What a correct answer contains

Graded against the rehearsal's recorded answer (`docs/evidence/g5-anything-llm-2026-09-23/AGENT-READS.md`); ids and timestamps will differ, the rest should not:

- Tool calls, in order: a browser-tool read of `data-tracer-el` (the key looks like `p_f067e70e6029:117-485#n1`), `resolve_element`, `element_history`, `action_chain` on the failing attempt. No code read before them.
- Component: `CTAButton`, `frontend/src/components/lib/CTAButton/index.jsx:8` (confidence `exact`).
- Entry handler: `frontend/src/pages/WorkspaceSettings/GeneralAppearance/index.jsx:26` (`handleUpdate`, the form's `onSubmit`).
- The last three attempts, newest first (`element_history`'s `n` counts attempts, default 10, so extra clicks do not push one out): `POST /api/workspace/tracer-g5/update` → route `/api/workspace/:slug/update` **200**, then **422**, then **200**; each stops at `handler` because "no database span descends from the admitted handler span" (anything-llm's Prisma/SQLite is not instrumented), the 422 one prefixed "server responded 422;".
- The failing attempt's chain: request, route 422, handlers `validatedRequest`, `<anonymous>`, `<anonymous>`; stopped at handler. Then, reading `server/endpoints/workspaces.js` from that route, the whitespace check that returns 422.
- What it must **not** do: claim a database write or a cause Tracer did not record; call the no-key fallback's top candidate a match.

### Fallback answer (Codex cannot run JS or read attributes in the IAB)

The skill sends the raw evidence instead: `resolve_element({ url, selector, element_path, name: "Update Workspace", nearby_text: "Update Workspace" })`. With the code after the independent grade (candidates grouped by element key; §13 of the gate doc), the same arguments on the rerun store (`docs/evidence/g5-anything-llm-2026-09-23b/`) answer:

> ambiguous: 4 observed target(s) match; best button (ancestor tag=button (the annotated element is inside a recorded <button> target)) with 9 actions. Not a pick: read data-tracer-el from the live element for an exact key.

with `confidence: "ambiguous"` and four candidates, one element key each: `<button>` `CTAButton/index.jsx:8` (9 actions, the right one), the create-workspace modal's `type="submit"` button `Modal/index.jsx:293` (3), the gear button `ActiveWorkspaces/index.jsx:186` (2), and another `<button>` with no recorded attributes, `SearchBox/index.jsx:196` (2). (The committed first-run transcript shows the older answer, with SearchBox and CTAButton merged into one 11-action candidate.) A correct fallback answer therefore says it could not read the element's Tracer key, lists the candidates, and may follow a candidate's `recent_action_ids` with `action_chain` as leads, labelled as such. If it does, the 422 attempt shows up the same way as in the exact answer, but the agent must not claim the annotated button is that candidate. It must not present the top candidate as the element.

### Ordinal keys (added with fix/stable-element-keys)

A key read from the DOM can itself be ambiguous. Keys ending `#n<i>` are ordinal (`key_kind: "ordinal"`): when the element's JSX site renders more than once, `resolve_element` answers `confidence: "ambiguous"` with `reason: "ordinal key; N instances of this placement"`, `instances: N`, the instances as `candidates`, and `advice`. Every `dom.action` on such an element records `target.key_kind` and `target.instances` (and `target.stamp_sequence`, the stamp row that held when it fired), so `element_history` shows each action's binding. A correct answer then follows `advice`: annotate a distinguishing child, or pick the action in `element_history` by its time. It must not present the top candidate as the element. Keys ending `@<react key>` (`key_kind: "react_key"`) name one element. The G5 key `p_f067e70e6029:117-485#n1` has one instance and stays `exact`.

## 6. Record, stop, restore

1. Save the Codex conversation (screenshots or export) and, if you can, the tool-call log into the `--out` directory from step 2 (`docs/evidence/g5-codex-iab-<date>/`), with a short `RUN.md`: Codex app version, what was installed where, the answer, and whether each bullet above held.
2. Stop hold mode with Ctrl-C. It closes the collector (the store's run row is written then) and checks that the fixture's tracked tree is still clean.
3. Bank the store and remove it from the fixture:
   ```sh
   OUT=docs/evidence/g5-codex-iab-$(date +%Y-%m-%d)
   mkdir -p $OUT/store/manifests
   for f in records spans runs; do gzip -9c /Users/austinho/dev/fixtures/anything-llm/.tracer/$f.jsonl > $OUT/store/$f.jsonl.gz; done
   for f in /Users/austinho/dev/fixtures/anything-llm/.tracer/manifests/*.json; do gzip -9c $f > $OUT/store/manifests/$(basename $f).gz; done
   rm -rf /Users/austinho/dev/fixtures/anything-llm/.tracer
   ```
4. Restore the fixture and remove the work directory:
   ```sh
   cd /Users/austinho/dev/fixtures/anything-llm
   git checkout master && git branch -D g5-scenario
   git status --porcelain            # must print nothing
   git rev-parse HEAD                # ad97bc8dfcb6919f34f7d6d0c722efdda64d66d9
   rm -rf /Users/austinho/dev/fixtures/.g2-work/g5-iab
   ```
5. Remove the `[mcp_servers.tracer]` block (or the plugin) from Codex if you do not want it to persist.

## Troubleshooting

- `Fixture is not clean before the run`: step 1 left something; `git status` in the fixture.
- Port in use: another hold or harness run is alive (`lsof -i :4100 -i :4101 -i :4102`).
- `tracer` tools answer `not_found … store_unavailable`: no action has been recorded yet, or the store path in `config.toml` is wrong. After step 4 it should answer.
- `tracer` tools are not in the thread's tool list: expected in the desktop app as of 2026-09-23. With the skill (or AGENTS snippet) in place Codex starts the configured server itself and speaks MCP over stdio; the answer is grounded the same way. If it does not, ask it to "start the tracer MCP server from `~/.codex/config.toml` over stdio and call resolve_element".
- The key lookup returns `ambiguous` or `text_mismatch`: the annotation picked a different element than the button (for example the page header). Annotate the button's text itself.
- Answers mention actions you did not take now: the store still holds an earlier run. Stop hold mode, delete `.tracer`, start again from step 2.
