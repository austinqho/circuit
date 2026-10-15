import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {analyzeReact,createReactLifecycleEvidenceSession,createReactRuntimeIntegration}
  from '../../analysis/index.mjs';

const installedRepository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
const installedRequire=createRequire(path.join(installedRepository,'package.json'));
const {chromium}=installedRequire('playwright');
const React=installedRequire('react');
assert.equal(React.version,'18.3.1');
const reactBuild=process.env.PRODUCTTRACE_REACT_BUILD==='production'?'production':'development';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'producttrace-react-api-runtime-'));

const source=`import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
window.apiVersions=[React.version,ReactDOM.version];
window.readVersions=()=>[React.version,ReactDOM.version];
const Context=React.createContext('default');
const objectRef=React.createRef();
const Factory=React.createFactory('em');
const Lazy=React.lazy(()=>Promise.resolve({default:()=>React.createElement('small',null,'lazy')}));
const Forward=React.forwardRef(function Forward(props,ref){
  React.useImperativeHandle(ref,()=>({value:props.value}),[props.value]);
  return React.createElement('i',null,props.value);
});
const Memo=React.memo(function Memo({value}){return React.createElement('b',null,value)},(a,b)=>a.value===b.value);
class Classic extends React.Component {render(){return React.createElement('span',null,this.props.value)}}
class Pure extends React.PureComponent {render(){return React.createElement('span',null,this.props.value)}}
let update;
const listeners=new Set();
async function settle(work=()=>{}){if(window.reactProduction){work();await new Promise(resolve=>setTimeout(resolve,20));}
  else await React.act(async()=>work());}
function Probe({value}){
  const [state,setState]=React.useState(()=>0);update=setState;
  const [reduced,dispatch]=React.useReducer((current,action)=>current+action,1,value=>value+1);
  const callback=React.useCallback(()=>value,[value]);
  const memo=React.useMemo(()=>callback()+state+reduced,[callback,state,reduced]);
  const ref=React.useRef(value);
  const id=React.useId();
  React.useDebugValue(value,current=>'debug:'+current);
  const deferred=React.useDeferredValue(value);
  const [pending,start]=React.useTransition();
  const context=React.useContext(Context);
  React.useInsertionEffect(()=>{window.apiLog.push('insert:'+value);return()=>window.apiLog.push('remove:'+value)},[value]);
  React.useLayoutEffect(()=>{window.apiLog.push('layout:'+value);return()=>window.apiLog.push('unlayout:'+value)},[value]);
  React.useEffect(()=>{window.apiLog.push('effect:'+value);return()=>window.apiLog.push('uneffect:'+value)},[value]);
  const snapshot=React.useSyncExternalStore(notify=>{listeners.add(notify);return()=>listeners.delete(notify)},()=>value,()=>value);
  window.probe={state,reduced,dispatch,callback,memo,ref,id,deferred,pending,start,context,snapshot};
  return React.createElement(React.Fragment,null,
    React.createElement(Forward,{ref:objectRef,value}),
    React.createElement(Memo,{value}),
    React.createElement(Classic,{value}),React.createElement(Pure,{value}),
    React.createElement(React.Profiler,{id:'profile',onRender:()=>window.apiLog.push('profile')},
      React.createElement('button',{id:'probe'},String(memo))));
}
function tree(value){return React.createElement(React.StrictMode,null,
  React.createElement(Context.Provider,{value},
    React.createElement(React.Suspense,{fallback:'waiting'},React.createElement(Probe,{value}),React.createElement(Lazy))));}
window.runApiPath=async()=>{
  const children=[React.createElement('u',{key:'a'},'a'),null];
  React.Children.map(children,child=>child);React.Children.forEach(children,child=>child);
  React.Children.count(children);React.Children.toArray(children);React.Children.only(children[0]);
  const element=React.createElement('div',{value:1});
  React.cloneElement(element,{value:2});React.isValidElement(element);Factory(null,'factory');
  ReactDOM.unstable_batchedUpdates(value=>window.apiLog.push('batch:'+value),'x');
  React.startTransition(()=>window.apiLog.push('startTransition'));
  if(!window.reactProduction){await React.act(async()=>{});await React.unstable_act(async()=>{});}
  const portalHost=document.createElement('div');document.body.append(portalHost);
  ReactDOM.createPortal(React.createElement('i',null,'portal'),portalHost);
  const host=document.getElementById('root');
  const root=ReactDOMClient.createRoot(host);
  ReactDOM.flushSync(()=>root.render(tree('a')));
  await settle();
  ReactDOM.flushSync(()=>update(current=>current+1));
  ReactDOM.flushSync(()=>root.render(tree('b')));
  await settle();
  ReactDOM.findDOMNode(host.querySelector('span'));
  root.unmount();
  const directHost=document.createElement('div');document.body.append(directHost);
  const directRoot=ReactDOM.createRoot(directHost);directRoot.render(React.createElement('b',null,'direct'));
  await settle();directRoot.unmount();
  const hydrationClient=document.createElement('div');hydrationClient.innerHTML='<b>hydrate</b>';document.body.append(hydrationClient);
  const hydratedClient=ReactDOMClient.hydrateRoot(hydrationClient,React.createElement('b',null,'hydrate'));
  await settle();hydratedClient.unmount();
  const hydrationDom=document.createElement('div');hydrationDom.innerHTML='<b>hydrate</b>';document.body.append(hydrationDom);
  const hydratedDom=ReactDOM.hydrateRoot(hydrationDom,React.createElement('b',null,'hydrate'));
  await settle();hydratedDom.unmount();
  const legacy=document.createElement('div');document.body.append(legacy);
  await settle(()=>ReactDOM.render(React.createElement(Classic,{value:'legacy'}),legacy,()=>window.apiLog.push('rendered')));
  const parent=ReactDOM.render(React.createElement(Classic,{value:'parent'}),legacy);
  ReactDOM.findDOMNode(parent);
  const subtree=document.createElement('div');document.body.append(subtree);
  await settle(()=>ReactDOM.unstable_renderSubtreeIntoContainer(parent,
    React.createElement('i',null,'subtree'),subtree,()=>window.apiLog.push('subtree')));
  ReactDOM.unmountComponentAtNode(subtree);
  ReactDOM.unmountComponentAtNode(legacy);
  const hydration=document.createElement('div');hydration.innerHTML='<b>legacy-hydrate</b>';document.body.append(hydration);
  await settle(()=>ReactDOM.hydrate(React.createElement('b',null,'legacy-hydrate'),hydration,()=>window.apiLog.push('hydrated')));
  ReactDOM.unmountComponentAtNode(hydration);
  portalHost.remove();directHost.remove();legacy.remove();hydration.remove();hydrationClient.remove();hydrationDom.remove();subtree.remove();
};`;

try{
  fs.mkdirSync(path.join(temporary,'src'));
  fs.writeFileSync(path.join(temporary,'src/App.tsx'),source);
  fs.writeFileSync(path.join(temporary,'package.json'),JSON.stringify({name:'react-api-runtime-probe',private:true,
    dependencies:{react:'18.3.1','react-dom':'18.3.1'}}));
  const installedLock=JSON.parse(fs.readFileSync(path.join(installedRepository,'package-lock.json'),'utf8'));
  fs.writeFileSync(path.join(temporary,'package-lock.json'),JSON.stringify({name:'react-api-runtime-probe',lockfileVersion:3,
    packages:{'':{name:'react-api-runtime-probe',dependencies:{react:'18.3.1','react-dom':'18.3.1'}},
      'node_modules/react':installedLock.packages['node_modules/react'],
      'node_modules/react-dom':installedLock.packages['node_modules/react-dom']}}));
  fs.mkdirSync(path.join(temporary,'node_modules'));
  fs.symlinkSync(path.join(installedRepository,'node_modules/react'),path.join(temporary,'node_modules/react'));
  fs.symlinkSync(path.join(installedRepository,'node_modules/react-dom'),path.join(temporary,'node_modules/react-dom'));
  const map=analyzeReact({repository:temporary});
  const integration=createReactRuntimeIntegration(map);
  const transformed=integration.instrumentSource('src/App.tsx',source);
  assert.deepEqual(transformed.diagnostics.filter(row=>
    row.code!=='unsupported_react_api_observation_transform'),[]);
  const browserSource=transformed.code
    .replace("import * as React from 'react';",'const React=window.React;')
    .replace("import * as ReactDOM from 'react-dom';",'const ReactDOM=window.ReactDOM;')
    .replace("import * as ReactDOMClient from 'react-dom/client';",'const ReactDOMClient=window.ReactDOM;');
  const application=ts.transpileModule(browserSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,
    module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const assets={
    '/runtime.js':fs.readFileSync(new URL('../../dist/producttrace-runtime.js',import.meta.url)),
    '/react.js':fs.readFileSync(path.join(temporary,`node_modules/react/umd/react.${reactBuild}.min.js`).replace('.development.min.js','.development.js')),
    '/react-dom.js':fs.readFileSync(path.join(temporary,`node_modules/react-dom/umd/react-dom.${reactBuild}.min.js`).replace('.development.min.js','.development.js')),
  };
  const html=`<!doctype html><div id="root"></div><script src="/runtime.js"></script><script>
    window.records=[];window.apiLog=[];window.reactProduction=${reactBuild==='production'};ProductTrace.start(${JSON.stringify(integration.bindings)},
      {outputMode:'evidence',onRecord:record=>records.push(record)});
    </script><script src="/react.js"></script><script src="/react-dom.js"></script><script>${application}</script>`;
  const server=http.createServer((request,response)=>{if(assets[request.url])response.end(assets[request.url]);
    else{response.setHeader('content-type','text/html');response.end(html);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.PRODUCTTRACE_BROWSER_EXECUTABLE
      ||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(()=>runApiPath());await page.waitForTimeout(50);
    assert.deepEqual(errors,[]);
    const observed=await page.evaluate(()=>({records,apiLog}));
    const hostRecords=observed.records.filter(row=>row.kind==='react_host');assert.equal(hostRecords.length,9);
    for(const row of hostRecords)assert.equal(integration.joinHost(row).status,'resolved');
    const apiRecords=observed.records.filter(record=>record.kind==='react_api');
    const apiJoins=apiRecords.map(record=>integration.joinApi(record));
    assert.deepEqual(apiJoins.filter(join=>join.status!=='resolved'),[]);
    const versionJoins=apiJoins.filter(row=>row.source.export==='version');
    assert.equal(versionJoins.length,2);
    assert.ok(versionJoins.every(row=>row.runtime.export_value?.value===
      (row.source.surface==='react-dom' && reactBuild==='production'?'18.3.1-next-f1338f8080-20240426':'18.3.1')));
    const domVersion=apiRecords.find(row=>row.surface==='react-dom' && row.export==='version');
    assert.equal(integration.joinApi({...domVersion,export_build:null}).reason,'literal_export_build_required');
    assert.equal(integration.joinApi({...domVersion,export_build:reactBuild==='production'?'development':'production'}).reason,'literal_export_value_mismatch');
    for(const row of apiRecords.filter(row=>row.export==='version')) {
      assert.equal(integration.joinApi({...row,export_value:{encoding:'primitive',value:'wrong'}}).reason,'literal_export_value_mismatch');
      assert.equal(integration.joinApi({...row,export_value:undefined}).reason,'literal_export_value_mismatch');
    }
    const ambiguousVersions=await page.evaluate(()=>{
      const hook=window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      hook.renderers.set(-1,{rendererPackageName:'react-dom',bundleType:window.reactProduction?1:0});
      const start=records.length;
      try { readVersions();return records.slice(start).filter(row=>row.kind==='react_api'); }
      finally {hook.renderers.delete(-1);}
    });
    assert.equal(ambiguousVersions.length,2);
    assert.equal(integration.joinApi(ambiguousVersions.find(row=>row.surface==='react-dom')).reason,'literal_export_build_required');
    assert.equal(integration.joinApi(ambiguousVersions.find(row=>row.surface==='react')).status,'resolved');
    const lifecycleRecords=observed.records.filter(record=>record.kind==='react_lifecycle');
    const lifecycleSession=createReactLifecycleEvidenceSession(map,{wrapperEntries:integration.bindings.react_lifecycle.entries});
    const lifecycleJoins=[];
    for(const record of observed.records) {
      if(record.kind==='react_wrapper')assert.equal(lifecycleSession.joinWrapper(record).status,'resolved');
      else if(record.kind==='react_context_origin')assert.equal(lifecycleSession.joinContextOrigin(record).status,'resolved');
      else if(record.kind==='react_lifecycle')lifecycleJoins.push(lifecycleSession.join(record));
    }
    const rejectedLifecycle=lifecycleJoins.map((join,index)=>({join,record:lifecycleRecords[index]}))
      .filter(row=>row.join.status!=='resolved');
    assert.deepEqual(rejectedLifecycle,[]);
    const invocations={};for(const join of apiJoins){const id=join.source.semantic_id;invocations[id]=(invocations[id]||0)+1;}
    const operations={};for(const [index,join] of lifecycleJoins.entries()){
      const id=lifecycleRecords[index].semantic_id;const values=operations[id]||[];
      if(!values.includes(lifecycleRecords[index].operation))values.push(lifecycleRecords[index].operation);
      operations[id]=values.sort();
    }
    const callbackSlots={};for(const record of lifecycleRecords){
      if(!['callback_invoked','cleanup_invoked'].includes(record.operation)||!record.callback_slot)continue;
      const values=callbackSlots[record.semantic_id]||[];if(!values.includes(record.callback_slot))values.push(record.callback_slot);
      callbackSlots[record.semantic_id]=values.sort();
    }
    console.log(JSON.stringify({react:React.version,react_build:reactBuild,installed_source_attested:true,
      literal_export_paths_verified:true,
      source_semantics:[...new Set(map.react_semantics.map(row=>row.semantic_id))].sort(),
      joined_api_invocations:Object.fromEntries(Object.entries(invocations).sort()),
      joined_lifecycle_operations:Object.fromEntries(Object.entries(operations).sort()),
      joined_callback_slots:Object.fromEntries(Object.entries(callbackSlots).sort()),
      api_observations:apiRecords.length,lifecycle_observations:lifecycleRecords.length,
      observed_application_log:observed.apiLog},null,2));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
