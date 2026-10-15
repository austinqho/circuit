import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planTransitionResult,planSynchronousScope} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({api:'react/useTransition/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),{createRoot}=require('react-dom/client');assert.equal(React.version,'18.3.1');
  const rule=getReactBehavior({surface:'react',exportName:'useTransition',version:React.version}).execution;
  assert.equal(validateReactExecutionRule(rule).valid,true);const root=createRoot(document.getElementById('app')),reads=[];
  let tuple;function App(){tuple=React.useTransition();reads.push(tuple);return React.createElement('output',null,String(tuple[0]));}
  DOM.flushSync(()=>root.render(React.createElement(App)));const first=tuple,owner='root:component:hook';
  DOM.flushSync(()=>root.render(React.createElement(App)));assert.equal(tuple[1],first[1]);assert.notEqual(tuple,first);
  const context=React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentBatchConfig;
  const cases=[],originalValue={};
  for(const returnValue of [undefined,42,originalValue,{get then(){throw Error('must not inspect then');}}]) {
    const calls=[],order=[];const callback=(...args)=>{calls.push(args);order.push('callback');return returnValue;};
    order.push('before');const result=first[1](callback,originalValue);order.push('after');assert.deepEqual(order,['before','callback','after']);
    cases.push({args:[callback,originalValue],callback,result,returnValue,calls});
  }
  let observedContext;React.startTransition(()=>{const outer=context.transition;first[1](()=>{observedContext=context.transition;});assert.notEqual(observedContext,outer);assert.equal(context.transition,outer);});
  const error={error:true};assert.throws(()=>first[1](()=>{throw error;}),value=>value===error);assert.equal(context.transition,null);
  for(const missing of [undefined,null,false,0,'',{}])assert.throws(()=>first[1](missing),TypeError);
  let afterAwait='waiting';first[1](()=>Promise.resolve().then(()=>afterAwait=context.transition));await Promise.resolve();assert.equal(afterAwait,null);
  DOM.flushSync(()=>root.render(React.createElement(App)));assert.equal(tuple[1],first[1]);
  const check=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);
    for(const [index,read] of reads.entries()) {
      const plan=planTransitionResult(program,{tuple:read,owner,previous:index?{owner,start:first[1]}:null});assert.equal(plan.status,'planned');
      assert.equal(plan.pending,read[0]);assert.equal(plan.start,read[1]);assert.equal(plan.operation,index?'retain':'store');
    }
    for(const row of cases){const plan=planSynchronousScope(program.start_rule,{args:row.args});assert.equal(plan.callback,row.callback);assert.deepEqual(row.calls,[plan.arguments]);assert.equal(row.result,plan.result==='undefined'?undefined:row.returnValue);}
    assert.equal(program.start_rule.transition_context,'new');assert.equal(program.start_rule.async_continuation,'outside_scope');
  };
  check(rule);let rejected=0;
  for(const mutation of [{pending_index:1,start_index:0},{retain_start:false},
    ...[{callback_argument:1},{callback_arguments:[1]},{result:'callback_result'},{transition_context:'preserve'}].map(change=>({start_rule:{...rule.start_rule,...change}}))]){assert.throws(()=>check({...rule,...mutation}));rejected++;}
  DOM.flushSync(()=>root.render(React.createElement(App,{key:'remount'})));assert.notEqual(tuple[1],first[1]);DOM.flushSync(()=>root.unmount());
  console.log(JSON.stringify({build:process.env.NODE_ENV,tuple_reads:reads.length,callback_cases:cases.length,incorrect_programs_rejected:rejected,
    stable_start_and_fresh_tuple:true,remount_changes_start:true,synchronous_callback_arguments:true,return_ignored:true,throw_identity:true,thenable_not_inspected:true,transition_context_restored:true,async_outside_scope:true,pending_commit_attribution:'unproven'}));dom.window.close();
}
