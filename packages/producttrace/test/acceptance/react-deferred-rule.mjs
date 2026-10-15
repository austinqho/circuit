import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';import {validateReactExecutionRule,planDeferredValue} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({api:'react/useDeferredValue/18.3.1',format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),{createRoot}=require('react-dom/client');assert.equal(React.version,'18.3.1');
  const rule=getReactBehavior({surface:'react',exportName:'useDeferredValue',version:React.version}).execution;
  const cases=[],shared={},fn=()=>{throw Error('input function must remain a value');};
  const waitFor=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(predicate());};
  for(const [before,after] of [[1,2],[0,-0],[-0,0],[NaN,NaN],[shared,shared],[{},{}],[fn,fn],[fn,()=>{}]]) {
    const root=createRoot(document.getElementById('app')),observed=[];function App({value}){const selected=React.useDeferredValue(value);observed.push({value,selected});return React.createElement('output',null,typeof selected);}
    DOM.flushSync(()=>root.render(React.createElement(App,{value:before})));assert.equal(observed.length,1);assert.ok(Object.is(observed[0].selected,before));
    DOM.flushSync(()=>root.render(React.createElement(App,{value:after})));assert.ok(Object.is(observed[1].selected,before));
    if(!Object.is(before,after))await waitFor(()=>observed.length>=3);else await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(observed.length,Object.is(before,after)?2:3);assert.ok(Object.is(observed.at(-1).selected,after));
    const nonurgent={next:true},count=observed.length;React.startTransition(()=>root.render(React.createElement(App,{value:nonurgent})));
    await waitFor(()=>observed.length>count);assert.ok(Object.is(observed.at(-1).selected,nonurgent));
    cases.push({before,after,urgent:observed[1].selected,scheduled:count>2,nonurgent,nonurgentSelected:observed.at(-1).selected});
    DOM.flushSync(()=>root.unmount());
  }
  const check=program=>{
    assert.equal(validateReactExecutionRule(program).valid,true);
    for(const row of cases) {
      const owner='root:hook',previous={owner,value:row.before};
      const mount=planDeferredValue(program,{owner,args:[row.before]});assert.equal(mount.status,'planned');assert.ok(Object.is(mount.value,row.before));
      const urgent=planDeferredValue(program,{owner,args:[row.after],previous,urgency:'urgent'});assert.equal(urgent.status,'planned');assert.ok(Object.is(urgent.value,row.urgent));assert.equal(urgent.schedule_deferred,row.scheduled);
      const nonurgent=planDeferredValue(program,{owner,args:[row.nonurgent],previous,urgency:'nonurgent'});assert.equal(nonurgent.status,'planned');assert.ok(Object.is(nonurgent.value,row.nonurgentSelected));assert.equal(nonurgent.schedule_deferred,false);
    }
  };check(rule);let rejected=0;
  for(const mutation of [{value_argument:1},{comparison:'strict_equal'},{mount:'previous'},{urgent:'input'},{nonurgent:'previous'},{schedule_changed:false}]){assert.throws(()=>check({...rule,...mutation}));rejected++;}
  assert.equal(planDeferredValue(rule,{owner:'a',args:[2],previous:{owner:'a',value:1}}).reason,'render_urgency_unobserved');
  assert.equal(planDeferredValue(rule,{owner:'a',args:[2],previous:{owner:'b',value:1},urgency:'urgent'}).reason,'deferred_owner_mismatch');
  let serverValue;function Server(){serverValue=React.useDeferredValue(fn);return React.createElement('b',null,'server');}require('react-dom/server').renderToString(React.createElement(Server));assert.equal(serverValue,fn);
  console.log(JSON.stringify({build:process.env.NODE_ENV,cases:cases.length,incorrect_programs_rejected:rejected,urgent_retains_previous:true,nonurgent_uses_input:true,changed_urgent_schedules:true,same_value_does_not_schedule:true,signed_zero_and_nan:true,function_values_not_invoked:true,server_initial_value:true,unknown_urgency_rejected:true,foreign_owner_rejected:true}));dom.window.close();
}
