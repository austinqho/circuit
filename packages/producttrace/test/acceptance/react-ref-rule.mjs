import assert from 'node:assert/strict';import path from 'node:path';import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planRefCell} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')) {
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build},stdio:['ignore','pipe','inherit']})));
  console.log(JSON.stringify({apis:['react/createRef/18.3.1','react/useRef/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
} else {
  const require=createRequire(path.join(repository,'package.json')),{JSDOM}=require('jsdom');
  const dom=new JSDOM('<div id="app"></div>');globalThis.window=dom.window;globalThis.document=dom.window.document;
  const React=require('react'),DOM=require('react-dom'),Client=require('react-dom/client');assert.equal(React.version,'18.3.1');
  const build=process.env.NODE_ENV,root=Client.createRoot(document.getElementById('app'));let reads=0,renders=0,latest=[];
  const callback=()=>{reads++;throw Error('storing a function must not invoke it');};
  function App({initial,other}) {renders++;latest=[React.useRef(initial),React.useRef(other)];return null;}
  const render=(initial,other,key='same')=>DOM.flushSync(()=>root.render(React.createElement(App,{initial,other,key})));
  const traces=[];
  for(const initial of [undefined,null,7,NaN,-0,{object:true},callback]) {
    const key='mount-'+traces.length;render(initial,initial,key);const first=[...latest],before=renders;
    const written={mutation:traces.length};first[0].current=written;
    assert.equal(renders,before,'writing current must not schedule or perform a render');
    render('ignored-new-input',callback,key);traces.push({initial,first,next:[...latest],written});
    assert.equal(first[0],latest[0]);assert.equal(latest[0].current,written);assert.equal(latest[1].current,initial);
    assert.notEqual(latest[0],latest[1],'separate hooks never share a cell');
  }
  assert.equal(reads,0);DOM.flushSync(()=>root.unmount());
  const check=(api,rule)=>{
    assert.equal(validateReactExecutionRule(rule).valid,true);
    if(api==='createRef') {
      const previous={reference:React.createRef(callback)};
      for(const argument of [undefined,7,callback]) {
        const actual=React.createRef(argument),plan=planRefCell(rule,{args:[argument],previous,build});
        assert.equal(plan.operation,'allocate');assert.notEqual(actual,previous.reference);
        const descriptor=Object.getOwnPropertyDescriptor(actual,plan.property);assert.ok(descriptor);
        assert.equal(descriptor.value,plan.initial_value);assert.equal(descriptor.writable,plan.writable);
        assert.equal(descriptor.enumerable,plan.enumerable);assert.equal(Object.isSealed(actual),plan.sealed);
        assert.deepEqual(Object.keys(actual),['current']);actual.current=callback;assert.equal(actual.current,callback);
      }
    } else {
      for(const [index,row] of traces.entries()) {
        const owner='hook-'+index;
        const initial=planRefCell(rule,{args:[row.initial],owner,build});assert.equal(initial.operation,'allocate');
        // The second hook was never mutated and exposes the initial stored value.
        assert.equal(row.first[1][initial.property],initial.initial_value);assert.equal(Object.isSealed(row.first[1]),initial.sealed);
        const retained=planRefCell(rule,{args:['ignored-new-input'],owner,build,previous:{owner,reference:row.first[0]}});
        assert.equal(retained.operation,'retain');assert.equal(retained.reference,row.next[0]);
        assert.equal(row.next[0].current,row.written);
        if(index)assert.notEqual(row.first[0],traces[index-1].first[0],'keyed remount ends the prior hook cell lifetime');
      }
    }
  };
  const results=[];
  for(const api of ['createRef','useRef']) {
    const rule=getReactBehavior({surface:'react',exportName:api,version:'18.3.1'}).execution;check(api,rule);
    const mutants=[{property:'value'},{initial:api==='createRef'?'argument':'null'},
      {allocation:api==='createRef'?'mounted_hook':'per_call'},{sealed:{...rule.sealed,[build]:!rule.sealed[build]}}];
    if(api==='useRef')mutants.push({argument:1});
    for(const mutation of mutants){assert.equal(validateReactExecutionRule({...rule,...mutation}).valid,true);assert.throws(()=>check(api,{...rule,...mutation}));}
    results.push({api:'react/'+api+'/18.3.1',incorrect_rules_rejected:mutants.length});
  }
  assert.equal(reads,0);
  console.log(JSON.stringify({build,results,initial_values:traces.length,stable_hook_identity:true,remount_identity:true,
    function_values_not_called:true,current_write_does_not_render:true,development_sealing_verified:true}));dom.window.close();
}
