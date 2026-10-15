import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planExternalStore} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({api:'react/useSyncExternalStore/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client'),Server=require('react-dom/server');
  assert.equal(React.version,'18.3.1');assert.equal(require('react-dom/package.json').version,'18.3.1');const rule=getReactBehavior({surface:'react',exportName:'useSyncExternalStore',version:React.version}).execution;
  const subscriptions=[],snapshots=[],notifications=[],serverCases=[];let renders=0,phase='render';
  function App({args}) {renders++;phase='render';React.useLayoutEffect(()=>{phase='layout';});
    React.useEffect(()=>{phase='passive';});const value=React.useSyncExternalStore(...args);return React.createElement('output',null,String(value));}
  for(const strict of [false,true]) {
    let value=NaN,listener=null,throwOnce=false;const calls=[];
    const getter=(...args)=>{calls.push({getter:true,args});if(throwOnce){throwOnce=false;throw Error('transient');}return value;};
    const getter2=(...args)=>getter(...args);
    const subscribe=(callback,...rest)=>{calls.push({operation:'subscribe',callback:subscribe,phase,listener_arguments:1+rest.length});listener=callback;return ()=>calls.push({operation:'cleanup'});};
    const subscribe2=(callback,...rest)=>{calls.push({operation:'subscribe',callback:subscribe2,phase,listener_arguments:1+rest.length});listener=callback;return ()=>calls.push({operation:'cleanup'});};
    const root=Client.createRoot(document.getElementById('app'));let previous=null,args=[subscribe,getter];
    const render=()=>DOM.flushSync(()=>root.render(strict?React.createElement(React.StrictMode,null,React.createElement(App,{args})):React.createElement(App,{args})));
    const commit=()=>{const start=calls.length;render();subscriptions.push({args,previous,strictDevelopment:strict&&process.env.NODE_ENV==='development',actual:calls.slice(start).filter(row=>!row.getter)});
      previous={subscribe:args[0],hasCleanup:true};};
    commit();commit();args=[subscribe,getter2];commit();args=[subscribe2,getter2];commit();
    const object={id:1};
    for(const next of [NaN,0,-0,-0,object,object,{id:1}]) {
      const previousValue=value;value=next;const before=renders,callStart=calls.length;
      DOM.flushSync(()=>listener('ignored',42));
      notifications.push({args,event:'notify',observation:{previousValue,outcome:'returned',value},rendered:renders>before});
      assert.ok(calls.slice(callStart).some(row=>row.getter));
    }
    const before=renders;throwOnce=true;DOM.flushSync(()=>listener());
    notifications.push({args,event:'notify',observation:{previousValue:value,outcome:'threw'},rendered:renders>before});
    const start=calls.length;DOM.flushSync(()=>root.unmount());subscriptions.push({args:[],previous,event:'unmount',actual:calls.slice(start).filter(row=>!row.getter)});
    snapshots.push(...calls.filter(row=>row.getter));
  }
  let clientReads=0,serverReads=0,subscribed=0;const subscribe=()=>{subscribed++;return ()=>{};},client=()=>{clientReads++;return 'client';},server=()=>{serverReads++;return 'server';};
  function ServerApp(){const value=React.useSyncExternalStore(subscribe,client,server);return React.createElement('output',null,value);}
  assert.match(Server.renderToString(React.createElement(ServerApp)),/server/);assert.equal(clientReads,0);assert.equal(subscribed,0);assert.ok(serverReads>0);
  serverCases.push({args:[subscribe,client,server],environment:'server',expected:server});
  function Missing(){React.useSyncExternalStore(subscribe,client);return null;}
  assert.throws(()=>Server.renderToString(React.createElement(Missing)),/getServerSnapshot|418/);
  const check=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);
    for(const row of subscriptions){const predicted=planExternalStore(program,{...row,event:row.event||'commit'});assert.equal(predicted.status,'planned');
      assert.deepEqual(predicted.operations.map(op=>op.operation==='cleanup_if_returned'?{operation:'cleanup'}:op),row.actual);}
    for(const row of notifications){const predicted=planExternalStore(program,row);assert.equal(predicted.status,'planned');
      assert.equal(predicted.request_update,row.rendered);assert.equal(predicted.operations[0].callback,row.args[1]);assert.deepEqual(predicted.operations[0].arguments,[]);}
    for(const row of serverCases)assert.equal(planExternalStore(program,row).operations[0].callback,row.expected);
  };
  check(rule);let rejected=0;for(const mutation of [{subscribe_argument:1,snapshot_argument:0},{snapshot_argument:2,server_snapshot_argument:1},
    {subscription_phase:'layout'},{comparison:'strict_equal'},{resubscribe:'every_commit'},{snapshot_throw:'ignore'},
    ...(process.env.NODE_ENV==='development'?[{strict_mount_rehearsal:false}]:[])]){assert.throws(()=>check({...rule,...mutation}));rejected++;}
  assert.ok(snapshots.length);assert.ok(snapshots.every(row=>row.args.length===0));
  console.log(JSON.stringify({build:process.env.NODE_ENV,renderer_build_label:DOM.version,subscription_cases:subscriptions.length,notification_cases:notifications.length,
    snapshot_calls:snapshots.length,incorrect_programs_rejected:rejected,stable_getter_identity_preserves_subscription:true,
    changed_subscribe_replaces_subscription:true,object_is_snapshot_changes:true,throw_requests_retry:true,
    notification_arguments_ignored:true,server_snapshot_only:true,missing_server_snapshot_rejected:true,installed_version:React.version}));
  dom.window.close();
}
