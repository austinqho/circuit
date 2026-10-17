import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBench } from '../src/bench.mjs';
import { describe } from '../src/browser.mjs';
import {
  detectInstall,
  onPath,
  exampleEnv,
  findApps,
  nextWrapperConfig,
  parseRepo,
  rewriteLockfileRegistry,
  wrapperConfig,
} from '../src/target.mjs';
import {
  NARRATION_RUBRIC,
  buildReport,
  narrationOf,
  narrationScore,
  voiceFlags,
} from '../src/tracer.mjs';
import { segmentsOf, ungroundedTokens } from '../src/segments.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-web-'));
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

test('parseRepo accepts owner/repo, URLs and tree URLs', () => {
  assert.deepEqual(parseRepo('alan2207/bulletproof-react'), {
    url: 'https://github.com/alan2207/bulletproof-react',
    name: 'bulletproof-react',
  });
  assert.equal(parseRepo('https://github.com/a/b.git').url, 'https://github.com/a/b');
  assert.deepEqual(parseRepo('https://github.com/a/b/tree/dev/apps/web'), {
    url: 'https://github.com/a/b',
    name: 'b',
    ref: 'dev',
    appDir: 'apps/web',
  });
});

test('findApps prefers the React app in a monorepo', () => {
  const root = tmp();
  write(root, 'apps/admin/vite.config.ts', '');
  write(root, 'apps/admin/package.json', JSON.stringify({ dependencies: { vue: '3' } }));
  write(root, 'apps/react-vite/vite.config.ts', '');
  write(
    root,
    'apps/react-vite/package.json',
    JSON.stringify({
      dependencies: { react: '18' },
      devDependencies: { '@vitejs/plugin-react': '4' },
    }),
  );
  write(root, 'node_modules/x/vite.config.js', '');
  const found = findApps(root);
  assert.equal(found[0].dir, 'apps/react-vite');
  assert.equal(found.length, 2);
});

test('findApps finds a Next.js app and says which framework it is', () => {
  const root = tmp();
  write(root, 'apps/web/next.config.ts', '');
  write(
    root,
    'apps/web/package.json',
    JSON.stringify({ dependencies: { next: '16', react: '19' } }),
  );
  write(root, 'packages/ui/vite.config.ts', '');
  write(root, 'packages/ui/package.json', JSON.stringify({ devDependencies: { vite: '7' } }));
  const [first, second] = findApps(root);
  assert.deepEqual(
    { dir: first.dir, config: first.config, framework: first.framework },
    { dir: 'apps/web', config: 'next.config.ts', framework: 'next' },
  );
  assert.equal(second.framework, 'vite');
});

test('findApps keeps the Vite React app first when a repo also has a Next.js one', () => {
  const root = tmp();
  for (const [dir, deps, config] of [
    ['apps/nextjs-app', { next: '15', react: '19' }, 'next.config.mjs'],
    ['apps/react-vite', { react: '19', '@vitejs/plugin-react': '4' }, 'vite.config.ts'],
    ['apps/nextjs-pages', { next: '15', react: '19' }, 'next.config.mjs'],
  ]) {
    write(root, `${dir}/${config}`, '');
    write(root, `${dir}/package.json`, JSON.stringify({ dependencies: deps }));
  }
  assert.equal(findApps(root)[0].dir, 'apps/react-vite');
});

test('nextWrapperConfig wraps the moved config with withProducttrace in its own module format', () => {
  const options = { collector: { url: 'http://127.0.0.1:4601', force: true } };
  const esm = nextWrapperConfig({
    originalConfig: '/r/apps/web/next.config.circuit-original.ts',
    nextModule: '/p/next.mjs',
    options,
  });
  assert.match(esm, /import original from "\.\/next\.config\.circuit-original";/u);
  assert.match(esm, /import \{ withProducttrace \} from "\/p\/next\.mjs";/u);
  assert.match(esm, /export default withProducttrace\(original, \{"collector":/u);
  const cjs = nextWrapperConfig({
    originalConfig: '/r/next.config.circuit-original.js',
    nextModule: '/p/next.mjs',
    options,
    commonjs: true,
  });
  assert.match(cjs, /require\("\.\/next\.config\.circuit-original\.js"\)/u);
  assert.match(cjs, /module\.exports = withProducttrace\(original\.default \?\? original,/u);
});

test('detectInstall finds the governing lockfile and yarn flavour', () => {
  const root = tmp();
  write(root, 'yarn.lock', '# yarn lockfile v1\n');
  write(root, 'apps/web/package.json', '{}');
  const install = detectInstall(root, 'apps/web');
  assert.equal(install.command, 'yarn');
  assert.equal(install.dir, root);
  write(root, 'apps/web/pnpm-lock.yaml', '');
  assert.equal(detectInstall(root, 'apps/web').command, 'pnpm');
});

test('rewriteLockfileRegistry points mirrors at registry.npmjs.org', () => {
  const root = tmp();
  write(
    root,
    'yarn.lock',
    'resolved "https://registry.npmmirror.com/a/-/a-1.tgz"\nresolved "https://registry.yarnpkg.com/b/-/b-1.tgz"\n',
  );
  assert.equal(rewriteLockfileRegistry(path.join(root, 'yarn.lock')), 2);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'yarn.lock'), 'utf8'), /npmmirror|yarnpkg/u);
});

test('exampleEnv reads VITE_ variables only', () => {
  const root = tmp();
  write(
    root,
    '.env.example',
    'VITE_APP_API_URL="https://api.example.com"\nSECRET=x\nexport VITE_FLAG=true\n',
  );
  assert.deepEqual(exampleEnv(root), {
    VITE_APP_API_URL: 'https://api.example.com',
    VITE_FLAG: 'true',
  });
  // Next.js server code reads any variable.
  assert.equal(exampleEnv(root, { all: true }).SECRET, 'x');
});

test('wrapperConfig imports the original config and adds one producttrace line', () => {
  const text = wrapperConfig({
    originalConfig: '/r/vite.config.ts',
    outDir: '/w/dist',
    pluginOptions: { requestBridge: false },
  });
  assert.match(text, /import original from "\/r\/vite.config.ts"/u);
  assert.match(text, /producttrace\(\{"requestBridge":false\}\)/u);
  assert.equal(text.match(/producttrace\(/gu).length, 1);
  // Apps like Excalidraw open a browser tab on start; the headless bench has none.
  assert.match(text, /server: \{ \.\.\.\(base\.server \|\| \{\}\), open: false \}/u);
});

test('describe renders steps as plain sentences', () => {
  assert.equal(describe('click', 'Get started'), 'Clicked "Get started"');
  assert.equal(describe('fill', { label: 'Email' }, 'a@b.c'), 'Typed "a@b.c" into label "Email"');
  assert.equal(describe('click', { role: 'button', name: 'Save' }), 'Clicked button "Save"');
  assert.equal(
    describe('drag', 'css=canvas', '10,10 90,60'),
    'Dragged across "css=canvas" (10,10 90,60)',
  );
});

test('buildReport pairs lines with steps by window and scores them', () => {
  const steps = [
    {
      index: 0,
      action: 'goto',
      description: 'Opened /',
      ok: true,
      started_at: 1000,
      url_after: '/',
    },
    {
      index: 1,
      action: 'click',
      description: 'Clicked "Save"',
      ok: true,
      started_at: 2000,
      url_after: '/',
    },
    {
      index: 2,
      action: 'click',
      description: 'Clicked "Gone"',
      ok: true,
      started_at: 3000,
      url_after: '/',
    },
  ];
  const story = {
    source: 'story',
    lines: [
      {
        id: 'a',
        at: 2100,
        text: 'Clicked Save → POST /x (200)',
        element: { label: 'Save' },
        handler: { name: 'onSave' },
        requests: [{ method: 'POST', path: '/x', status: 200 }],
        entities: [{ type: 'x', id: '1' }],
      },
      { id: 'b', at: 500, text: 'before any step', element: {}, requests: [] },
    ],
  };
  const report = buildReport({
    steps,
    browserRequests: [
      { at: 2200, method: 'POST', path: '/x', status: 200 },
      { at: 3100, method: 'GET', path: '/y', status: 200 },
    ],
    story,
  });
  assert.deepEqual(report.steps[1].package_said, ['Clicked Save → POST /x (200)']);
  assert.deepEqual(report.steps[2].package_said, []);
  assert.equal(report.unpaired_lines.length, 1);
  assert.equal(report.scorecard.steps_acted, 2);
  assert.equal(report.scorecard.steps_with_a_line_pct, 50);
  assert.equal(report.scorecard.request_recall_pct, 50);
  assert.deepEqual(report.missed_requests, ['GET /y']);
  assert.equal(report.scorecard.lines, 1); // the line before any step is another session's
  assert.equal(report.scorecard.lines_naming_the_element_pct, 100);
});

test('onPath finds node and not a made-up command', () => {
  assert.equal(onPath('node'), true);
  assert.equal(onPath('definitely-not-a-command-xyz'), false);
});

test('segments group by page and submit, and the feed overrides them', () => {
  const line = (id, page, kind, extra = {}) => ({ id, page, kind, text: id, ...extra });
  const lines = [
    line('a', '/', 'act', { navigations: [{ to: '/login' }] }),
    line('b', '/login', 'act', { navigations: [{ to: '/register' }] }),
    line('c', '/register', 'type'),
    line('d', '/register', 'submit', { element: { label: 'Register' } }),
  ];
  const bench = segmentsOf(null, lines);
  assert.deepEqual(
    bench.map((s) => [s.title, s.lines.length, s.source]),
    [
      ['Went to /register', 2, 'bench'],
      ['Submitted the Register form', 2, 'bench'],
    ],
  );
  const feed = segmentsOf({ segments: [{ title: 'Signed up', lines: ['c', 'd'] }] }, lines);
  assert.deepEqual(feed, [{ title: 'Signed up', page: '', lines: lines.slice(2), source: 'feed' }]);
});

test('narration score folds rubric scores and rejects bad input', () => {
  const segments = [{}, {}];
  const full = { voice: 2, high_level: 2, grounded: 2, specific: 2, joined: 2 };
  assert.equal(narrationScore(segments, [full, { ...full, high_level: 0, specific: 0 }]), 80);
  assert.throws(() => narrationScore(segments, [full]), /one score per segment/u);
  assert.throws(() => narrationScore(segments, [full, { ...full, joined: 3 }]), /0, 1 or 2/u);
});

test('a title citing what its evidence lacks scores zero', () => {
  const story = {
    segments: [{ title: 'Registered as ada@example.test', cites: ['a'] }],
    lines: [],
  };
  const { segments } = narrationOf(story, [
    { id: 'a', text: 'Submitted the form → POST /auth/register (200)' },
  ]);
  assert.deepEqual(segments[0].ungrounded, ['ada@example.test']);
  const full = { voice: 2, high_level: 2, grounded: 2, specific: 2, joined: 2 };
  assert.equal(narrationScore(segments, [full]), 0);
});

test('voice flags catch the observer voice and pass the annotation voice', () => {
  for (const sentence of NARRATION_RUBRIC.bar) assert.deepEqual(voiceFlags(sentence), [], sentence);
  assert.deepEqual(voiceFlags('Went to /app.'), []);
  assert.equal(voiceFlags('In Discussions, the user is starting a new discussion.').length, 1);
  assert.equal(voiceFlags('Ada Lovelace is signing up.').length, 1);
  assert.deepEqual(voiceFlags('Submit the form'), ['does not open with a past-tense verb']);
  assert.ok(voiceFlags('Edited text in the form').includes('uses a vague verb'));
});

test('after a restart a built app shows as starting, with no URL, until it answers', () => {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-bench-'));
  fs.writeFileSync(
    path.join(workRoot, 'apps.json'),
    JSON.stringify([
      {
        id: 'demo',
        url: 'https://github.com/example/demo',
        status: 'ready',
        mode: 'build',
        build: 1,
        ports: { app: 4999, collector: 4998 },
        work: path.join(workRoot, 'demo'),
        serve: { wrapper: path.join(workRoot, 'gone', 'vite.config.mjs') },
      },
    ]),
  );
  const [app] = createBench({ workRoot }).list();
  assert.equal(app.status, 'starting');
  assert.equal(app.url, null);
  assert.equal(app.mode, 'dev');
  const saved = JSON.parse(fs.readFileSync(path.join(workRoot, 'apps.json'), 'utf8'));
  assert.equal(saved[0].status, 'ready');
});

test('an off-voice title gets zero for voice whatever the judge sends', () => {
  const lines = [{ id: 'a', text: 'Submitted the form → POST /auth/register (200)' }];
  const old = narrationOf(
    { segments: [{ title: 'On the Register page, the user is signing up.', cites: ['a'] }] },
    lines,
  ).segments;
  const fresh = narrationOf({ segments: [{ title: 'Registered.', cites: ['a'] }] }, lines).segments;
  const full = { voice: 2, high_level: 2, grounded: 2, specific: 2, joined: 2 };
  assert.equal(narrationScore(old, [full]), 80);
  assert.equal(narrationScore(fresh, [full]), 100);
});

test('a shortened ID must start an ID the evidence has', () => {
  const evidence = ['user U5kYWbCNE3f8v-xNcc62Y'];
  assert.deepEqual(ungroundedTokens('Created user U5kY…', evidence), []);
  assert.deepEqual(ungroundedTokens('Created user Zq9x…', evidence), ['Zq9x…']);
  assert.deepEqual(ungroundedTokens('Created user Wb…', evidence), ['Wb…']);
});
