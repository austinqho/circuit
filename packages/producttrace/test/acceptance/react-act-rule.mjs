import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getReactBehavior} from '../../analysis/react-behavior.mjs';
import {validateReactExecutionRule,planReactTestScope} from '../../analysis/react-execution-rule.mjs';
const repository=path.resolve(process.argv[2]||'/tmp/producttrace-librechat-autonomous');
if(!process.argv.includes('--child')){
  const builds=['development','production'].map(build=>JSON.parse(execFileSync(process.execPath,[fileURLToPath(import.meta.url),repository,'--child'],{encoding:'utf8',env:{...process.env,NODE_ENV:build}})));
  console.log(JSON.stringify({apis:['react/act/18.3.1','react/unstable_act/18.3.1'],format_pass:true,behavior_pass:true,builds},null,2));
}else{
  const require=createRequire(path.join(repository,'package.json')),React=require('react'),build=process.env.NODE_ENV;
  assert.equal(React.version,'18.3.1');assert.equal(React.act,React.unstable_act);
  const rule=getReactBehavior({surface:'react',exportName:'act',version:React.version}).execution;
  assert.equal(validateReactExecutionRule(rule).valid,true);
  const value={sentinel:true},calls=[],order=[];
  function callback(...args){order.push('callback');calls.push(args);return value;}
  const args=[callback,19],plan=planReactTestScope(rule,{args,build});
  let result,error;order.push('before');try{result=React.act(...args);}catch(e){error=e;}order.push('after');
  let queueDrain=false;
  if(build==='production'){
    assert.equal(plan.operation,'throw_before_callback');assert.equal(calls.length,0);assert.ok(error instanceof Error);
    assert.match(error.message,/not supported in production/);assert.deepEqual(order,['before','after']);
  }else{
    assert.equal(error,undefined);assert.equal(plan.callback,callback);assert.equal(calls.length,1);
    assert.deepEqual(plan.arguments,calls[0]);assert.deepEqual(order,['before','callback','after']);
    assert.equal(typeof result.then,'function');assert.notEqual(result,value);assert.equal(await result,value);
    const thrown={original:true};assert.throws(()=>React.act(()=>{throw thrown;}),e=>e===thrown);
    for(const input of [null,undefined,false,0,{}])assert.throws(()=>React.act(input),TypeError);
    let release,entered=0;const promise=new Promise(resolve=>release=resolve);
    const pending=React.act(()=>{entered++;return promise;});assert.equal(entered,1);
    release(value);assert.equal(await pending,value);
    // act's then method does not itself return a promise. Observe rejection
    // through a host Promise rather than depending on Promise chaining.
    await new Promise((resolve,reject)=>React.act(()=>Promise.reject(thrown)).then(()=>reject(Error('unexpected success')),e=>{try{assert.equal(e,thrown);resolve();}catch(error){reject(error);}}));
    const nested=[];await React.act(()=>{nested.push('outer');React.act(()=>nested.push('inner'));nested.push('return');});
    assert.deepEqual(nested,['outer','inner','return']);
    const {JSDOM}=require('jsdom'),dom=new JSDOM('<div id="root"></div>');
    globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    const {createRoot}=require('react-dom/client');const host=document.getElementById('root'),root=createRoot(host),effects=[];let set;
    function Probe(){const [n,update]=React.useState(0);set=update;React.useEffect(()=>{effects.push(n);},[n]);return React.createElement('output',null,n);}
    await React.act(()=>root.render(React.createElement(Probe)));assert.equal(host.textContent,'0');assert.deepEqual(effects,[0]);
    const during=[];await React.act(()=>{set(1);during.push(host.textContent);});
    assert.deepEqual(during,['0']);assert.equal(host.textContent,'1');assert.deepEqual(effects,[0,1]);queueDrain=true;
    await React.act(()=>root.unmount());dom.window.close();
  }
  const agrees=candidate=>{
    const p=planReactTestScope(candidate,{args,build});
    if(build==='production')return p.operation==='throw_before_callback'&&calls.length===0;
    return p.operation==='invoke'&&p.callback===callback&&p.arguments.length===calls[0].length
      &&p.arguments.every((v,i)=>Object.is(v,calls[0][i]))&&p.timing==='synchronous'
      &&p.result==='thenable'&&p.callback_exceptions==='propagate'&&p.completion==='outermost_queue_drain'&&queueDrain;
  };
  assert.equal(agrees(rule),true);
  const mutants=build==='production'?[{...rule,production:'invoke'}]:[
    {...rule,development:'throw_before_callback'},{...rule,callback_argument:1},{...rule,callback_arguments:[1]},
    {...rule,callback_timing:'deferred'},{...rule,result:'callback_result'},{...rule,callback_exceptions:'wrap'},{...rule,completion:'callback_return'}];
  for(const mutant of mutants){assert.equal(validateReactExecutionRule(mutant).valid,true);assert.equal(agrees(mutant),false);}
  console.log(JSON.stringify({build,incorrect_programs_rejected:mutants.length,callback_count:calls.length,production_rejects_before_callback:build==='production',queue_drain_checked:queueDrain,aliases_identical:true}));
}
