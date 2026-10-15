import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { producttrace } from '../integrations/vite.mjs';

// The inline attribution runtime contains `$'` sequences. When index.html has no
// <head>, Vite injects head-prepend tags with a string-form replace, which reads
// `$'` as a pattern and splices the rest of the page into the script.
async function buildWith(html) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-index-html-')));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","private":true,"type":"module"}');
  fs.writeFileSync(path.join(root, 'index.html'), html);
  fs.writeFileSync(path.join(root, 'main.js'), 'document.body.dataset.ready = "1";\n');
  try {
    await build({
      root, configFile: false, logLevel: 'silent', mode: 'development',
      plugins: [...producttrace({ repository: root, service: 'web', requestBridge: false })],
      build: { outDir: path.join(root, 'dist'), minify: false },
    });
    return fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(body => body.trim());
}

for (const [name, html] of [
  ['with <head>', '<!doctype html><html><head><title>t</title></head><body><script type="module" src="/main.js"></script></body></html>'],
  ['without <head>', '<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>'],
  ['without <html> or <head>', '<!doctype html><body><script type="module" src="/main.js"></script></body>'],
]) {
  test(`built index.html ${name} keeps the inline runtime intact and first`, async () => {
    const out = await buildWith(html);
    const scripts = inlineScripts(out);
    assert.equal(scripts.length, 1, out.slice(0, 400));
    assert.match(scripts[0], /installProductTraceRuntimeAttribution/u);
    assert.doesNotThrow(() => new Function(scripts[0]));
    assert.equal((out.match(/src="\/main\.js"|src="\/assets\/[^"]+\.js"/g) || []).length, 1, 'the app entry appears once');
    assert.ok(out.indexOf('installProductTraceRuntimeAttribution') < out.search(/<script[^>]*type="module"/u), 'runtime runs before the app');
  });
}
