import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readLibraryImplementation } from '../authoring/library-implementation.mjs';

function fixture(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-library-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/example': { version: '1.0.0', integrity: 'sha512-test-fixture-only' } } }));
  fs.writeFileSync(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(root, 'node_modules/example/index.js'), source);
  return root;
}

test('exact entrypoint, installed version, package integrity and loaded source hashes are retained', t => {
  const root = fixture(t, 'exports.update = function update(cb, value) { return cb(value); };');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal');
  assert.equal(implementation.context.packages[0].version, '1.0.0');
  assert.equal(implementation.context.files.length, 1);
  assert.equal(implementation.unchanged(), true);
  fs.appendFileSync(path.join(root, 'package-lock.json'), '\n');
  assert.equal(implementation.unchanged(), false);
});

test('a modified cached implementation and an unattested preloaded module must reject', t => {
  const root = fixture(t, 'exports.update = function update(value) { return value; };');
  readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  fs.appendFileSync(path.join(root, 'node_modules/example/index.js'), '\nexports.changed = true;');
  assert.throws(() => readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' }), /runtime_cache_not_attested_or_changed/);
  const other = fixture(t, 'exports.update = function update(value) { return value; };');
  createRequire(path.join(other, 'package.json'))('example');
  assert.throws(() => readLibraryImplementation({ repository: other, specifier: 'example', exportName: 'update' }), /runtime_cache_not_attested_or_changed/);
});

test('version drift and newly loaded lazy dependencies invalidate the source attestation', t => {
  const root = fixture(t, "exports.update = function update() { return require('./later'); };");
  fs.writeFileSync(path.join(root, 'node_modules/example/later.js'), 'module.exports = 3;');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'frontier');
  assert.match(implementation.context.source_reason, /dependency_not_loaded/);
  assert.equal(implementation.producer(), 3);
  assert.equal(implementation.unchanged(), false);
  fs.writeFileSync(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: '2.0.0', main: 'index.js' }));
  assert.throws(() => readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' }), /installed_version_or_integrity_unverified/);
});

test('slicing a large entry includes its small referenced implementation, not just the require statement', t => {
  const root = fixture(t, `const helper = require('./helper');\nexports.update = function update(cb, value) { return helper(cb, value); };\n/*${'irrelevant'.repeat(3000)}*/`);
  fs.writeFileSync(path.join(root, 'node_modules/example/helper.js'), 'module.exports = function helper(cb, value) { return cb(value); };');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal', implementation.context.source_reason);
  assert(implementation.context.slices.some(row => row.file.endsWith('helper.js') && row.source.includes('return cb(value)')));
  assert(!implementation.context.slices.some(row => row.source.includes('irrelevant')));
});

test('a large callable dependency is sliced to its real export and referenced bindings', t => {
  const root = fixture(t, "const helper = require('./helper'); exports.update = function update(cb, value) { return helper(cb, value); };");
  fs.writeFileSync(path.join(root, 'node_modules/example/helper.js'), `const prefix = 'selected'; module.exports = function helper(cb,value) { return cb(prefix, value); };\n/*${'large'.repeat(5000)}*/`);
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal', implementation.context.source_reason);
  const selected = implementation.context.slices.map(row => row.source).join('\n');
  assert.match(selected, /return cb\(prefix, value\)/);
  assert.match(selected, /prefix = 'selected'/);
  assert(!selected.includes('largelarge'));
});

test('an unresolved large export object remains a frontier and its getter is never read by slicing', t => {
  const root = fixture(t, "const helper = require('./helper'); exports.update = function update(cb, value) { return helper.invoke(cb, value); };");
  fs.writeFileSync(path.join(root, 'node_modules/example/helper.js'), `module.exports = { get invoke() { throw new Error('must not inspect getter'); } };\n/*${'large'.repeat(5000)}*/`);
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'frontier');
  assert.match(implementation.context.source_reason, /dependency_requires_export_slice/);
});

test('a native dependency requires its own contract rather than claiming readable native source', t => {
  const root = fixture(t, "const util = require('node:util'); exports.update = function update(v) { return util.inspect(v); };");
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(implementation.context.source_status, 'frontier');
  assert.match(implementation.context.source_reason, /native_dependency_requires_contract/);
});

test('changing the runtime environment invalidates an existing implementation attestation', t => {
  const original = process.env.NODE_ENV;
  t.after(() => { if (original === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original; });
  const root = fixture(t, 'exports.update = function update() { return process.env.NODE_ENV; };');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  process.env.NODE_ENV = original === 'production' ? 'development' : 'production';
  assert.equal(implementation.unchanged(), false);
});

test('native exports and ambiguous source copies cannot masquerade as an exact readable implementation', t => {
  const native = fixture(t, 'exports.update = Math.max;');
  const first = readLibraryImplementation({ repository: native, specifier: 'example', exportName: 'update' });
  assert.equal(first.context.source_status, 'frontier');
  assert.match(first.context.source_reason, /native_or_bound/);
  const code = 'function duplicate(value) { return value; }';
  const root = fixture(t, `exports.update = ${code}; exports.other = ${code}; require('./copy');\n/*${'padding'.repeat(4000)}*/`);
  fs.writeFileSync(path.join(root, 'node_modules/example/copy.js'), `module.exports = ${code};`);
  const second = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(second.context.source_status, 'frontier');
  assert.equal(second.context.source_reason, 'runtime_function_source_not_unique');
});

test('a known native identity supplies a host hint but never claims readable native source', t => {
  const read = source => readLibraryImplementation({repository:fixture(t,source),specifier:'example',exportName:'update'});
  const implementation=read('exports.update = Array.isArray;');
  assert.equal(implementation.context.source_status,'ready_for_catalog_recheck');
  assert.equal(implementation.context.host_binding.target,'Array.isArray');
  assert.equal(implementation.context.host_binding.node_version,process.versions.node);
  assert.match(implementation.context.source_reason,/native_host_intrinsic/);
  assert.equal(implementation.unchanged(),true);
  for(const source of ['exports.update=Array.isArray.bind(null);','exports.update=Array.isArray.bind(null, []);','exports.update=Math.max;']) {
    const other=read(source);assert.equal(other.context.source_status,'frontier');assert.equal(other.context.host_binding,undefined);
  }
  const lookalike=read('exports.update=function isArray(value){return false};');
  assert.equal(lookalike.context.source_status,'ready_for_scoped_proposal');assert.equal(lookalike.context.host_binding,undefined);
  const original=Array.isArray;let unchanged;
  try {Array.isArray=()=>false;unchanged=implementation.unchanged();}finally{Array.isArray=original;}
  assert.equal(unchanged,false);
});

test('native binding evidence records the actual scheduler target and always restores bind', async t => {
  const originalBind = Function.prototype.bind;
  const root = fixture(t, 'exports.update = queueMicrotask.bind(globalThis);');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'update' });
  assert.equal(Function.prototype.bind, originalBind);
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal');
  assert.equal(implementation.context.host_binding.capability, 'microtask');
  assert.equal(implementation.context.host_binding.node_version, process.versions.node);
  assert.equal(implementation.context.host_binding.target_source, Function.prototype.toString.call(queueMicrotask));
  let calls = 0; implementation.producer(() => calls++);
  assert.equal(calls, 0); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  const other = fixture(t, 'exports.update = Math.max.bind(null);');
  assert.equal(readLibraryImplementation({ repository: other, specifier: 'example', exportName: 'update' }).context.source_status, 'frontier');
  const failed = fixture(t, "throw new Error('failed import');");
  assert.throws(() => readLibraryImplementation({ repository: failed, specifier: 'example', exportName: 'update' }), /failed import/);
  assert.equal(Function.prototype.bind, originalBind);
});

test('an exact environment-only entry pins its active import and rejects cache mode drift', t => {
  const before = process.env.NODE_ENV;
  t.after(() => { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; });
  process.env.NODE_ENV = 'production';
  const root = fixture(t, "'use strict'; if (process.env.NODE_ENV === 'production') { module.exports = require('./prod'); } else { module.exports = require('./dev'); }");
  fs.writeFileSync(path.join(root, 'node_modules/example/prod.js'), 'module.exports = function production(value) { return value; };');
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'default' });
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal');
  assert.equal(implementation.context.runtime.mode, 'production');
  assert.equal(implementation.context.files.length, 2);
  assert.equal(implementation.producer('input'), 'input');
  process.env.NODE_ENV = 'development';
  assert.equal(implementation.unchanged(), false);
  assert.throws(() => readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'default' }), /runtime_cache_environment_changed/);
});

test('unknown, shadowed, effectful and deferred environment conditions retain dependency frontiers', t => {
  const sources = [
    "const process = {env:{NODE_ENV:'production'}}; if (process.env.NODE_ENV === 'production') { module.exports = require('./prod'); } else { module.exports = require('./missing'); }",
    "if (globalThis.unknownFlag) { module.exports = require('./missing'); } else { module.exports = require('./prod'); }",
    "module.exports = function () { if (process.env.NODE_ENV === 'production') { return require('./missing'); } return 1; };",
    "if (process.env.NODE_ENV === 'production') { module.exports = require('./missing'); } else { Object.freeze({}); module.exports = require('./prod'); }",
  ];
  const before = process.env.NODE_ENV;
  t.after(() => { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; });
  process.env.NODE_ENV = 'development';
  for (const source of sources) {
    const root = fixture(t, source);
    fs.writeFileSync(path.join(root, 'node_modules/example/prod.js'), 'module.exports = function value(x) { return x; };');
    const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'default' });
    assert.equal(implementation.context.source_status, 'frontier');
    assert.match(implementation.context.source_reason, /dependency_(?:not_loaded|unresolved)/);
  }
});

test('nested exported functions use own data paths without invoking export getters', t => {
  const root = fixture(t, "exports.Children = { only: function only(value) { return value; } }; Object.defineProperty(exports.Children, 'hidden', {get() { throw new Error('getter ran'); }});");
  const implementation = readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'Children.only' });
  assert.equal(implementation.producer('value'), 'value');
  assert.equal(implementation.context.export_name, 'Children.only');
  assert.equal(implementation.context.source_status, 'ready_for_scoped_proposal');
  assert.throws(() => readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'Children.hidden' }), /export_requires_own_data_property/);
  assert.throws(() => readLibraryImplementation({ repository: root, specifier: 'example', exportName: 'Children.constructor' }), /export_path_unsupported/);
});

test('a failed export lookup does not poison the source reader own attested module load', t => {
  const root=fixture(t,"exports.version='1.0.0';exports.run=function run(value){return value;};");
  assert.throws(()=>readLibraryImplementation({repository:root,specifier:'example',exportName:'version'}),/export_not_callable/);
  assert.throws(()=>readLibraryImplementation({repository:root,specifier:'example',exportName:'missing'}),/export_requires_own_data_property/);
  const actual=readLibraryImplementation({repository:root,specifier:'example',exportName:'run'});
  assert.equal(actual.context.source_status,'ready_for_scoped_proposal');assert.equal(actual.producer(3),3);
});

test('standard Reflect and numeric globals are source primitives, and statement labels are not bindings', t => {
  const root=fixture(t,"exports.run=function run(cb,value){ outer: for(let i=0;i<1;i++){ if(value===Infinity)break outer; return Reflect.apply(cb,undefined,[value]); } return NaN; };"+'\n/*'+'padding'.repeat(3500)+'*/');
  const actual=readLibraryImplementation({repository:root,specifier:'example',exportName:'run'});
  assert.equal(actual.context.source_status,'ready_for_scoped_proposal',actual.context.source_reason);
  assert.equal(actual.producer(value=>value,3),3);assert(Number.isNaN(actual.producer(()=>1,Infinity)));
});

test('sliced callers keep only the active dependency of an exact environment selector', t => {
  const before=process.env.NODE_ENV;t.after(()=>{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;});
  process.env.NODE_ENV='production';
  const root=fixture(t,"const selected=require('./selector');exports.run=function run(value){return selected(value);};"+'\n/*'+'padding'.repeat(3500)+'*/');
  fs.writeFileSync(path.join(root,'node_modules/example/selector.js'),"if(process.env.NODE_ENV === 'production'){module.exports=require('./prod');}else{module.exports=require('./missing');}");
  fs.writeFileSync(path.join(root,'node_modules/example/prod.js'),'module.exports=function selected(value){return value;};');
  const actual=readLibraryImplementation({repository:root,specifier:'example',exportName:'run'});
  assert.equal(actual.context.source_status,'ready_for_scoped_proposal',actual.context.source_reason);
  assert.equal(actual.producer(7),7);
});

test('source-pinned forwarding getters resolve lexical bindings without executing getters',t=>{
  const root=fixture(t,`let calls=0; function update(cb,value){return cb(value)};
    const inner={update}; const key='update'; const copy={};
    Object.defineProperty(copy,key,{get:()=>inner[key],enumerable:true});
    Object.defineProperty(exports,'update',{get:()=>copy.update,enumerable:true});
    Object.defineProperty(exports,'danger',{get(){calls++;return update}});
    exports.calls=()=>calls;`);
  const result=readLibraryImplementation({repository:root,specifier:'example',exportName:'update'});
  assert.equal(result.context.source_status,'ready_for_scoped_proposal',result.context.source_reason);
  assert.equal(result.context.export_resolution.kind,'v8_pure_forwarding_getter');
  assert.equal(result.context.export_resolution.getters.length,2);
  assert.equal(result.producer((x)=>x,9),9);assert.equal(result.unchanged(),true);
  assert.throws(()=>readLibraryImplementation({repository:root,specifier:'example',exportName:'danger'}),/export_getter_shape_unsupported/);
  assert.equal(createRequire(path.join(root,'package.json'))('example').calls(),0);
});

test('live lexical export changes invalidate an earlier getter resolution',t=>{
  const root=fixture(t,`function first(x){return x};function second(x){return !x};let chosen=first;
    Object.defineProperty(exports,'update',{get:()=>chosen});exports.change=()=>{chosen=second};`);
  const result=readLibraryImplementation({repository:root,specifier:'example',exportName:'update'});
  assert.equal(result.unchanged(),true);createRequire(path.join(root,'package.json'))('example').change();
  assert.equal(result.unchanged(),false);
});

test('forwarding getter inspection rejects proxies, arbitrary expressions, globals and cycles',t=>{
  const root=fixture(t,`let calls=0;const fn=x=>x;const proxy=new Proxy({fn},{getOwnPropertyDescriptor(){calls++;throw Error('trap')}});
    const cycle={get a(){return cycle.b},get b(){return cycle.a}};
    Object.defineProperty(exports,'proxy',{get:()=>proxy.fn});Object.defineProperty(exports,'call',{get:()=>fn()});
    Object.defineProperty(exports,'global',{get:()=>Buffer});Object.defineProperty(exports,'cycle',{get:()=>cycle.a});
    exports.calls=()=>calls;`);
  for(const exportName of ['proxy','call','global','cycle'])assert.throws(()=>readLibraryImplementation({repository:root,specifier:'example',exportName}),/export_requires_own_data_property/);
  assert.equal(createRequire(path.join(root,'package.json'))('example').calls(),0);
});
