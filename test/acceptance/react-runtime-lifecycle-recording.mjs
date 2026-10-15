import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
  analyzeReact,
  createReactLifecycleEvidenceSession,
  createReactRuntimeIntegration,
} from '../../analysis/index.mjs';

const installedRepository = path.resolve(process.argv[2] || '/tmp/producttrace-librechat-autonomous');
const installedRequire = createRequire(path.join(installedRepository, 'package.json'));
const { chromium } = installedRequire('playwright');
const React = installedRequire('react');
assert.equal(React.version, '18.3.1');
const reactBuild = process.env.PRODUCTTRACE_REACT_BUILD === 'production' ? 'production' : 'development';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'producttrace-react-runtime-lifecycle-'));
const source = `import * as React from 'react';
const ValueContext = React.createContext('default');
const left = () => window.dynamicCalls.push('left');
const right = () => window.dynamicCalls.push('right');
let updateFirst;
function Item({name, visible = true}) {
  const value = React.useContext(ValueContext);
  const [count, setCount] = React.useState(0);
  if (name === 'first') updateFirst = setCount;
  const original = function original(suffix) { return this.prefix + value + ':' + count + suffix; };
  const alias = original;
  const named = React.useCallback(alias, [value, count]);
  const inferred = () => value;
  const inferredRetained = React.useCallback(inferred, [value]);
  window.namedIdentity.push({same:named === original, name:original.name, inferred:inferred.name,
    length:original.length, value:named.call({prefix:'>'},'!')});
  const retained = React.useCallback(() => value + ':' + count, [value, count]);
  window.latestRetained[name] = retained;
  if (!window.firstRetained[name]) window.firstRetained[name] = retained;
  const calculated = React.useMemo(() => value + '/' + count, [value, count]);
  React.useEffect(() => {
    window.effectCalls.push('setup:' + name + ':' + retained());
    return () => window.effectCalls.push('cleanup:' + name + ':' + retained());
  }, [name, retained]);
  if (!visible) return null;
  return <ValueContext.Consumer>{current => <output data-name={name}>{current}:{calculated}</output>}</ValueContext.Consumer>;
}
function Dynamic({pickLeft}) {
  return <button id="dynamic" type="button" onClick={pickLeft ? left : right}>dynamic</button>;
}
function InitialState({seed,name}) {
  const [state]=React.useState(()=>{window.initializerCalls.push('state:'+name+':'+seed);return {value:seed};});
  const [reduced]=React.useReducer((current,action)=>current,seed,
    initial=>{window.initializerCalls.push('reducer:'+name+':'+initial);return {value:initial+1};});
  return <output data-initial={name}>{state.value}:{reduced.value}</output>;
}
window.mountInitial=(seed,revision)=>ReactDOM.flushSync(()=>initialRoot.render(<React.Fragment key={revision}>
  <InitialState seed={seed} name="first"/><InitialState seed={seed} name="second"/>
</React.Fragment>));
function StateReplay() {
  const [count,setCount]=React.useState(0);
  return <section><output id="replay-result">{count}</output><button id="state-replay" type="button" onClick={()=>{
    React.startTransition(()=>setCount(previous=>previous+10));
    setCount(previous=>previous+1);
  }}>replay queue</button></section>;
}
window.mountReplay=()=>ReactDOM.flushSync(()=>replayRoot.render(<StateReplay/>));
function ReducerUpdates({factor}) {
  function reduceTotal(previous,action) {
    window.reducerActions.push(action);
    return previous+(typeof action==='function'?action.amount:typeof action==='object'?action.amount:action)+factor;
  }
  const [total,dispatch]=React.useReducer(reduceTotal,0,initial=>initial);
  window.reducerDispatches.push(dispatch);
  return <section><output id="reducer-result">{total}</output>
    <button id="reducer-object" type="button" onClick={()=>{dispatch(window.sharedReducerAction);dispatch(window.sharedReducerAction);}}>object actions</button>
    <button id="reducer-primitive" type="button" onClick={()=>{dispatch(2);dispatch(2);}}>primitive actions</button>
    <button id="reducer-function" type="button" onClick={()=>dispatch(window.functionReducerAction)}>function action</button>
    <button id="reducer-replay" type="button" onClick={()=>{React.startTransition(()=>dispatch(window.slowReducerAction));dispatch(1);}}>replay reducer queue</button>
    <button id="reducer-stop" type="button" onClick={()=>{React.startTransition(()=>dispatch(window.sharedReducerAction));window.testRecorder.stop();}}>stop after queueing</button>
  </section>;
}
window.mountReducer=factor=>ReactDOM.flushSync(()=>reducerRoot.render(<ReducerUpdates factor={factor}/>));
function StateUpdates({delta}) {
  const [count,setCount]=React.useState(0);
  function addDelta(previous){window.dynamicStateCalls.push('add');return previous+delta;}
  const triple=function triple(previous){window.dynamicStateCalls.push('triple');return previous*3;};
  window.stateDispatches.push(setCount);
  return <section><output id="state-result">{count}</output>
    <button id="state-update" type="button" onClick={()=>{setCount(previous=>previous+delta);setCount(previous=>previous*2);}}>update state</button>
    <button id="state-replace" type="button" onClick={()=>setCount(7)}>replace state</button>
    <button id="state-dynamic" type="button" onClick={()=>setCount(delta>2?addDelta:triple)}>dynamic state</button>
  </section>;
}
window.mountState=delta=>ReactDOM.flushSync(()=>stateRoot.render(<StateUpdates delta={delta}/>));
function UnmountingState() {
  const [count,setCount]=React.useState(0);
  return <button id="state-unmount" type="button" onClick={()=>{unmountStateRoot.unmount();setCount(previous=>previous+1);}}>{count}</button>;
}
window.mountUnmountingState=()=>ReactDOM.flushSync(()=>unmountStateRoot.render(<UnmountingState/>));
function FailingState() {
  const [count,setCount]=React.useState(0);
  return <button id="state-failure" type="button" onClick={()=>setCount(previous=>{throw Error('state-calculation-sentinel');})}>{count}</button>;
}
window.mountFailingState=()=>ReactDOM.flushSync(()=>failureStateRoot.render(<FailingState/>));
function MemoDirect({value}) {
  const callback=React.useMemo(()=>()=>window.memoCalls.push('direct:'+value),[value]);
  return <button id="memo-direct" type="button" onClick={callback}>memo direct</button>;
}
function MemoObject({value}) {
  const cached=React.useMemo(()=>({send:()=>window.memoCalls.push('object:'+value)}),[value]);
  window.memoObject=cached;
  return <button id="memo-object" type="button" onClick={cached.send}>memo object</button>;
}
function MemoConditional({value,revision}) {
  const cached=React.useMemo(()=>{
    if(value)return {send:()=>window.conditionalCalls.push('positive:'+value)};
    return {send:()=>window.conditionalCalls.push('negative:'+value)};
  },[revision]);
  return <button id="memo-conditional" type="button" onClick={cached.send}>conditional memo</button>;
}
window.mountConditional=(value,revision)=>ReactDOM.flushSync(()=>conditionalRoot.render(<MemoConditional value={value} revision={revision}/>));
const sharedMemoCallback=()=>window.memoCalls.push('shared');
function MemoShared({value}) {
  const cached=React.useMemo(()=>sharedMemoCallback,[value]);
  return <button id="memo-shared" type="button" onClick={cached}>memo shared</button>;
}
window.mountShared=value=>ReactDOM.flushSync(()=>sharedRoot.render(<MemoShared value={value}/>));
window.mountMemoCallbacks=value=>ReactDOM.flushSync(()=>memoRoot.render(<><MemoDirect value={value}/><MemoObject value={value}/></>));
function Interrupt({slow}) {
  const escaped = React.useCallback(() => slow ? 'slow-escaped' : 'urgent-escaped', [slow]);
  if (slow) window.escapedSlow = escaped;
  React.useMemo(() => window.renderCalls.push(slow ? 'slow' : 'urgent'), [slow]);
  if (slow) throw window.never;
  return <span id="urgent">urgent</span>;
}
function CacheInterruption({value,suspend=false}) {
  const cached = React.useMemo(() => ({value}), [value]);
  window.memoSnapshots.push(cached);
  if (suspend) throw window.never;
  return <span id="memo-stable">{cached.value}</span>;
}
window.mountCache = () => ReactDOM.flushSync(() => cacheRoot.render(<React.Suspense fallback="waiting"><CacheInterruption value="old" /></React.Suspense>));
window.interruptCache = () => React.startTransition(() => cacheRoot.render(<React.Suspense fallback="waiting"><CacheInterruption value="new" suspend /></React.Suspense>));
window.restoreCache = () => ReactDOM.flushSync(() => cacheRoot.render(<React.Suspense fallback="waiting"><CacheInterruption value="old" /></React.Suspense>));
function App({pickLeft = true, showSecond = true}) {
  return <>
    <ValueContext.Provider value="alpha"><Item name="first" /></ValueContext.Provider>
    {showSecond && <ValueContext.Provider value="beta"><Item name="second" /></ValueContext.Provider>}
    <Dynamic pickLeft={pickLeft} />
  </>;
}
window.mountApp = () => ReactDOM.flushSync(() => appRoot.render(<App />));
window.updateApp = () => ReactDOM.flushSync(() => updateFirst(value => value + 1));
window.chooseRight = () => ReactDOM.flushSync(() => appRoot.render(<App pickLeft={false} />));
window.removeSecond = () => ReactDOM.flushSync(() => appRoot.render(<App pickLeft={false} showSecond={false} />));
window.unmountApp = () => appRoot.unmount();
window.mountStrict = () => ReactDOM.flushSync(() => strictRoot.render(<React.StrictMode><Item key="first" name="strict" /></React.StrictMode>));
window.remountStrict = () => ReactDOM.flushSync(() => strictRoot.render(<React.StrictMode><Item key="second" name="strict" /></React.StrictMode>));

window.startInterrupted = () => transitionRoot.render(<React.Suspense fallback={<i id="fallback">waiting</i>}><Interrupt slow /></React.Suspense>);
window.finishInterrupted = () => ReactDOM.flushSync(() => transitionRoot.render(<React.Suspense fallback={<i id="fallback">waiting</i>}><Interrupt slow={false} /></React.Suspense>));
`;

try {
  fs.mkdirSync(path.join(temporary, 'src'));
  fs.writeFileSync(path.join(temporary, 'src/App.tsx'), source);
  fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({
    name: 'react-runtime-lifecycle-probe', private: true,
    dependencies: { react: '18.3.1', 'react-dom': '18.3.1' },
  }));
  const installedLock = JSON.parse(fs.readFileSync(path.join(installedRepository, 'package-lock.json'), 'utf8'));
  const reactLock = installedLock.packages['node_modules/react'];
  const reactDomLock = installedLock.packages['node_modules/react-dom'];
  fs.writeFileSync(path.join(temporary, 'package-lock.json'), JSON.stringify({
    name: 'react-runtime-lifecycle-probe', lockfileVersion: 3,
    packages: {
      '': { name: 'react-runtime-lifecycle-probe', dependencies: { react: '18.3.1', 'react-dom': '18.3.1' } },
      'node_modules/react': reactLock,
      'node_modules/react-dom': reactDomLock,
    },
  }));
  fs.mkdirSync(path.join(temporary, 'node_modules'));
  fs.symlinkSync(path.join(installedRepository, 'node_modules/react'), path.join(temporary, 'node_modules/react'));
  fs.symlinkSync(path.join(installedRepository, 'node_modules/react-dom'), path.join(temporary, 'node_modules/react-dom'));

  const map = analyzeReact({ repository: temporary });
  assert.ok(map.react_semantics.some(row => row.export === 'useContext'),
    JSON.stringify(map.react_semantics.map(row => row.export)));
  assert.ok(map.react_semantics.some(row => row.export === 'useContext'
    && row.causal_bindings.context_id), JSON.stringify(map.react_semantics
      .filter(row => row.export === 'useContext').map(row => row.causal_bindings)));
  assert.equal(map.resolution.packages.find(row => row.name === 'react')
    .react_semantics_verification.verified, true);
  const integration = createReactRuntimeIntegration(map);
  assert.ok(integration.bindings.react_lifecycle.entries.length > 10);
  const transformed = integration.instrumentSource('src/App.tsx', source);
  assert.deepEqual(transformed.diagnostics.filter(row =>
    row.code !== 'unsupported_react_api_observation_transform'), []);
  assert.ok(transformed.applied.some(row => row.transform === 'react_component_render'));
  assert.ok(transformed.applied.some(row => row.transform === 'react_context_provider'));
  assert.ok(transformed.applied.some(row => row.transform === 'react_context_read'),
    JSON.stringify(transformed.applied));
  assert.ok(transformed.applied.some(row => row.transform === 'react_event_callback'));

  const browserSource = transformed.code
    .replace("import * as React from 'react';", '')
    .replaceAll('export ', '');
  const application = ts.transpileModule(browserSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
    jsx: ts.JsxEmit.React,
  } }).outputText;
  const assets = {
    '/runtime.js': fs.readFileSync(new URL('../../dist/producttrace-runtime.js', import.meta.url)),
    '/react.js': fs.readFileSync(path.join(temporary, `node_modules/react/umd/react.${reactBuild}.min.js`)
      .replace('.development.min.js', '.development.js')),
    '/react-dom.js': fs.readFileSync(path.join(temporary, `node_modules/react-dom/umd/react-dom.${reactBuild}.min.js`)
      .replace('.development.min.js', '.development.js')),
  };
  const html = `<!doctype html><div id="app"></div><div id="transition"></div><div id="strict"></div><div id="cache"></div><div id="memo"></div><div id="shared"></div><div id="conditional"></div><div id="state"></div><div id="state-unmount-root"></div><div id="state-failure-root"></div><div id="reducer"></div><div id="replay"></div><div id="initial"></div>
    <script src="/runtime.js"></script><script>
    window.records=[];window.initializerCalls=[];window.effectCalls=[];window.dynamicCalls=[];window.dynamicStateCalls=[];window.renderCalls=[];
    window.never=new Promise(()=>{});window.latestRetained={};window.firstRetained={};window.namedIdentity=[];window.memoSnapshots=[];window.memoCalls=[];window.conditionalCalls=[];window.stateDispatches=[];window.reducerDispatches=[];window.reducerActions=[];window.sharedReducerAction={amount:2};
    window.functionReducerAction=()=>{throw Error('A reducer action must not be invoked as an updater');};window.functionReducerAction.amount=3;
    window.slowReducerAction={amount:10};window.testRecorder=ProductTrace.start(${JSON.stringify(integration.bindings)},
      {outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/react-dom.js"></script>
    <script>${application}
    const appRoot=ReactDOM.createRoot(document.getElementById('app'));
    const transitionRoot=ReactDOM.createRoot(document.getElementById('transition'));
    const strictRoot=ReactDOM.createRoot(document.getElementById('strict'));
    const cacheRoot=ReactDOM.createRoot(document.getElementById('cache'));
    const memoRoot=ReactDOM.createRoot(document.getElementById('memo'));
    const sharedRoot=ReactDOM.createRoot(document.getElementById('shared'));
    const conditionalRoot=ReactDOM.createRoot(document.getElementById('conditional'));
    const stateRoot=ReactDOM.createRoot(document.getElementById('state'));
    const unmountStateRoot=ReactDOM.createRoot(document.getElementById('state-unmount-root'));
    const failureStateRoot=ReactDOM.createRoot(document.getElementById('state-failure-root'));
    const reducerRoot=ReactDOM.createRoot(document.getElementById('reducer'));
    const replayRoot=ReactDOM.createRoot(document.getElementById('replay'));
    const initialRoot=ReactDOM.createRoot(document.getElementById('initial'));
    </script>`;
  const server = http.createServer((request, response) => {
    if (assets[request.url]) response.end(assets[request.url]);
    else { response.setHeader('content-type', 'text/html'); response.end(html); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      // CI and local verification can provide Playwright's headless-shell binary.
      // Falling back to the installed browser keeps the fixture usable on machines
      // that do not cache Playwright browsers.
      executablePath: process.env.PRODUCTTRACE_BROWSER_EXECUTABLE
        || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    const page = await browser.newPage();
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(() => mountApp());
    await page.waitForTimeout(30);
    await page.click('#dynamic');
    await page.evaluate(() => chooseRight());
    await page.click('#dynamic');
    assert.equal(await page.evaluate(() => latestRetained.first === firstRetained.first), true,
      'unchanged dependencies preserve callback identity');
    await page.evaluate(() => updateApp());
    assert.deepEqual(await page.evaluate(() => ({
      changed: latestRetained.first !== firstRetained.first,
      old: firstRetained.first(), current: latestRetained.first(), sibling: latestRetained.second(),
    })), {changed:true, old:'alpha:0', current:'alpha:1', sibling:'beta:0'});
    await page.waitForTimeout(30);
    await page.evaluate(() => removeSecond());
    await page.waitForTimeout(30);
    await page.evaluate(() => startInterrupted());
    await page.waitForSelector('#fallback');
    await page.evaluate(() => finishInterrupted());
    await page.waitForSelector('#urgent');
    assert.equal(await page.evaluate(() => escapedSlow()), 'slow-escaped');
    await page.evaluate(() => unmountApp());
    await page.waitForTimeout(30);
    await page.evaluate(() => mountStrict());
    await page.waitForTimeout(30);
    await page.evaluate(() => remountStrict());
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => latestRetained.strict !== firstRetained.strict), true,
      'a keyed remount must not reuse the old callback identity');
    await page.evaluate(() => mountCache());
    await page.waitForSelector('#memo-stable');
    await page.evaluate(() => interruptCache());
    await page.waitForFunction(() => memoSnapshots.some(value=>value.value==='new'));
    await page.evaluate(() => restoreCache());
    assert.equal(await page.evaluate(() => memoSnapshots[0] === memoSnapshots.at(-1)),true,
      'an abandoned calculation must not replace the committed memo object');
    assert.equal(await page.locator('#memo-stable').textContent(),'old');
    for(const value of [0,0,1]) {
      await page.evaluate(value=>mountMemoCallbacks(value),value);
      await page.click('#memo-direct');
      await page.click('#memo-object');
    }
    assert.deepEqual(await page.evaluate(()=>memoCalls),['direct:0','object:0','direct:0','object:0','direct:1','object:1']);
    assert.equal(await page.evaluate(()=>memoObject.send.name),'send');
    await page.evaluate(()=>{
      memoObject.send=()=>memoCalls.push('replacement');
      mountMemoCallbacks(1);
    });
    await page.click('#memo-object');
    assert.equal(await page.evaluate(()=>memoCalls.at(-1)),'replacement');
    for(const value of [0,1]) {
      await page.evaluate(value=>mountShared(value),value);
      await page.click('#memo-shared');
    }
    for(const [value,revision] of [[0,0],[1,0],[1,1]]) {
      await page.evaluate(([value,revision])=>mountConditional(value,revision),[value,revision]);
      await page.click('#memo-conditional');
    }
    assert.deepEqual(await page.evaluate(()=>conditionalCalls),['negative:0','negative:0','positive:1']);
    await page.evaluate(()=>mountState(2));
    await page.click('#state-update');
    assert.equal(await page.locator('#state-result').textContent(),'4');
    await page.evaluate(()=>mountState(3));
    await page.click('#state-update');
    assert.equal(await page.locator('#state-result').textContent(),'14');
    await page.click('#state-replace');
    assert.equal(await page.locator('#state-result').textContent(),'7');
    await page.click('#state-dynamic');
    assert.equal(await page.locator('#state-result').textContent(),'10');
    await page.evaluate(()=>mountState(1));
    await page.click('#state-dynamic');
    assert.equal(await page.locator('#state-result').textContent(),'30');
    assert.deepEqual(await page.evaluate(()=>dynamicStateCalls),['add','triple']);
    assert.equal(await page.evaluate(()=>stateDispatches.every(value=>value===stateDispatches[0])),true);
    await page.evaluate(()=>mountUnmountingState());
    await page.click('#state-unmount');
    await page.waitForTimeout(30);
    await page.evaluate(()=>mountFailingState());
    await page.click('#state-failure');
    await page.waitForTimeout(30);
    await page.evaluate(()=>mountReducer(1));
    await page.click('#reducer-object');
    assert.equal(await page.locator('#reducer-result').textContent(),'6');
    await page.evaluate(()=>mountReducer(5));
    await page.click('#reducer-object');
    assert.equal(await page.locator('#reducer-result').textContent(),'20');
    await page.click('#reducer-primitive');
    assert.equal(await page.locator('#reducer-result').textContent(),'34');
    await page.click('#reducer-function');
    assert.equal(await page.locator('#reducer-result').textContent(),'42');
    await page.click('#reducer-replay');
    await page.waitForFunction(()=>document.getElementById('reducer-result').textContent==='63');
    assert.equal(await page.evaluate(()=>reducerDispatches.every(value=>value===reducerDispatches[0])),true);
    assert.equal(await page.evaluate(()=>reducerActions.filter(value=>typeof value==='object')
      .every(value=>value===sharedReducerAction||value===slowReducerAction)),true);
    assert.equal(await page.evaluate(()=>reducerActions.some(value=>value===functionReducerAction)),true);
    await page.evaluate(()=>mountReplay());
    await page.click('#state-replay');
    await page.waitForFunction(()=>document.getElementById('replay-result').textContent==='11');
    await page.evaluate(()=>mountInitial(3,0));
    assert.deepEqual(await page.locator('[data-initial]').allTextContents(),['3:4','3:4']);
    await page.evaluate(()=>mountInitial(9,0));
    assert.deepEqual(await page.locator('[data-initial]').allTextContents(),['3:4','3:4']);
    assert.deepEqual(await page.evaluate(()=>initializerCalls),['state:first:3','reducer:first:3','state:second:3','reducer:second:3']);
    await page.evaluate(()=>mountInitial(5,1));
    assert.deepEqual(await page.locator('[data-initial]').allTextContents(),['5:6','5:6']);
    assert.equal(await page.evaluate(()=>initializerCalls.length),8);
    const observed = await page.evaluate(() => ({
      all:records,
      lifecycle: records.filter(record => record.kind === 'react_lifecycle'),
      callbacks: records.filter(record => record.kind === 'react_callback'),
      apis: records.filter(record => record.kind === 'react_api'),
      effectCalls, dynamicCalls, renderCalls, namedIdentity,
    }));

    await page.click('#reducer-stop');
    await page.waitForFunction(()=>document.getElementById('reducer-result')?.textContent!=='63');
    assert.equal(await page.evaluate(()=>testRecorder.status().disabled),true);
    assert.ok(pageErrors.some(message=>message.includes('state-calculation-sentinel')),JSON.stringify(pageErrors));
    assert.deepEqual(pageErrors.filter(message=>!message.includes('state-calculation-sentinel')),[]);
    assert.equal(await page.evaluate(()=>records.filter(row=>row.operation==='state_requested' && row.update_kind==='reducer').length),10,
      'the stopped request must have crossed the instrumented dispatch boundary');
    assert.equal(await page.locator('#reducer-result').textContent(),'70',
      'stopping recording must not change an already queued reducer action');
    assert.deepEqual(observed.dynamicCalls, ['left', 'right']);
    assert.ok(observed.effectCalls.includes('setup:first:alpha:0'));
    assert.ok(observed.effectCalls.includes('cleanup:first:alpha:0'));
    assert.ok(observed.effectCalls.includes('cleanup:second:beta:0'));
    assert.ok(observed.renderCalls.includes('slow'));
    assert.ok(observed.renderCalls.includes('urgent'));
    if (reactBuild === 'development') {
      assert.ok(observed.lifecycle.some(record => record.operation === 'render_abandoned'),
        JSON.stringify(observed.lifecycle.map(record => ({ operation: record.operation,
          source_call_id: record.source_call_id, root_id: record.root_id,
          instance_id: record.instance_id, render_id: record.render_id }))));
    }
    assert.ok(observed.lifecycle.some(record => record.operation === 'unmounted'));
    const unmountSource=map.react_semantics.find(row=>row.export==='useState'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('function UnmountingState'));
    const unmountRows=observed.lifecycle.filter(row=>row.source_call_id===unmountSource.call_id);
    const unmountedRequest=unmountRows.find(row=>row.operation==='state_requested');
    assert.ok(unmountedRequest);assert.ok(unmountRows.some(row=>row.operation==='unmounted'&&row.mount_id===unmountedRequest.mount_id));
    assert.equal(unmountRows.some(row=>row.operation==='state_committed'
      && row.committed_updates.some(update=>update.request_id===unmountedRequest.request_id)),false);
    const failureSource=map.react_semantics.find(row=>row.export==='useState'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('function FailingState'));
    const failureRows=observed.lifecycle.filter(row=>row.source_call_id===failureSource.call_id);
    const failed=failureRows.find(row=>row.operation==='state_calculation_failed');
    assert.ok(failed);assert.equal(failureRows.some(row=>row.operation==='state_committed'
      && row.committed_updates.some(update=>update.request_id===failed.request_id)),false);

    const contextReads = observed.lifecycle.filter(record => record.operation === 'value_read');
    assert.ok(contextReads.some(record => record.context_value.value === 'alpha'
      && record.provider_protocol_application_id), JSON.stringify(contextReads));
    assert.ok(contextReads.some(record => record.context_value.value === 'beta'
      && record.provider_protocol_application_id));
    assert.equal(new Set(contextReads.map(record => record.mount_id)).size >= 2, true);

    const session = createReactLifecycleEvidenceSession(map);
    // Replay the complete evidence stream: context reads now depend on the
    // earlier creation record, just as callbacks depend on their origin.
    const lifecycleJoins = [];
    for (const record of observed.all) {
      if (record.kind === 'react_context_origin') {
        assert.equal(session.joinContextOrigin(record).status, 'resolved');
      } else if (record.kind === 'react_lifecycle') {
        lifecycleJoins.push(session.join(record));
      }
    }
    const escapedSource=map.react_semantics.find(row=>row.export==='useCallback'
      && map.nodes.find(node=>node.id===row.call_id)?.text.includes('slow-escaped'));
    const escapedInvocationIndex=observed.lifecycle.findIndex(row=>row.source_call_id===escapedSource.call_id
      && row.operation==='callback_invoked');
    assert.ok(escapedInvocationIndex>=0,'the actual escaped callback invocation must be recorded');
    const escapedJoin=lifecycleJoins[escapedInvocationIndex];
    if(reactBuild==='development') {
      assert.equal(escapedJoin.status,'resolved',JSON.stringify(escapedJoin));
      assert.equal(escapedJoin.runtime.owner_lifecycle,'abandoned');
      assert.equal(escapedJoin.runtime.committed_execution,false);
    } else {
      assert.equal(escapedJoin.status,'unresolved');
      // The production renderer never committed/adopted this attempted owner.
      // Keep the observed body call, but do not invent its mounted lineage.
      assert.equal(escapedJoin.reason,'callback_render_identity_unobserved');
    }
    assert.deepEqual(lifecycleJoins.flatMap((join,index)=>join.status==='resolved'
      || reactBuild==='production' && index===escapedInvocationIndex ? [] : [{join,record:observed.lifecycle[index]}]), []);
    const initialSources=map.react_semantics.filter(row=>['useState','useReducer'].includes(row.export)
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('function InitialState'));
    assert.equal(initialSources.length,2);
    for(const source of initialSources) {
      const rows=observed.lifecycle.filter(row=>row.source_call_id===source.call_id);
      const products=rows.filter(row=>row.operation==='value_produced');
      const reads=rows.filter(row=>row.operation==='state_read');
      assert.equal(products.length,4);assert.equal(new Set(products.map(row=>row.mount_id)).size,4);
      assert.equal(new Set(products.map(row=>row.value_id)).size,4,'equal-shaped objects must keep distinct value identity');
      assert.equal(reads.filter(row=>row.initialization_status==='observed_return').length,4);
      assert.equal(reads.filter(row=>row.initialization_status==='unobserved').length,2,
        'rerendering does not invoke the initializer again');
      for(const read of reads.filter(row=>row.initialization_production_id)) {
        const product=products.find(row=>row.production_id===read.initialization_production_id);
        assert.ok(product);assert.equal(product.mount_id,read.mount_id);assert.equal(product.render_id,read.render_id);
        assert.equal(product.value_id,read.initialization_value_id);
        const call=rows.find(row=>row.invocation_id===product.caused_by_invocation_id);
        assert.ok(call);assert.equal(call.operation,'callback_invoked');
      }
    }
    const replaySource=map.react_semantics.find(row=>row.export==='useState'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('function StateReplay'));
    const replay=observed.lifecycle.filter(row=>row.source_call_id===replaySource.call_id);
    const replayRequests=replay.filter(row=>row.operation==='state_requested');
    assert.equal(replayRequests.length,2);
    const urgent=replay.filter(row=>row.operation==='state_calculated' && row.request_id===replayRequests[1].request_id);
    assert.ok(urgent.some(row=>row.next_state.value===1));
    assert.ok(urgent.some(row=>row.next_state.value===11));
    assert.equal(new Set(urgent.map(row=>row.invocation_id)).size,urgent.length);
    assert.deepEqual([...new Set(replay.filter(row=>row.operation==='state_read').map(row=>row.value.value))],[0,1,11]);
    const replayCommits=replay.filter(row=>row.operation==='state_committed');
    assert.deepEqual(replayCommits.map(row=>row.value.value),[1,11]);
    assert.deepEqual(replayCommits.map(row=>row.committed_updates.length),[1,2]);
    assert.deepEqual(replayCommits[1].committed_updates.map(row=>row.request_id),replayRequests.map(row=>row.request_id));
    const reducerSource=map.react_semantics.find(row=>row.export==='useReducer'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('ReducerUpdates'));
    const reducerRecords=observed.lifecycle.filter(row=>row.source_call_id===reducerSource.call_id);
    const reducerRequests=reducerRecords.filter(row=>row.operation==='state_requested');
    assert.equal(reducerRequests.length,9);
    assert.equal(new Set(reducerRequests.map(row=>row.request_id)).size,9);
    assert.equal(new Set(reducerRequests.slice(0,4).map(row=>row.update_value_id)).size,1,
      'the same action identity has four distinct request identities');
    for(const [index,expected] of [3,6,13,20,27,34,42].entries()) {
      const values=reducerRecords.filter(row=>row.operation==='state_calculated' && row.request_id===reducerRequests[index].request_id);
      assert.ok(values.length>0);assert.ok(values.every(row=>row.next_state.value===expected));
    }
    const reducerReplayCommits=reducerRecords.filter(row=>row.operation==='state_committed').slice(-2);
    assert.deepEqual(reducerReplayCommits.map(row=>row.value.value),[48,63]);
    assert.deepEqual(reducerReplayCommits.map(row=>row.committed_updates.length),[1,2]);
    const stateSource=map.react_semantics.find(row=>row.export==='useState'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('StateUpdates'));
    const stateRecords=observed.lifecycle.filter(row=>row.source_call_id===stateSource.call_id);
    const requests=stateRecords.filter(row=>row.operation==='state_requested');
    assert.equal(requests.length,7);assert.ok(requests.every(row=>row.action_occurrence_id));
    const calculations=stateRecords.filter(row=>row.operation==='state_calculated');
    assert.ok(calculations.length>=6);
    for(const [requestIndex,expected] of [[0,2],[1,4],[2,7],[3,14]]) {
      const values=calculations.filter(row=>row.request_id===requests[requestIndex].request_id).map(row=>row.next_state.value);
      assert.ok(values.length>0);assert.ok(values.every(value=>value===expected));
    }
    assert.equal(calculations.some(row=>row.request_id===requests[4].request_id),false,
      'a literal replacement does not invoke an application updater');
    assert.deepEqual([...new Set(stateRecords.filter(row=>row.operation==='state_read').map(row=>row.value.value))],[0,4,14,7,10,30]);
    const dynamicWrite=map.edges.find(row=>row.relation==='state_write'&&row.updater_source_candidates?.length===2);
    assert.ok(dynamicWrite);assert.equal(new Set(dynamicWrite.updater_source_candidates.map(row=>row.source_id)).size,2);
    const dynamicRequests=requests.filter(row=>dynamicWrite.updater_source_candidates.some(candidate=>candidate.source_id===row.callback_source_id));
    assert.equal(dynamicRequests.length,2);assert.equal(new Set(dynamicRequests.map(row=>row.callback_source_id)).size,2);
    const stateJoins=lifecycleJoins.filter(row=>row.source?.call_id===stateSource.call_id
      && row.runtime.operation.startsWith('state_'));
    assert.ok(stateJoins.filter(row=>row.runtime.operation!=='state_committed')
      .every(row=>row.runtime.commit_causality==='unproven'));
    assert.ok(stateJoins.some(row=>row.runtime.operation==='state_committed'
      && row.runtime.commit_causality==='proven' && row.runtime.committed_updates.length>0));
    const itemStateSource=map.react_semantics.find(row=>row.export==='useState'
      && map.nodes.find(node=>node.id===row.causal_bindings.owner_source_id)?.text.includes('function Item'));
    const committedItemRenders=new Set(observed.lifecycle.filter(row=>row.operation==='render_committed').map(row=>row.render_id));
    const itemReads=observed.lifecycle.filter(row=>row.source_call_id===itemStateSource.call_id&&row.operation==='state_read'
      &&committedItemRenders.has(row.render_id));
    const identitiesByMount=Map.groupBy(itemReads,row=>row.mount_id);
    assert.ok(identitiesByMount.size>=4);
    assert.ok([...identitiesByMount.values()].every(rows=>new Set(rows.map(row=>row.state_identity_id)).size===1),
      JSON.stringify([...identitiesByMount].map(([mount,rows])=>({mount,states:[...new Set(rows.map(row=>row.state_identity_id))]}))));
    assert.equal(new Set([...identitiesByMount.values()].map(rows=>rows[0].state_identity_id)).size,identitiesByMount.size);
    const cacheSource=map.react_semantics.find(row=>row.export==='useMemo'
      && map.nodes.find(node=>node.id===row.call_id)?.text.includes('({value})'));
    const cacheSelections=observed.lifecycle.filter(row=>row.source_call_id===cacheSource.call_id
      && row.operation==='value_selected');
    assert.ok(cacheSelections.length>=2);
    assert.equal(cacheSelections[0].production_id,cacheSelections.at(-1).production_id);
    assert.equal(cacheSelections[0].value_id,cacheSelections.at(-1).value_id);
    assert.equal(cacheSelections[0].render_id,cacheSelections.at(-1).origin_render_id);
    assert.notEqual(cacheSelections[0].render_id,cacheSelections.at(-1).render_id);
    const effectSource=map.react_semantics.find(row=>row.export==='useEffect');
    const effectNameBinding=effectSource.causal_bindings.callbacks[0].captures.find(capture=>
      map.nodes.find(node=>node.id===capture.read_id)?.text==='name').binding_id;
    for(const operation of ['callback_invoked','cleanup_invoked']) {
      for(const name of ['first','second','strict']) assert.ok(observed.lifecycle.some(row=>
        row.source_call_id===effectSource.call_id && row.operation===operation
        && row.captured_values.some(value=>value.binding_id===effectNameBinding && value.value===name)),
      `missing original effect capture for ${operation}:${name}`);
    }
    const retainedSource = map.react_semantics.find(row => row.export === 'useCallback'
      && map.nodes.find(node => node.id === row.call_id)?.text.includes("value + ':' + count"));
    assert.ok(observed.namedIdentity.every(row => row.name === 'original' && row.inferred === 'inferred' && row.length === 1),
      JSON.stringify(observed.namedIdentity));
    assert.ok(observed.namedIdentity.some(row => row.same && row.value === '>alpha:0!'));
    assert.ok(observed.namedIdentity.some(row => row.same && row.value === '>alpha:1!'));
    assert.ok(observed.namedIdentity.some(row => row.value === '>beta:0!'));
    const retained = observed.lifecycle.filter(row => row.source_call_id === retainedSource.call_id);
    const creations = retained.filter(row => row.operation === 'callback_created');
    const selections = retained.filter(row => row.operation === 'callback_selected');
    const invocations = retained.filter(row => row.operation === 'callback_invoked');
    assert.ok(creations.length >= 4 && selections.length >= 4 && invocations.length >= 6);
    assert.ok(selections.some(row => row.render_id !== row.origin_render_id),
      'React returned the older closure on at least one unchanged-dependency rerender');
    const valueBinding = retainedSource.causal_bindings.callbacks[0].captures.find(capture =>
      map.nodes.find(node => node.id === capture.read_id)?.text === 'value').binding_id;
    const countBinding = retainedSource.causal_bindings.callbacks[0].captures.find(capture =>
      map.nodes.find(node => node.id === capture.read_id)?.text === 'count').binding_id;
    const strictInvocations=invocations.filter(row=>row.captured_values.some(item=>
      item.binding_id===valueBinding && item.value==='default'));
    assert.equal(new Set(strictInvocations.map(row=>row.mount_id)).size,2,
      'StrictMode keyed remounts have distinct callback owners');
    for (const [value, count] of [['alpha',0], ['alpha',1], ['beta',0]]) {
      assert.ok(invocations.some(row => row.captured_values.some(item =>
        item.binding_id === valueBinding && item.value === value) && row.captured_values.some(item =>
        item.binding_id === countBinding && item.value === count)), `${value}:${count}`);
    }
    for (const invocation of invocations) {
      const origin = creations.find(row => row.callback_identity_id === invocation.callback_identity_id);
      assert.ok(origin);
      assert.equal(invocation.render_id, origin.render_id);
      assert.equal(invocation.mount_id, origin.mount_id);
    }
    // The consumer must reject a plausible-looking identity from another
    // committed render or sibling even when source offsets are identical.
    const lastInvocation = invocations.find(row => creations.some(origin => origin.mount_id !== row.mount_id
      && observed.lifecycle.indexOf(origin) < observed.lifecycle.indexOf(row)));
    const otherOrigin = creations.find(row => row.mount_id !== lastInvocation.mount_id
      && observed.lifecycle.indexOf(row) < observed.lifecycle.indexOf(lastInvocation));
    const negativeSession = createReactLifecycleEvidenceSession(map);
    for (const row of observed.all) {
      if (row.observation_id === lastInvocation.observation_id) break;
      if (row.kind === 'react_context_origin') {
        assert.equal(negativeSession.joinContextOrigin(row).status, 'resolved');
      } else if (row.kind === 'react_lifecycle') {
        assert.equal(negativeSession.join(row).status, 'resolved');
      }
    }
    assert.equal(negativeSession.join({...lastInvocation, observation_id:'mutant-sibling',
      invocation_id:'mutant-sibling-invocation', callback_identity_id:otherOrigin.callback_identity_id}).reason,
    'callback_identity_lineage_mismatch');
    assert.equal(negativeSession.join({...lastInvocation, observation_id:'mutant-origin',
      invocation_id:'mutant-origin-invocation', render_id:'unobserved-render'}).reason,
    'callback_render_identity_unobserved');

    const delivered=[];
    const connected=createReactRuntimeIntegration(map,{onJoin:result=>delivered.push(result)});
    for(const record of observed.all) connected.onRecord(record);
    const callbackJoins=delivered.filter(row=>row.schema==='producttrace.react-callback-join.v1');
    assert.deepEqual(callbackJoins.filter(row=>row.status!=='resolved').map(row=>row.reason),
      ['memo_callback_origin_unobserved','memo_callback_origin_ambiguous']);
    const memoJoins=callbackJoins.filter(row=>row.runtime?.memo_callback);
    assert.equal(memoJoins.length,10);
    const conditional=map.react_semantics.find(row=>row.export==='useMemo'
      && map.nodes.find(node=>node.id===row.call_id)?.text.includes('conditionalCalls'));
    const conditionalJoins=memoJoins.filter(row=>row.runtime.memo_callback.source.call_id===conditional.call_id);
    assert.equal(conditionalJoins.length,3);
    assert.deepEqual(conditionalJoins.map(row=>row.source.conditions.at(-1).branch),['falsy','falsy','truthy']);
    assert.equal(conditionalJoins[0].runtime.memo_callback.runtime.production_id,conditionalJoins[1].runtime.memo_callback.runtime.production_id);
    assert.notEqual(conditionalJoins[1].runtime.memo_callback.runtime.production_id,conditionalJoins[2].runtime.memo_callback.runtime.production_id);
    for(const name of ['direct','object']) {
      const source=map.react_semantics.find(row=>row.export==='useMemo'
        && map.nodes.find(node=>node.id===row.call_id)?.text.includes("'"+name+":'"));
      const selected=memoJoins.filter(row=>row.runtime.memo_callback.source.call_id===source.call_id)
        .map(row=>row.runtime.memo_callback.runtime);
      assert.equal(selected.length,3);
      assert.equal(selected[0].production_id,selected[1].production_id);
      assert.notEqual(selected[1].production_id,selected[2].production_id);
      const capture=source.causal_bindings.result_callbacks[0].captures.find(row=>
        map.nodes.find(node=>node.id===row.read_id)?.text==='value');
      assert.deepEqual(selected.map(row=>row.captured_values.find(value=>value.binding_id===capture.binding_id)?.value),[0,0,1]);
    }
    // An event alone cannot stand in for the missing calculation/production evidence.
    const disconnected=createReactRuntimeIntegration(map);
    const memoEvent=observed.callbacks.find(row=>row.memo_observation_id);
    assert.equal(disconnected.joinCallback(memoEvent).reason,'memo_callback_runtime_lineage_required');
    assert.equal(connected.joinCallback({...memoEvent,action_occurrence_id:'foreign-action'}).reason,'memo_callback_runtime_lineage_required');
    assert.equal(callbackJoins.filter(join => join.status === 'resolved').length, 12);
    assert.equal(new Set(callbackJoins.filter(join => join.status === 'resolved')
      .map(join => join.source.handler_source_id)).size, 7);
    const apiJoins = observed.apis.map(record => integration.joinApi(record));
    assert.deepEqual(apiJoins.filter(join => join.status !== 'resolved'), [],
      JSON.stringify(apiJoins.filter(join => join.status !== 'resolved')));

    const joinedApiOperations = {};
    const joinedCallbackSlots = {};
    for (const [index, join] of lifecycleJoins.entries()) {
      if (join.status !== 'resolved') continue;
      const semanticId = observed.lifecycle[index].semantic_id;
      const operations = joinedApiOperations[semanticId] || [];
      if (!operations.includes(observed.lifecycle[index].operation)) {
        operations.push(observed.lifecycle[index].operation);
      }
      joinedApiOperations[semanticId] = operations.sort();
      const record = observed.lifecycle[index];
      if (['callback_invoked','cleanup_invoked'].includes(record.operation) && record.callback_slot) {
        const slots = joinedCallbackSlots[semanticId] || [];
        if (!slots.includes(record.callback_slot)) slots.push(record.callback_slot);
        joinedCallbackSlots[semanticId] = slots.sort();
      }
    }
    console.log(JSON.stringify({
      react: React.version,
      react_build: reactBuild,
      installed_source_attested: true,
      retained_callback_path_verified: true,
      memo_value_path_verified:true,
      memo_callback_consumer_path_verified:true,
      memo_conditional_path_verified:true,
      state_updater_path_verified:true,
      reducer_action_path_verified:true,
      state_priority_replay_observed:true,
      state_initializer_return_path_verified:true,
      state_commit_attribution_verified:true,
      state_dynamic_callback_paths_verified:true,
      state_errors_and_unmount_verified:true,
      state_remount_identity_verified:true,
      state_commit_summaries:observed.lifecycle.filter(row=>row.operation==='state_committed').map(row=>({
        api:row.semantic_id,value:row.value.value,basis:row.selection_basis,updates:row.committed_updates.length,
      })),
      recording_stop_preserves_queued_state:true,
      strict_remount_verified: true,
      escaped_abandoned_callback_verified:true,
      escaped_abandoned_callback_status:escapedJoin.status,
      runtime_lifecycle_records: observed.lifecycle.length,
      runtime_lifecycle_joins: lifecycleJoins.length,
      resolved_lifecycle_joins:lifecycleJoins.filter(row=>row.status==='resolved').length,
      unresolved_lifecycle_joins:lifecycleJoins.filter(row=>row.status!=='resolved').length,
      mounted_instances: new Set(contextReads.map(record => record.mount_id)).size,
      dynamic_callback_paths: callbackJoins.filter(join => join.status === 'resolved').length,
      interrupted_render_recorded: observed.lifecycle.some(record => record.operation === 'render_abandoned'),
      context_provider_paths: new Set(contextReads.map(record => record.provider_protocol_application_id)).size,
      joined_api_operations: Object.fromEntries(Object.entries(joinedApiOperations)
        .sort(([left], [right]) => left.localeCompare(right))),
      joined_callback_slots: Object.fromEntries(Object.entries(joinedCallbackSlots)
        .sort(([left], [right]) => left.localeCompare(right))),
      joined_api_invocations: Object.fromEntries([...new Set(apiJoins.map(join => join.source.semantic_id))]
        .sort().map(semanticId => [semanticId,
          apiJoins.filter(join => join.source.semantic_id === semanticId).length])),
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
