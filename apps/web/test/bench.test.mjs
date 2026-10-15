import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { describe } from '../src/browser.mjs';
import {
  detectInstall,
  exampleEnv,
  findViteApps,
  parseRepo,
  rewriteLockfileRegistry,
  wrapperConfig,
} from '../src/target.mjs';
import { buildReport } from '../src/tracer.mjs';

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

test('findViteApps prefers the React app in a monorepo', () => {
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
  const found = findViteApps(root);
  assert.equal(found[0].dir, 'apps/react-vite');
  assert.equal(found.length, 2);
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
});

test('describe renders steps as plain sentences', () => {
  assert.equal(describe('click', 'Get started'), 'Clicked "Get started"');
  assert.equal(describe('fill', { label: 'Email' }, 'a@b.c'), 'Typed "a@b.c" into label "Email"');
  assert.equal(describe('click', { role: 'button', name: 'Save' }), 'Clicked button "Save"');
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
  assert.equal(report.scorecard.lines, 1); // the line before any step is another session's
  assert.equal(report.scorecard.lines_naming_the_element_pct, 100);
});
