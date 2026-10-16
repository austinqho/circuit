#!/usr/bin/env node
// circuit-mcp: the bench as MCP tools for Claude (stdio). It talks to the
// circuit-web server (CIRCUIT_URL, default http://127.0.0.1:4500) and starts it
// in the background when nothing is listening, so Claude and the website share
// one bench: what Claude clicks shows up live on the page Austin has open.
//
//   claude mcp add circuit -- node apps/web/src/mcp.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.CIRCUIT_URL || 'http://127.0.0.1:4500').replace(/\/$/u, '');
const here = path.dirname(fileURLToPath(import.meta.url));

async function ensureServer() {
  try {
    await fetch(`${BASE}/api/apps`);
    return;
  } catch {}
  const child = spawn(
    process.execPath,
    [path.join(here, 'server.mjs'), new URL(BASE).port || '4500'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      await fetch(`${BASE}/api/apps`);
      return;
    } catch {}
  }
  throw new Error(`circuit-web did not start at ${BASE}`);
}

async function api(method, route, body) {
  await ensureServer();
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (route.endsWith('/screenshot') && response.ok)
    return { png: Buffer.from(await response.arrayBuffer()).toString('base64') };
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = { text };
  }
  if (!response.ok) throw new Error(value.error || text);
  return value;
}

const TARGET = {
  description:
    'What to act on. A string is visible text or a button/link name ("Get started"), or a raw Playwright selector ("css=#email", "role=button[name=/save/i]"). An object picks by role+name, label, placeholder, text, testid or selector, with optional nth and exact.',
  anyOf: [
    { type: 'string' },
    {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        text: { type: 'string' },
        testid: { type: 'string' },
        selector: { type: 'string' },
        nth: { type: 'integer' },
        exact: { type: 'boolean' },
      },
    },
  ],
};
const MODE = {
  type: 'string',
  enum: ['dev', 'build'],
  description:
    'dev (default): the dev server (Vite or next dev), ready in seconds. build: a production build served as static files, the app as users get it (Vite apps only).',
};
const APP = { type: 'string', description: 'App id from circuit_add_app or circuit_list_apps.' };

const TOOLS = [
  {
    name: 'circuit_list_apps',
    description: 'Every app on the bench with its status, URL and build number.',
    inputSchema: { type: 'object', properties: {} },
    run: () => api('GET', '/api/apps'),
  },
  {
    name: 'circuit_add_app',
    description:
      'Install producttrace into an open-source React repo (Vite or Next.js): clone it, install its dependencies, attach the one install line in a wrapper config (its source is never edited), run it and start a collector. By default the app runs on its dev server (ready once installed); mode "build" makes a production build instead, which takes minutes. Returns at once; follow with circuit_app_status wait_seconds and call it again while the status is building.',
    inputSchema: {
      type: 'object',
      required: ['repo'],
      properties: {
        repo: {
          type: 'string',
          description:
            'owner/repo, a GitHub URL (a /tree/<ref>/<dir> URL picks branch and app folder), or a local path.',
        },
        ref: { type: 'string', description: 'Branch or tag (default branch if omitted).' },
        app_dir: {
          type: 'string',
          description:
            'Folder with the Vite or Next.js config in a monorepo (auto-detected; the best React candidate is picked).',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description:
            'Extra build environment, e.g. VITE_* variables. Example env files in the app are read automatically.',
        },
        plugin_options: {
          type: 'object',
          description: 'Extra options for producttrace() in the wrapper config.',
        },
        mode: MODE,
      },
    },
    run: (args) => api('POST', '/api/apps', args),
  },
  {
    name: 'circuit_app_status',
    description:
      'Status of one app (queued, building, ready, failed) with the build log tail when not ready. wait_seconds blocks while it builds (max 50); call again while the status is building.',
    inputSchema: {
      type: 'object',
      required: ['app'],
      properties: { app: APP, wait_seconds: { type: 'integer', minimum: 0, maximum: 50 } },
    },
    run: ({ app, wait_seconds: wait = 0 }) => api('GET', `/api/apps/${app}?wait=${wait}`),
  },
  {
    name: 'circuit_rebuild',
    description:
      'Restart an app with the package as it is now on disk (after you change the package). Skips clone and install; in dev mode it takes seconds, in build mode it rebuilds. mode switches between the two. A new build gets a fresh store, so its report starts clean.',
    inputSchema: { type: 'object', required: ['app'], properties: { app: APP, mode: MODE } },
    run: ({ app, mode }) => api('POST', `/api/apps/${app}/rebuild`, mode ? { mode } : {}),
  },
  {
    name: 'circuit_act',
    description:
      'Do one thing in the app with a headless browser, like a user would: goto (value = path), click, dblclick, hover, fill (value = text), type (key by key; no target types into whatever has focus), press (value = key, e.g. Enter), select, check, uncheck, drag (value = "x1,y1 x2,y2" in pixels from the target\'s top-left, for drawing on canvases), wait (value = ms), back. Returns whether it worked, the sentences the package wrote since the step began, and the page\'s accessibility tree so you can pick the next target.',
    inputSchema: {
      type: 'object',
      required: ['app', 'action'],
      properties: {
        app: APP,
        action: {
          type: 'string',
          enum: [
            'goto',
            'click',
            'dblclick',
            'hover',
            'fill',
            'type',
            'press',
            'select',
            'check',
            'uncheck',
            'drag',
            'wait',
            'back',
          ],
        },
        target: TARGET,
        value: { type: 'string' },
      },
    },
    run: ({ app, ...step }) => api('POST', `/api/apps/${app}/act`, step),
  },
  {
    name: 'circuit_snapshot',
    description:
      'The current page: URL, title and accessibility tree (roles and names you can target).',
    inputSchema: { type: 'object', required: ['app'], properties: { app: APP } },
    run: ({ app }) => api('GET', `/api/apps/${app}/snapshot`),
  },
  {
    name: 'circuit_screenshot',
    description: 'A PNG of the current page.',
    inputSchema: { type: 'object', required: ['app'], properties: { app: APP } },
    run: ({ app }) => api('GET', `/api/apps/${app}/screenshot`),
  },
  {
    name: 'circuit_report',
    description:
      'The judge view: every step you took next to the sentences the package wrote for it and the requests the browser really sent vs the ones the package recorded, plus a scorecard (steps with a line, lines naming the element, naming a handler, carrying entity ids, request recall, and reads_like_a_person once you have scored the narration with circuit_score_narration), `narration` (segment titles with their evidence and the rubric), and `history`: the scorecard of every build that ran exactly these steps, oldest first. Use it to decide what to improve in the package, then circuit_rebuild and run the same steps again.',
    inputSchema: { type: 'object', required: ['app'], properties: { app: APP } },
    run: ({ app }) => api('GET', `/api/apps/${app}/report`),
  },
  {
    name: 'circuit_score_narration',
    description:
      "Judge whether the narration reads like a person annotating the user's actions. Take report.narration (each segment's title and its evidence lines) and score every title 0-2 on each rubric criterion (voice, high_level, grounded, specific, joined), using only the evidence. The scores become reads_like_a_person_pct in this build's scorecard and history, so narration can be hillclimbed like the other numbers.",
    inputSchema: {
      type: 'object',
      required: ['app', 'scores'],
      properties: {
        app: APP,
        scores: {
          type: 'array',
          description: 'One per segment, in report.narration order.',
          items: {
            type: 'object',
            required: ['voice', 'high_level', 'grounded', 'specific', 'joined'],
            properties: {
              voice: { type: 'integer', minimum: 0, maximum: 2 },
              high_level: { type: 'integer', minimum: 0, maximum: 2 },
              grounded: { type: 'integer', minimum: 0, maximum: 2 },
              specific: { type: 'integer', minimum: 0, maximum: 2 },
              joined: { type: 'integer', minimum: 0, maximum: 2 },
              note: { type: 'string', description: 'Why, and a better title if you have one.' },
            },
          },
        },
      },
    },
    run: ({ app, scores }) => api('POST', `/api/apps/${app}/narration`, { scores }),
  },
  {
    name: 'circuit_story',
    description:
      "The package's own session story for this build: every session and line, oldest first, as the package produced it.",
    inputSchema: {
      type: 'object',
      required: ['app'],
      properties: { app: APP, session: { type: 'string' } },
    },
    run: ({ app, session }) =>
      api(
        'GET',
        `/api/apps/${app}/story${session ? `?session=${encodeURIComponent(session)}` : ''}`,
      ),
  },
  {
    name: 'circuit_reset',
    description:
      'Close the browser page (ends that page session) and clear the steps, to start a clean run.',
    inputSchema: { type: 'object', required: ['app'], properties: { app: APP } },
    run: ({ app }) => api('POST', `/api/apps/${app}/reset`),
  },
  {
    name: 'circuit_tracer',
    description:
      "Call one of the package's own MCP tools (recent_actions, action_chain, element_history, resolve_element, compare_chains, page_requests, ...) against this app's store, for the raw evidence behind a sentence. Omit name to list them.",
    inputSchema: {
      type: 'object',
      required: ['app'],
      properties: { app: APP, name: { type: 'string' }, args: { type: 'object' } },
    },
    run: ({ app, name, args }) =>
      name
        ? api('POST', `/api/apps/${app}/tools/${name}`, { args: args || {} })
        : api('GET', `/api/apps/${app}/tools`),
  },
];

const server = new Server({ name: 'circuit', version: '0.1.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ run, ...tool }) => tool),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool)
    return {
      isError: true,
      content: [{ type: 'text', text: `unknown tool ${request.params.name}` }],
    };
  try {
    const value = await tool.run(request.params.arguments || {});
    if (value?.png) return { content: [{ type: 'image', data: value.png, mimeType: 'image/png' }] };
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});
await server.connect(new StdioServerTransport());
