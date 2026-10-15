import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planImperativeHandle} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({api:'react/useImperativeHandle/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),Server=require('react-dom/server');
  assert.equal(React.version,'18.3.1');const rule=getReactBehavior({surface:'react',exportName:'useImperativeHandle',version:'18.3.1'}).execution;
  const observations=[],traces=[];let phase='render',ignoredReturnCalls=0,storedFunctionCalls=0;
  const functionHandle=()=>{storedFunctionCalls++;};
  const objectRef=()=>{const ref={};Object.defineProperty(ref,'current',{get(){throw Error('React must not read current');},set(value){observations.push({operation:'write_ref',target:ref,property:'current',value});}});return ref;};
  const callbackRef=()=>{const ref=value=>{observations.push({operation:'callback_ref',target:ref,value});return ()=>{ignoredReturnCalls++;};};return ref;};
  const first=objectRef(),second=objectRef(),notify=callbackRef();
  const cases=[
    [{ref:null,deps:[],handle:{id:0}},{ref:undefined,deps:[],handle:{id:1}}],
    [{ref:first,deps:[0],handle:{id:2}},{ref:first,deps:[0],handle:{id:3}},
      {ref:first,deps:[1],handle:undefined},{ref:second,deps:[1],handle:null},
      {ref:null,deps:[1],handle:null},{ref:notify,deps:[1],handle:functionHandle}],
    [{ref:notify,deps:undefined,handle:{id:4}},{ref:notify,deps:undefined,handle:{id:5}},{ref:null,deps:undefined,handle:null}],
    [{ref:first,deps:[NaN],handle:1},{ref:first,deps:[NaN],handle:2},{ref:first,deps:[0],handle:3},
      {ref:first,deps:[-0],handle:4},{ref:first,deps:[-0],handle:5}],
  ];
  function App({refValue,factory,deps}){phase='render';React.useLayoutEffect(()=>{phase='layout';});React.useImperativeHandle(refValue,factory,deps);return null;}
  for(const strict of [false,true])for(const steps of cases) {
    const root=Client.createRoot(document.getElementById('app'));let previous=null;
    for(const step of steps) {
      const factory=(...received)=>{observations.push({operation:'invoke_factory',callback:factory,arguments:received,phase});return step.handle;};
      const args=[step.ref,factory,step.deps],before=observations.length;
      const tree=React.createElement(App,{refValue:step.ref,factory,deps:step.deps});
      DOM.flushSync(()=>root.render(strict?React.createElement(React.StrictMode,null,tree):tree));
      traces.push({args,previous,event:'commit',strictDevelopment:strict && process.env.NODE_ENV==='development',handle:step.handle,actual:observations.slice(before)});
      previous={ref:step.ref,dependencies:step.deps,attached:step.ref!=null};
    }
    const before=observations.length;DOM.flushSync(()=>root.unmount());
    traces.push({args:[],previous,event:'unmount',strictDevelopment:false,actual:observations.slice(before)});
  }
  let serverFactoryCalls=0;function ServerApp(){React.useImperativeHandle(notify,()=>{serverFactoryCalls++;return {};},[]);return null;}
  const beforeServer=observations.length;Server.renderToString(React.createElement(ServerApp));
  assert.equal(serverFactoryCalls,0);assert.equal(observations.length,beforeServer);
  const check=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);
    for(const trace of traces) {
      const plan=planImperativeHandle(program,trace);assert.equal(plan.status,'planned');
      const expected=plan.operations.map(operation=>operation.operation==='invoke_factory'?{...operation,phase:plan.phase}
        :{...operation,value:operation.value?.kind==='factory_result'?trace.handle:operation.value});
      assert.deepEqual(expected,trace.actual);
    }
    assert.deepEqual(planImperativeHandle(program,{environment:'server'}).operations,[]);
  };
  check(rule);let rejected=0;
  for(const mutation of [{skip_null_ref:false},{include_ref_dependency:false},{comparison:'strict_equal'},
    {object_property:'value'},{cleanup_value:'undefined'},{phase:'passive'},
    ...(process.env.NODE_ENV==='development'?[{strict_mount_rehearsal:false}]:[]),
    {ref_argument:1,factory_argument:0}]) {
    assert.throws(()=>check({...rule,...mutation}));rejected++;
  }
  assert.equal(ignoredReturnCalls,0);assert.equal(storedFunctionCalls,0);
  console.log(JSON.stringify({build:process.env.NODE_ENV,cases:traces.length,incorrect_programs_rejected:rejected,
    null_ref_skips_factory:true,ref_identity_is_dependency:true,object_and_callback_refs:true,
    ignored_callback_ref_return:true,function_handle_not_invoked:true,server_no_factory:true,installed_version:React.version}));
  dom.window.close();
}
